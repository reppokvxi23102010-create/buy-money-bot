process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ [Unhandled Rejection]:', reason);
});
process.on('uncaughtException', (err, origin) => {
  console.error('💥 [Uncaught Exception]:', err);
});

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { Rcon } = require('rcon-client');
const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    MessageFlags,
    PermissionsBitField,
    ChannelType,
    Events
} = require('discord.js');

// ============================================================
// 1. CONFIG & FILE DATABASE
// ============================================================
const PORT = process.env.PORT || 10000;
const BANK_CONFIG = {
    BANK_ID: process.env.BANK_ID || 'MB',
    ACCOUNT_NO: process.env.ACCOUNT_NO || '0357597469',
    ACCOUNT_NAME: process.env.ACCOUNT_NAME || 'TRAN HUU HAI SON'
};
const CARD_DISCOUNT = 0.20;

const STOCK_FILE = path.join(__dirname, 'stock.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const ACC_STOCK_FILE = path.join(__dirname, 'accounts.json');
const ACC_DETAIL_FILE = path.join(__dirname, 'accounts_detail.json');
const MONEY_ORDERS_FILE = path.join(__dirname, 'money_orders.json');

function readJson(file, fallback) {
    try {
        if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback, null, 2), 'utf8');
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { return fallback; }
}

function writeJson(file, data) {
    try { 
        fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); 
        return true; 
    } catch { return false; }
}

let currentStockM = Number(readJson(STOCK_FILE, { stockM: 5000 }).stockM) || 0;
let moneyConfig = readJson(CONFIG_FILE, {});
let RATE = Number(moneyConfig.rate) > 0 ? Number(moneyConfig.rate) : 130;

// ============================================================
// 2. RCON MINECRAFT ENGINE (TỰ ĐỘNG PHÁT MONEY INGAME)
// ============================================================
async function sendMoneyIngame(ign, amountM) {
    if (!process.env.RCON_HOST) {
        console.log('⚠️ [RCON] Chưa cấu hình RCON_HOST trong .env - Chuyển sang chờ admin duyệt.');
        return false;
    }
    try {
        const rcon = await Rcon.connect({
            host: process.env.RCON_HOST,
            port: Number(process.env.RCON_PORT) || 25575,
            password: process.env.RCON_PASSWORD
        });
        
        const amountFormat = amountM * 1000000;
        const response = await rcon.send(`eco give ${ign} ${amountFormat}`);
        console.log(`✅ [RCON Success] Đã nạp ${amountM}M$ (${amountFormat}) cho ${ign}:`, response);
        await rcon.end();
        return true;
    } catch (err) {
        console.error('❌ [RCON Error] Không thể kết nối hoặc gửi lệnh RCON:', err.message);
        return false;
    }
}

// ============================================================
// 3. DISCORD CLIENT & SAFETY UTILS
// ============================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ]
});

const seenInteractions = new Set();
function claimInteraction(interaction) {
    if (seenInteractions.has(interaction.id)) return false;
    seenInteractions.add(interaction.id);
    setTimeout(() => seenInteractions.delete(interaction.id), 600000);
    return true;
}

async function safeReply(interaction, data) {
    try {
        if (interaction.replied || interaction.deferred) return await interaction.followUp(data);
        return await interaction.reply(data);
    } catch { return null; }
}

async function safeDeferReply(interaction, data = {}) {
    try {
        if (interaction.replied || interaction.deferred) return true;
        await interaction.deferReply(data);
        return true;
    } catch { return false; }
}

// ============================================================
// 4. WEBHOOK SERVER (TỰ ĐỘNG CHECK NGÂN HÀNG SEPAY 24/7)
// ============================================================
const app = express();
app.use(express.json());

app.get('/', (req, res) => res.send('Bot AutoBuy KingSMP 24/7 Engine is Running!'));

app.post('/webhook/sepay', async (req, res) => {
    try {
        const { content, transferAmount } = req.body;
        if (!content || !transferAmount) return res.status(400).json({ status: 'invalid payload' });

        console.log(`📥 [SePay] Nhận thanh toán: ${transferAmount} VNĐ | Nội dung: "${content}"`);

        // A. Xử lý tự động đơn Money
        const moneyOrders = readJson(MONEY_ORDERS_FILE, {});
        const matchedMoneyOrderId = Object.keys(moneyOrders).find(id => {
            const order = moneyOrders[id];
            return order.status === 'pending' && 
                   content.toUpperCase().includes(order.memo.toUpperCase()) &&
                   transferAmount >= order.vndAmount;
        });

        if (matchedMoneyOrderId) {
            await processAutoMoneySuccess(moneyOrders[matchedMoneyOrderId]);
            return res.json({ status: 'success', type: 'money' });
        }

        // B. Xử lý tự động đơn Account
        const accs = readJson(ACC_DETAIL_FILE, []);
        const matchedAcc = accs.find(acc => 
            acc.status === 'pending' && 
            content.toUpperCase().includes(`THANH TOAN DON HANG ${acc.username}`.toUpperCase()) &&
            transferAmount >= acc.priceBank
        );

        if (matchedAcc) {
            await processAutoAccountSuccess(matchedAcc);
            return res.json({ status: 'success', type: 'account' });
        }

        return res.json({ status: 'ignored', message: 'No matching pending orders' });
    } catch (err) {
        console.error('❌ Lỗi SePay Webhook:', err);
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`🌐 Webhook HTTP Server running on port: ${PORT}`));

// ============================================================
// 5. TỰ ĐỘNG XỬ LÝ GIAO DỊCH THÀNH CÔNG
// ============================================================
async function processAutoMoneySuccess(order) {
    const orders = readJson(MONEY_ORDERS_FILE, {});
    
    currentStockM = Math.max(0, currentStockM - order.amountM);
    writeJson(STOCK_FILE, { stockM: currentStockM });

    order.status = 'approved';
    order.approvedBy = 'AUTO_SEPAY';
    order.approvedAt = Date.now();
    orders[order.id] = order;
    writeJson(MONEY_ORDERS_FILE, orders);

    const rconSuccess = await sendMoneyIngame(order.ign, order.amountM);

    if (order.ticketChannelId) {
        try {
            const channel = await client.channels.fetch(order.ticketChannelId);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle('⚡ THANH TOÁN THÀNH CÔNG (AUTO 100%)')
                    .setColor('#2ecc71')
                    .setDescription(
                        `✅ Hệ thống đã tự động nhận **${order.vndAmount.toLocaleString('vi-VN')} VNĐ**!\n\n` +
                        `👤 Ingame: \`${order.ign}\`\n` +
                        `💰 Money: **${order.amountM.toLocaleString('vi-VN')}M$**\n` +
                        `🎮 Trạng thái RCON: ${rconSuccess ? '✅ **Đã chuyển Money thẳng vào nick**' : '⚠️ Lỗi RCON (Admin sẽ chuyển tay)'}`
                    )
                    .setTimestamp();

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setStyle(ButtonStyle.Secondary)
                );

                await channel.send({ content: `<@${order.userId}>`, embeds: [embed], components: [row] });
            }
        } catch (e) { console.error('Lỗi gửi ticket money:', e.message); }
    }
}

async function processAutoAccountSuccess(acc) {
    const accs = readJson(ACC_DETAIL_FILE, []);
    const stockAccs = readJson(ACC_STOCK_FILE, []);

    if (stockAccs.length === 0) {
        console.error(`❌ [Auto Acc] Kho accounts.json trống! Không có nick giao cho ${acc.username}`);
        return;
    }

    const deliveredAcc = stockAccs.shift();
    writeJson(ACC_STOCK_FILE, stockAccs);

    const targetAcc = accs.find(a => a.id === acc.id);
    if (targetAcc) {
        targetAcc.status = 'sold';
        targetAcc.soldAt = Date.now();
        writeJson(ACC_DETAIL_FILE, accs);
    }

    if (acc.pendingTicketId) {
        try {
            const channel = await client.channels.fetch(acc.pendingTicketId);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle('🎉 TỰ ĐỘNG PHÁT TÀI KHOẢN')
                    .setColor('#2ecc71')
                    .setDescription(`Xác thực tiền thành công. Chi tiết nick **${acc.username}**:`)
                    .addFields(
                        { name: '📧 Tài khoản / Email', value: `\`\`\`${deliveredAcc.email || deliveredAcc.name}\`\`\`` },
                        { name: '🔑 Mật khẩu / Code', value: `\`\`\`${deliveredAcc.recoveryCode || deliveredAcc.password || 'Không có'}\`\`\`` }
                    )
                    .setFooter({ text: 'Vui lòng đổi mật khẩu ngay sau khi nhận!' });

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setStyle(ButtonStyle.Danger)
                );

                await channel.send({ content: `<@${acc.pendingBuyerId}>`, embeds: [embed], components: [row] });
            }
        } catch (e) { console.error('Lỗi gửi ticket acc:', e.message); }
    }
}

// ============================================================
// 6. HELPER DISPLAY EMBEDS
// ============================================================
function buildAutoBuyEmbed() {
    const embed = new EmbedBuilder()
        .setTitle('🛒 HỆ THỐNG MUA MONEY KING SMP (AUTO 24/7)')
        .setColor('#0099ff')
        .setDescription(
            ` Tỷ giá: **1M = ${RATE.toLocaleString('vi-VN')} VNĐ**\n` +
            ` Kho hiện tại: **${currentStockM.toLocaleString('vi-VN')}M$**\n\n` +
            ` Bấm nút bên dưới để tiến hành tạo đơn mua!`
        )
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_buy_money_start').setLabel('💳 Mua Money Ngay').setStyle(ButtonStyle.Primary)
    );

    return { embeds: [embed], components: [row] };
}

// ============================================================
// 7. DISCORD BOT INTERACTIONS
// ============================================================
client.once(Events.ClientReady, async c => {
    console.log(`🤖 Bot Discord sẵn sàng: ${c.user.tag}`);
    
    // Register Slash Commands
    const commands = [
        new SlashCommandBuilder().setName('panel-money').setDescription('Gửi bảng mua Money tự động'),
        new SlashCommandBuilder().setName('set-stock').setDescription('Cập nhật kho Money (M$)')
            .addIntegerOption(opt => opt.setName('amount').setDescription('Số M$ mới').setRequired(true)),
        new SlashCommandBuilder().setName('set-rate').setDescription('Cập nhật tỉ giá Money (VNĐ/1M)')
            .addIntegerOption(opt => opt.setName('rate').setDescription('Giá VNĐ cho 1M').setRequired(true)),
        new SlashCommandBuilder().setName('thongtin').setDescription('Đăng bán tài khoản SMP mới')
            .addStringOption(opt => opt.setName('username').setDescription('Tên tài khoản').setRequired(true))
            .addIntegerOption(opt => opt.setName('price').setDescription('Giá bán (VNĐ)').setRequired(true))
            .addStringOption(opt => opt.setName('cape').setDescription('Loại Cape').setRequired(true))
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN || process.env.TOKEN);
    try {
        await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
        console.log('✅ Đã đăng ký Slash Commands thành công.');
    } catch (e) { console.error('❌ Lỗi đăng ký Slash Commands:', e); }
});

client.on(Events.InteractionCreate, async interaction => {
    if (!claimInteraction(interaction)) return;

    try {
        // --- SLASH COMMANDS ---
        if (interaction.isChatInputCommand()) {
            const { commandName } = interaction;

            if (commandName === 'panel-money') {
                return await interaction.reply(buildAutoBuyEmbed());
            }

            if (commandName === 'set-stock') {
                currentStockM = interaction.options.getInteger('amount');
                writeJson(STOCK_FILE, { stockM: currentStockM });
                return await safeReply(interaction, { content: `✅ Đã cập nhật kho Money thành: **${currentStockM}M$**`, flags: MessageFlags.Ephemeral });
            }

            if (commandName === 'set-rate') {
                RATE = interaction.options.getInteger('rate');
                writeJson(CONFIG_FILE, { rate: RATE });
                return await safeReply(interaction, { content: `✅ Đã cập nhật tỷ giá thành: **1M = ${RATE} VNĐ**`, flags: MessageFlags.Ephemeral });
            }

            if (commandName === 'thongtin') {
                const username = interaction.options.getString('username');
                const priceBank = interaction.options.getInteger('price');
                const cape = interaction.options.getString('cape');

                const accs = readJson(ACC_DETAIL_FILE, []);
                const newAcc = {
                    id: `ACC_${Date.now()}`,
                    username,
                    priceBank,
                    cape,
                    status: 'available',
                    createdAt: Date.now()
                };
                accs.push(newAcc);
                writeJson(ACC_DETAIL_FILE, accs);

                const embed = new EmbedBuilder()
                    .setTitle(`🎮 TÀI KHOẢN KING SMP: ${username}`)
                    .setColor('#f1c40f')
                    .addFields(
                        { name: '💰 Giá Chuyển Khoản', value: `${priceBank.toLocaleString('vi-VN')} VNĐ`, inline: true },
                        { name: '🧣 Cape', value: cape, inline: true },
                        { name: '📌 Trạng thái', value: '🟢 Đang bán', inline: true }
                    );

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`buy_acc_${newAcc.id}`).setLabel('🛒 Mua Nick Này').setStyle(ButtonStyle.Success)
                );

                return await interaction.reply({ embeds: [embed], components: [row] });
            }
        }

        // --- BUTTON INTERACTIONS ---
        if (interaction.isButton()) {
            const customId = interaction.customId;

            if (customId === 'btn_buy_money_start') {
                const modal = new ModalBuilder()
                    .setCustomId('modal_buy_money')
                    .setTitle('MUA MONEY AUTOMATIC');

                const ignInput = new TextInputBuilder()
                    .setCustomId('input_ign')
                    .setLabel('Tên Ingame (IGN Minecraft)')
                    .setPlaceholder('Ví dụ: Steve_SMP')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const amountInput = new TextInputBuilder()
                    .setCustomId('input_amount')
                    .setLabel('Số lượng Money muốn mua (Đơn vị: M)')
                    .setPlaceholder(`Tối đa ${currentStockM}M`)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(ignInput),
                    new ActionRowBuilder().addComponents(amountInput)
                );

                return await interaction.showModal(modal);
            }

            if (customId.startsWith('buy_acc_')) {
                const accId = customId.replace('buy_acc_', '');
                const accs = readJson(ACC_DETAIL_FILE, []);
                const targetAcc = accs.find(a => a.id === accId);

                if (!targetAcc || targetAcc.status !== 'available') {
                    return await safeReply(interaction, { content: '❌ Tài khoản này không còn sẵn có!', flags: MessageFlags.Ephemeral });
                }

                // Tạo Ticket Channel
                const ticketChannel = await interaction.guild.channels.create({
                    name: `ticket-acc-${targetAcc.username}`,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                    ]
                });

                targetAcc.status = 'pending';
                targetAcc.pendingBuyerId = interaction.user.id;
                targetAcc.pendingTicketId = ticketChannel.id;
                writeJson(ACC_DETAIL_FILE, accs);

                const qrUrl = `https://img.vietqr.io/image/${BANK_CONFIG.BANK_ID}-${BANK_CONFIG.ACCOUNT_NO}-compact2.png?amount=${targetAcc.priceBank}&addInfo=THANH TOAN DON HANG ${targetAcc.username}&accountName=${encodeURIComponent(BANK_CONFIG.ACCOUNT_NAME)}`;

                const embed = new EmbedBuilder()
                    .setTitle(`💳 THANH TOÁN MUA NICK: ${targetAcc.username}`)
                    .setColor('#3498db')
                    .setDescription(
                        `Vui lòng quét mã QR bên dưới để thanh toán tự động.\n\n` +
                        `💵 Số tiền: **${targetAcc.priceBank.toLocaleString('vi-VN')} VNĐ**\n` +
                        `📝 Nội dung CK: \`THANH TOAN DON HANG ${targetAcc.username}\`\n\n` +
                        `*Hệ thống sẽ tự động giao nick ngay trong channel này khi nhận đủ tiền!*`
                    )
                    .setImage(qrUrl);

                await ticketChannel.send({ content: `<@${interaction.user.id}>`, embeds: [embed] });
                return await safeReply(interaction, { content: `✅ Đã tạo Ticket thanh toán: ${ticketChannel}`, flags: MessageFlags.Ephemeral });
            }

            if (customId === 'close_ticket') {
                await safeReply(interaction, { content: '🔒 Ticket sẽ bị xóa sau 5 giây...' });
                setTimeout(() => {
                    interaction.channel.delete().catch(() => {});
                }, 5000);
            }
        }

        // --- MODAL SUBMISSIONS ---
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'modal_buy_money') {
                const ign = interaction.fields.getTextInputValue('input_ign').trim();
                const amountM = parseInt(interaction.fields.getTextInputValue('input_amount').trim(), 10);

                if (isNaN(amountM) || amountM <= 0) {
                    return await safeReply(interaction, { content: '❌ Số lượng Money không hợp lệ!', flags: MessageFlags.Ephemeral });
                }

                if (amountM > currentStockM) {
                    return await safeReply(interaction, { content: `❌ Số lượng mua vượt quá tồn kho (${currentStockM}M$)!`, flags: MessageFlags.Ephemeral });
                }

                const vndAmount = amountM * RATE;
                const memo = `SMP${Math.floor(100000 + Math.random() * 900000)}`;

                // Tạo Ticket Mua Money
                const ticketChannel = await interaction.guild.channels.create({
                    name: `ticket-money-${ign}`,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                    ]
                });

                const orderData = {
                    id: memo,
                    userId: interaction.user.id,
                    ign,
                    amountM,
                    vndAmount,
                    memo,
                    status: 'pending',
                    ticketChannelId: ticketChannel.id,
                    createdAt: Date.now()
                };

                const moneyOrders = readJson(MONEY_ORDERS_FILE, {});
                moneyOrders[memo] = orderData;
                writeJson(MONEY_ORDERS_FILE, moneyOrders);

                const qrUrl = `https://img.vietqr.io/image/${BANK_CONFIG.BANK_ID}-${BANK_CONFIG.ACCOUNT_NO}-compact2.png?amount=${vndAmount}&addInfo=${memo}&accountName=${encodeURIComponent(BANK_CONFIG.ACCOUNT_NAME)}`;

                const embed = new EmbedBuilder()
                    .setTitle('💳 QUÉT MÃ THANH TOÁN MUA MONEY')
                    .setColor('#e67e22')
                    .setDescription(
                        ` Vui lòng chuyển khoản chính xác nội dung để nhận Money tự động:\n\n` +
                        `👤 Ingame: \`${ign}\`\n` +
                        `💰 Số lượng: **${amountM}M$**\n` +
                        `💵 Số tiền: **${vndAmount.toLocaleString('vi-VN')} VNĐ**\n` +
                        `📌 Nội dung chuyển khoản: \`${memo}\`\n\n` +
                        `⚡ *Hệ thống tự động cộng Money vào game ngay khi giao dịch thành công!*`
                    )
                    .setImage(qrUrl);

                await ticketChannel.send({ content: `<@${interaction.user.id}>`, embeds: [embed] });
                return await safeReply(interaction, { content: `✅ Đã tạo Ticket thanh toán: ${ticketChannel}`, flags: MessageFlags.Ephemeral });
            }
        }
    } catch (error) {
        console.error('❌ Interaction Error:', error);
    }
});

// ============================================================
// 8. START BOT
// ============================================================
const botToken = process.env.DISCORD_TOKEN || process.env.TOKEN;
if (botToken) {
    client.login(botToken);
} else {
    console.error('❌ KHÔNG TÌM THẤY DISCORD TOKEN TRONG FILE .ENV!');
}
