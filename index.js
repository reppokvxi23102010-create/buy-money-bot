require('dotenv').config();

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
    Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, Events, PermissionsBitField, MessageFlags
} = require('discord.js');

// ============================================================
// 1. MÁY CHỦ WEB (WEBHOOKS - CHỈ XỬ LÝ MONEY)
// ============================================================
const PORT = Number(process.env.PORT || 10000);
const WEBHOOK_BODY_LIMIT = 512 * 1024;

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString('utf8');
            if (Buffer.byteLength(body, 'utf8') > WEBHOOK_BODY_LIMIT) {
                reject(new Error('Dữ liệu quá lớn.'));
                req.destroy();
            }
        });
        req.on('end', () => {
            if (!body) return resolve({});
            try { resolve(JSON.parse(body)); } catch { reject(new Error('Dữ liệu không hợp lệ.')); }
        });
        req.on('error', reject);
    });
}

// Xử lý Bank (Chỉ nạp Money)
async function handleSepayWebhook(req, res) {
    try {
        const payload = await readRequestBody(req);
        if (String(payload.transferType || '').toLowerCase() !== 'in') return sendJson(res, 200, { success: true, ignored: 'khong_phai_tien_vao' });

        const transactionId = String(payload.id || payload.referenceCode || '');
        const content = String(payload.content || payload.description || '').trim();
        const transferAmount = Math.floor(Number(payload.transferAmount || 0));

        if (!transactionId || transferAmount <= 0) return sendJson(res, 400, { success: false, message: 'Thiếu thông tin.' });

        const orders = getMoneyOrders();
        const normalizedContent = content.toLowerCase();
        
        const order = Object.values(orders).find(item => {
            if (item.type !== 'bank' || item.status !== 'dang_cho') return false;
            if (Number(item.vndAmount) > transferAmount) return false; 
            const memoToken = String(item.memo || '').toLowerCase();
            return memoToken && normalizedContent.includes(memoToken);
        });

        if (!order) return sendJson(res, 200, { success: true, matched: false });

        order.status = 'da_thanh_toan';
        order.paymentReference = transactionId;
        orders[order.id] = order;
        saveMoneyOrders(orders);

        const result = await fulfillMoneyOrder(order);
        return sendJson(res, 200, { success: result.ok });
    } catch (err) {
        console.error('❌ Lỗi xử lý ngân hàng:', err);
        return sendJson(res, 500, { success: false });
    }
}

// Xử lý Thẻ cào (Chỉ nạp Money)
async function handleCardWebhook(req, res) {
    try {
        const payload = await readRequestBody(req);
        const code = String(payload.code ?? payload.pin ?? '').trim();
        const seri = String(payload.serial ?? payload.seri ?? '').trim();
        const statusRaw = String(payload.status ?? payload.message ?? '').toLowerCase();
        const success = payload.success === true || ['success', 'thanhcong', '1', 'true', 'ok'].includes(statusRaw);

        if (!code || !seri || !success) return sendJson(res, 200, { success: true, matched: false });

        const orders = getMoneyOrders();
        const order = Object.values(orders).find(item =>
            item.type === 'card' && item.status === 'dang_cho' &&
            String(item.cardCode || '').trim() === code && String(item.cardSeri || '').trim() === seri
        );

        if (!order) return sendJson(res, 200, { success: true, matched: false });

        order.status = 'da_thanh_toan';
        orders[order.id] = order;
        saveMoneyOrders(orders);

        const result = await fulfillMoneyOrder(order);
        return sendJson(res, 200, { success: result.ok });
    } catch (err) {
        return sendJson(res, 500, { success: false });
    }
}

const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/webhook/sepay') return handleSepayWebhook(req, res);
    if (req.method === 'POST' && req.url === '/webhook/card') return handleCardWebhook(req, res);
    return sendJson(res, 404, { success: false, message: 'Khong tim thay' });
});
server.listen(PORT, () => console.log(`[Hệ thống] Mở cổng: ${PORT}`));


// ============================================================
// 2. CẤU HÌNH & DỮ LIỆU
// ============================================================
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

const CARD_DISCOUNT = 0.20;
const BANK_CONFIG = { BANK_ID: 'MB', ACCOUNT_NO: '0357597469', ACCOUNT_NAME: 'TRAN HUU HAI SON' };

const STOCK_FILE = path.join(__dirname, 'stock.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const MONEY_ORDERS_FILE = path.join(__dirname, 'money_orders.json');

function readJson(file, fallback) {
    try { if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback, null, 2)); return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }

let currentStockM = readJson(STOCK_FILE, { stockM: 5000 }).stockM;
let moneyConfig = readJson(CONFIG_FILE, { rate: 130 });
let RATE = Number(moneyConfig.rate) > 0 ? Number(moneyConfig.rate) : 130;

function saveStock(amountM) { writeJson(STOCK_FILE, { stockM: Math.max(0, Number(amountM) || 0) }); currentStockM = amountM; }
function getMoneyOrders() { return readJson(MONEY_ORDERS_FILE, {}); }
function saveMoneyOrders(data) { writeJson(MONEY_ORDERS_FILE, data); }

function parseCardValue(input) {
    let str = String(input).trim().toLowerCase().replace(/[\s,.]/g, '');
    let multiplier = 1;
    if (str.endsWith('k')) { multiplier = 1000; str = str.slice(0, -1); } 
    else if (str.endsWith('m')) { multiplier = 1000000; str = str.slice(0, -1); }
    const value = Number(str);
    return Math.floor(value * multiplier) || 0;
}

// ============================================================
// 3. TỰ ĐỘNG NẠP TIỀN (RCON)
// ============================================================
async function sendMinecraftPayCommand(order) {
    const host = process.env.RCON_HOST;
    const port = Number(process.env.RCON_PORT || 25575);
    const password = process.env.RCON_PASSWORD;

    if (!host || !password) return { ok: false, message: 'Chưa cài đặt máy chủ.' };
    let Rcon; try { ({ Rcon } = require('rcon-client')); } catch { return { ok: false, message: 'Thiếu hệ thống phụ.' }; }

    const command = `pay ${order.ign} ${Math.floor(Number(order.amountM) || 0)}`;
    const rcon = new Rcon({ host, port, password });

    try {
        await rcon.connect();
        await rcon.send(command);
        await rcon.end();
        return { ok: true };
    } catch (err) {
        try { await rcon.end(); } catch {}
        return { ok: false, message: 'Máy chủ không phản hồi.' };
    }
}

async function fulfillMoneyOrder(order) {
    const amountM = Math.floor(Number(order.amountM) || 0);
    
    // Trừ kho
    currentStockM -= amountM;
    saveStock(currentStockM);

    // Chạy RCON
    const payResult = await sendMinecraftPayCommand(order);

    const orders = getMoneyOrders();
    order.status = payResult.ok ? 'hoan_thanh' : 'loi_may_chu';
    orders[order.id] = order; 
    saveMoneyOrders(orders);
    
    await updateAutoBuyPanel();

    if (order.ticketChannelId) {
        try {
            const channel = await client.channels.fetch(String(order.ticketChannelId));
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle(payResult.ok ? '✅ NẠP THÀNH CÔNG' : '⚠️ LỖI MÁY CHỦ')
                    .setColor(payResult.ok ? '#2ecc71' : '#e67e22')
                    .setDescription(payResult.ok ? `Hệ thống đã nạp **${amountM} M$** cho tên: **${order.ign}**` : `Đã nhận tiền nhưng nạp lỗi: ${payResult.message}`);
                
                // NÚT ĐÓNG TICKET THỦ CÔNG
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Vé (Xóa)').setStyle(ButtonStyle.Danger)
                );

                await channel.send({ content: `<@${order.userId}>`, embeds: [embed], components: [row] });
            }
        } catch (err) {}
    }

    return payResult;
}

// ============================================================
// 4. BẢNG ĐIỀU KHIỂN - DISCORD HAISON
// ============================================================
function buildAutoBuyEmbed() {
    const isOutOfStock = currentStockM <= 0;
    const embed = new EmbedBuilder()
        .setColor('#2ecc71')
        .setTitle('🛒 HỆ THỐNG GIAO DỊCH - DISCORD HAISON')
        .setDescription(
            `💸 **Tỷ giá Ngân hàng:** \`${RATE} VNĐ = 1M\`\n` +
            `🎟️ **Tỷ giá Thẻ:** Trừ ${CARD_DISCOUNT * 100}%\n` +
            `📦 **Kho Tiền:** \`${currentStockM} M\`\n\n` +
            `Vui lòng chọn chức năng bên dưới để tạo vé:`
        )
        .setFooter({ text: 'Hệ thống tự động nạp tiền | Quản lý bởi HaiSon' });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('buy_bank').setLabel('Mua Tiền (Ngân Hàng)').setStyle(ButtonStyle.Success).setDisabled(isOutOfStock),
        new ButtonBuilder().setCustomId('buy_card').setLabel('Mua Tiền (Thẻ Cào)').setStyle(ButtonStyle.Primary).setDisabled(isOutOfStock),
        new ButtonBuilder().setCustomId('buy_acc').setLabel('Mua Tài Khoản').setStyle(ButtonStyle.Secondary)
    );
    return { embeds: [embed], components: [row] };
}

async function updateAutoBuyPanel() {
    if (!moneyConfig?.channelId) return;
    try {
        const channel = await client.channels.fetch(String(moneyConfig.channelId));
        if (moneyConfig.messageId) {
            const message = await channel.messages.fetch(String(moneyConfig.messageId));
            await message.edit(buildAutoBuyEmbed());
            return;
        }
        const newMessage = await channel.send(buildAutoBuyEmbed());
        moneyConfig.messageId = newMessage.id; writeJson(CONFIG_FILE, moneyConfig);
    } catch (err) { }
}

function adminOverwrite(guildId) {
    if (!process.env.ADMIN_DISCORD_ID) return [];
    return [{ id: process.env.ADMIN_DISCORD_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }];
}

// ============================================================
// 5. TƯƠNG TÁC DISCORD
// ============================================================
client.on(Events.InteractionCreate, async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'setup') {
                const msg = await interaction.channel.send(buildAutoBuyEmbed());
                moneyConfig.channelId = interaction.channelId; moneyConfig.messageId = msg.id; writeJson(CONFIG_FILE, moneyConfig);
                return interaction.reply({ content: '✅ Đã tạo bảng giao dịch.', flags: MessageFlags.Ephemeral });
            }
        }

        if (interaction.isButton()) {
            const id = interaction.customId;

            // ĐÓNG TICKET THỦ CÔNG
            if (id === 'close_ticket') {
                await interaction.reply({ content: '🔒 Vé sẽ bị xóa sau 5 giây...' });
                return setTimeout(() => interaction.channel.delete().catch(()=> {}), 5000);
            }

            // MUA TÀI KHOẢN (BÁN THỦ CÔNG)
            if (id === 'buy_acc') {
                const modal = new ModalBuilder().setCustomId('modal_acc').setTitle('Yêu Cầu Mua Tài Khoản');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('acc_note').setLabel('Ghi chú loại tài khoản muốn mua').setStyle(TextInputStyle.Paragraph).setRequired(true))
                );
                return await interaction.showModal(modal);
            }

            if (id === 'buy_bank') {
                const modal = new ModalBuilder().setCustomId('modal_bank').setTitle(`Mua Tiền - Giá ${RATE} VNĐ/1M`);
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bank_name').setLabel('Tên Ingame').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bank_vnd').setLabel('Số tiền thanh toán').setStyle(TextInputStyle.Short).setRequired(true))
                );
                return await interaction.showModal(modal);
            }

            if (id === 'buy_card') {
                const modal = new ModalBuilder().setCustomId('modal_card').setTitle(`Nạp Thẻ - Giá ${RATE} VNĐ/1M`);
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_ign').setLabel('Tên Ingame').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_type').setLabel('Nhà Mạng').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_val').setLabel('Mệnh Giá').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_code').setLabel('Mã Thẻ').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_seri').setLabel('Số Seri').setStyle(TextInputStyle.Short).setRequired(true))
                );
                return await interaction.showModal(modal);
            }
        }

        if (interaction.isModalSubmit()) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            // TẠO TICKET TÀI KHOẢN (THỦ CÔNG)
            if (interaction.customId === 'modal_acc') {
                const note = interaction.fields.getTextInputValue('acc_note');
                const ticketChannel = await interaction.guild.channels.create({
                    name: `vé-tài-khoản-${interaction.user.username}`,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                        ...adminOverwrite(interaction.guild.id)
                    ]
                });

                const embed = new EmbedBuilder().setTitle('🏷️ YÊU CẦU TÀI KHOẢN').setColor('#9b59b6')
                    .setDescription(`Yêu cầu từ: <@${interaction.user.id}>\nChi tiết: ${note}\n\n*Vui lòng chờ Admin (HaiSon) phản hồi để giao dịch.*`);
                
                const closeRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Vé (Xóa)').setStyle(ButtonStyle.Danger));
                await ticketChannel.send({ content: `<@${interaction.user.id}> | <@&ROLE_ADMIN_ID_NEU_CO>`, embeds: [embed], components: [closeRow] });
                
                return interaction.editReply(`✅ Đã tạo vé tại: ${ticketChannel}`);
            }

            // TẠO TICKET TIỀN (AUTO)
            if (interaction.customId === 'modal_bank') {
                const ign = interaction.fields.getTextInputValue('bank_name').trim();
                const vndAmount = Math.floor(parseCardValue(interaction.fields.getTextInputValue('bank_vnd')));
                const moneyReceivedM = Math.floor(vndAmount / RATE);

                const orderId = `M${Date.now()}`;
                const memo = `KSMP ${orderId}`;
                const qrUrl = `https://img.vietqr.io/image/${BANK_CONFIG.BANK_ID}-${BANK_CONFIG.ACCOUNT_NO}-compact2.png?amount=${vndAmount}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(BANK_CONFIG.ACCOUNT_NAME)}`;

                const ticketChannel = await interaction.guild.channels.create({
                    name: `vé-tiền-${ign.toLowerCase()}`,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                        ...adminOverwrite(interaction.guild.id)
                    ]
                });

                const orders = getMoneyOrders();
                orders[orderId] = { id: orderId, type: 'bank', userId: interaction.user.id, ign, vndAmount, amountM: moneyReceivedM, memo, status: 'dang_cho', ticketChannelId: ticketChannel.id };
                saveMoneyOrders(orders);

                const embed = new EmbedBuilder().setTitle('💳 CHUYỂN KHOẢN').setColor('#3498db').setDescription('Chuyển đúng nội dung để hệ thống tự động nạp.')
                    .addFields({ name: 'Tên Ingame', value: ign, inline: true }, { name: 'Sẽ Nhận', value: `${moneyReceivedM} M`, inline: true }, { name: 'Thanh Toán', value: `${vndAmount} VNĐ`, inline: true }, { name: 'NỘI DUNG', value: `\`\`\`${memo}\`\`\`` }).setImage(qrUrl);
                const closeRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Vé (Xóa)').setStyle(ButtonStyle.Danger));
                
                await ticketChannel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [closeRow] });
                return interaction.editReply(`✅ Đã tạo vé tại: ${ticketChannel}`);
            }
        }
    } catch (err) { }
});

client.once(Events.ClientReady, async c => {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(c.user.id), { body: [new SlashCommandBuilder().setName('setup').setDescription('Tạo bảng điều khiển HaiSon').toJSON()] });
    console.log(`🤖 Bot online: ${c.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
