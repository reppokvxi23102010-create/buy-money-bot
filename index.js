require('dotenv').config();

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
    Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, Events, PermissionsBitField
} = require('discord.js');

// ============================================================
// 1. MÁY CHỦ WEB (WEBHOOKS - CHỈ AUTO NGÂN HÀNG SEPAY)
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

// Xử lý Ngân hàng (SePay) - Tự động 100%
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
        console.error('❌ Lỗi SePay:', err);
        return sendJson(res, 500, { success: false });
    }
}

const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/webhook/sepay') return handleSepayWebhook(req, res);
    return sendJson(res, 404, { success: false, message: 'Khong tim thay' });
});
server.listen(PORT, () => console.log(`[Hệ thống] Mở cổng thành công trên Port: ${PORT}`));


// ============================================================
// 2. CẤU HÌNH & DỮ LIỆU
// ============================================================
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

const CARD_DISCOUNT = 0.20;
// Thông tin MB Bank chính chủ của ông
const BANK_CONFIG = { BANK_ID: 'MB', ACCOUNT_NO: '0357597469', ACCOUNT_NAME: 'TRAN HUU HAI SON' };

const STOCK_FILE = path.join(__dirname, 'stock.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const MONEY_ORDERS_FILE = path.join(__dirname, 'money_orders.json');

function readJson(file, fallback) {
    try { if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback, null, 2)); return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }

let currentStockM = readJson(STOCK_FILE, { stockM: 2650000 }).stockM;
let moneyConfig = readJson(CONFIG_FILE, { rate: 120 });
let RATE = Number(moneyConfig.rate) > 0 ? Number(moneyConfig.rate) : 120;

function saveStock(amountM) { writeJson(STOCK_FILE, { stockM: Math.max(0, Number(amountM) || 0) }); currentStockM = amountM; }
function getMoneyOrders() { return readJson(MONEY_ORDERS_FILE, {}); }
function saveMoneyOrders(data) { writeJson(MONEY_ORDERS_FILE, data); }

function formatStockDisplay(amountM) {
    if (amountM >= 1000) {
        const b = (amountM / 1000).toFixed(2);
        return `${b}B$ (${amountM.toLocaleString()}M$)`;
    }
    return `${amountM.toLocaleString()}M$`;
}

function parseMoneyToM(input) {
    let str = String(input).trim().toLowerCase().replace(/[\s,]/g, '');
    let multiplier = 1;
    if (str.endsWith('b')) { multiplier = 1000; str = str.slice(0, -1); } 
    else if (str.endsWith('m')) { multiplier = 1; str = str.slice(0, -1); } 
    else if (str.endsWith('k')) { multiplier = 0.001; str = str.slice(0, -1); }
    const value = Number(str);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return (multiplier !== 1 || /[bmk]$/.test(String(input).toLowerCase())) ? value * multiplier : (value >= 10000 ? value / 1000000 : value);
}

function parseCardValue(input) {
    let str = String(input).trim().toLowerCase().replace(/[\s,.]/g, '');
    let multiplier = 1;
    if (str.endsWith('k')) { multiplier = 1000; str = str.slice(0, -1); } 
    else if (str.endsWith('m')) { multiplier = 1000000; str = str.slice(0, -1); }
    const value = Number(str);
    return Math.floor(value * multiplier) || 0;
}

// ============================================================
// 3. RCON & NẠP TỰ ĐỘNG (DÀNH CHO NGÂN HÀNG)
// ============================================================
async function sendMinecraftPayCommand(order) {
    const host = process.env.RCON_HOST;
    const port = Number(process.env.RCON_PORT || 25575);
    const password = process.env.RCON_PASSWORD;

    if (!host || !password) return { ok: false, message: 'Chưa cài đặt RCON.' };
    let Rcon; try { ({ Rcon } = require('rcon-client')); } catch { return { ok: false, message: 'Thiếu gói rcon-client.' }; }

    const command = `pay ${order.ign} ${Math.floor(Number(order.amountM) || 0)}`;
    const rcon = new Rcon({ host, port, password });

    try {
        await rcon.connect();
        await rcon.send(command);
        await rcon.end();
        return { ok: true };
    } catch (err) {
        try { await rcon.end(); } catch {}
        return { ok: false, message: 'Không kết nối được server Minecraft.' };
    }
}

async function fulfillMoneyOrder(order) {
    const amountM = Math.floor(Number(order.amountM) || 0);
    
    currentStockM -= amountM;
    saveStock(currentStockM);

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
                    .setTitle(payResult.ok ? '✅ NẠP TIỀN THÀNH CÔNG' : '⚠️ LỖI RCON MÁY CHỦ')
                    .setColor(payResult.ok ? '#2ecc71' : '#e67e22')
                    .setDescription(payResult.ok ? `Hệ thống đã tự động cộng **${amountM.toLocaleString()} M$** vào tài khoản: **${order.ign}**` : `Đã nhận tiền nhưng nạp lỗi: ${payResult.message}`);
                
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
// 4. GIAO DIỆN DISCORD CHUẨN MẪU
// ============================================================
function buildAutoBuyEmbed() {
    const isOutOfStock = currentStockM <= 0;
    const embed = new EmbedBuilder()
        .setColor('#2ecc71')
        .setTitle('🛒 HỆ THỐNG AUTO BUY MONEY KINGSMP')
        .setDescription(
            `🟢 **Trạng thái:** Hoạt động\n` +
            `⏰ **Giờ làm việc:** \`10h00 - 22h00\`\n` +
            `💸 **Tỷ giá:** \`${RATE} VNĐ = 1M$\`\n` +
            `🎟️ **Thẻ cào:** Trừ ${CARD_DISCOUNT * 100}% mệnh giá\n` +
            `📦 **Kho:** \`${formatStockDisplay(currentStockM)}\`\n\n` +
            `💰 **Chọn phương thức mua bên dưới:**`
        );

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('buy_bank').setLabel('💳 Mua Bằng Ngân Hàng').setStyle(ButtonStyle.Success).setDisabled(isOutOfStock),
        new ButtonBuilder().setCustomId('buy_card').setLabel('🎟️ Mua Bằng Thẻ Cào (-20%)').setStyle(ButtonStyle.Primary).setDisabled(isOutOfStock)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('calc_money').setLabel('🧮 Tính Tiền').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('guide_buy').setLabel('📖 Hướng Dẫn').setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row1, row2] };
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
// 5. SỰ KIỆN TƯƠNG TÁC
// ============================================================
client.on(Events.InteractionCreate, async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'setup') {
                const msg = await interaction.channel.send(buildAutoBuyEmbed());
                moneyConfig.channelId = interaction.channelId; moneyConfig.messageId = msg.id; writeJson(CONFIG_FILE, moneyConfig);
                return interaction.reply({ content: '✅ Đã tạo bảng giao dịch thành công.', ephemeral: true });
            }
            if (interaction.commandName === 'setstock') {
                currentStockM = parseMoneyToM(interaction.options.getString('amount'));
                saveStock(currentStockM); await updateAutoBuyPanel();
                return interaction.reply({ content: `✅ Đã cập nhật kho: **${formatStockDisplay(currentStockM)}**`, ephemeral: true });
            }
            if (interaction.commandName === 'rate') {
                RATE = interaction.options.getInteger('value'); moneyConfig.rate = RATE;
                writeJson(CONFIG_FILE, moneyConfig); await updateAutoBuyPanel();
                return interaction.reply({ content: `✅ Đã đổi tỷ giá thành: **${RATE} VNĐ = 1M$**`, ephemeral: true });
            }
        }

        if (interaction.isButton()) {
            const id = interaction.customId;

            if (id === 'close_ticket') {
                await interaction.reply({ content: '🔒 Vé sẽ bị xóa sau 5 giây...', ephemeral: true });
                return setTimeout(() => interaction.channel.delete().catch(()=> {}), 5000);
            }

            if (id === 'guide_buy') {
                return interaction.reply({ 
                    content: '📖 **HƯỚNG DẪN MUA MONEY:**\n1. **Ngân hàng:** Điền tên, số tiền -> Quét QR chuyển khoản -> Bot tự động nạp vào game sau 1 phút.\n2. **Thẻ cào:** Điền thông tin thẻ -> Bot tạo vé gửi thông tin cho Admin kiểm tra và duyệt thủ công.', 
                    ephemeral: true 
                });
            }

            if (id === 'calc_money') {
                const modal = new ModalBuilder().setCustomId('modal_calc').setTitle('🧮 Máy Tính Nhanh Tỷ Giá');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('calc_input').setLabel('Nhập số tiền VNĐ hoặc số M$ muốn đổi').setStyle(TextInputStyle.Short).setRequired(true))
                );
                return await interaction.showModal(modal);
            }

            if (id === 'buy_bank') {
                const modal = new ModalBuilder().setCustomId('modal_bank').setTitle(`Mua Tiền (Ngân Hàng) - Giá ${RATE} VNĐ/1M$`);
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bank_name').setLabel('Tên Ingame (Minecraft)').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bank_vnd').setLabel('Số tiền thanh toán (VNĐ)').setStyle(TextInputStyle.Short).setRequired(true))
                );
                return await interaction.showModal(modal);
            }

            if (id === 'buy_card') {
                const modal = new ModalBuilder().setCustomId('modal_card').setTitle(`Nạp Thẻ Cào (Admin Duyệt) - Trừ 20%`);
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_ign').setLabel('Tên Ingame (Minecraft)').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_type').setLabel('Nhà Mạng (Viettel, Mobi, Vina)').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_val').setLabel('Mệnh Giá Thẻ').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_code').setLabel('Mã Thẻ (PIN)').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_seri').setLabel('Số Seri Thẻ').setStyle(TextInputStyle.Short).setRequired(true))
                );
                return await interaction.showModal(modal);
            }
        }

        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'modal_calc') {
                const rawVal = interaction.fields.getTextInputValue('calc_input').trim();
                const num = parseCardValue(rawVal);
                if (num > 50000) {
                    const received = Math.floor(num / RATE);
                    return interaction.reply({ content: `🧮 **${num.toLocaleString()} VNĐ** đổi được khoảng **${received.toLocaleString()} M$** (Tỷ giá: ${RATE})`, ephemeral: true });
                } else {
                    const moneyM = parseMoneyToM(rawVal);
                    const costVnd = Math.floor(moneyM * RATE);
                    return interaction.reply({ content: `🧮 **${moneyM.toLocaleString()} M$** có giá là **${costVnd.toLocaleString()} VNĐ** (Tỷ giá: ${RATE})`, ephemeral: true });
                }
            }

            await interaction.deferReply({ ephemeral: true });

            // Ngân hàng: Tạo vé kèm QR chuẩn MB Bank
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

                const embed = new EmbedBuilder().setTitle('💳 THANH TOÁN CHUYỂN KHOẢN').setColor('#3498db').setDescription('Vui lòng quét mã QR hoặc chuyển khoản đúng thông tin dưới đây để hệ thống tự động nạp tiền.')
                    .addFields(
                        { name: 'Ngân hàng', value: 'MB Bank', inline: true },
                        { name: 'Số tài khoản', value: `\`${BANK_CONFIG.ACCOUNT_NO}\``, inline: true },
                        { name: 'Chủ tài khoản', value: BANK_CONFIG.ACCOUNT_NAME, inline: true },
                        { name: 'Tên Ingame', value: ign, inline: true },
                        { name: 'Nhận Được', value: `${moneyReceivedM.toLocaleString()} M$`, inline: true },
                        { name: 'Cần Trả', value: `${vndAmount.toLocaleString()} VNĐ`, inline: true },
                        { name: 'NỘI DUNG CHUYỂN KHOẢN', value: `\`\`\`${memo}\`\`\`` }
                    ).setImage(qrUrl);
                const closeRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Vé (Xóa)').setStyle(ButtonStyle.Danger));
                
                await ticketChannel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [closeRow] });
                return interaction.editReply(`✅ Đã tạo vé ngân hàng tại: ${ticketChannel}`);
            }

            // Thẻ cào: Tạo vé gửi thông tin thẻ cho Admin duyệt thủ công
            if (interaction.customId === 'modal_card') {
                const ign = interaction.fields.getTextInputValue('card_ign').trim();
                const cardType = interaction.fields.getTextInputValue('card_type').trim();
                const cardVal = interaction.fields.getTextInputValue('card_val').trim();
                const cardCode = interaction.fields.getTextInputValue('card_code').trim();
                const cardSeri = interaction.fields.getTextInputValue('card_seri').trim();
                
                const cardValueVnd = Math.floor(parseCardValue(cardVal));
                const moneyReceivedM = Math.floor(cardValueVnd * (1 - CARD_DISCOUNT) / RATE);

                const ticketChannel = await interaction.guild.channels.create({
                    name: `vé-the-${ign.toLowerCase()}`,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                        ...adminOverwrite(interaction.guild.id)
                    ]
                });

                const embed = new EmbedBuilder()
                    .setTitle('🎟️ YÊU CẦU NẠP THẺ CÀO (CHỜ ADMIN DUYỆT)')
                    .setColor('#f1c40f')
                    .setDescription(`Khách hàng <@${interaction.user.id}> đã gửi thẻ cào. Admin vui lòng kiểm tra thông tin bên dưới:`)
                    .addFields(
                        { name: 'Tên Ingame', value: ign, inline: true },
                        { name: 'Nhà mạng', value: cardType, inline: true },
                        { name: 'Mệnh giá', value: `${cardValueVnd.toLocaleString()} VNĐ`, inline: true },
                        { name: 'Sẽ nhận', value: `${moneyReceivedM.toLocaleString()} M$`, inline: true },
                        { name: 'Mã Thẻ (PIN)', value: `\`${cardCode}\``, inline: false },
                        { name: 'Số Seri', value: `\`${cardSeri}\``, inline: false }
                    );

                const closeRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Vé (Xóa)').setStyle(ButtonStyle.Danger)
                );

                await ticketChannel.send({ content: `<@${interaction.user.id}> | <@&ROLE_ADMIN_ID_NEU_CO>`, embeds: [embed], components: [closeRow] });
                return interaction.editReply(`✅ Đã tạo vé thẻ cào tại: ${ticketChannel}`);
            }
        }
    } catch (err) { console.error(err); }
});

client.once(Events.ClientReady, async c => {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const commands = [
        new SlashCommandBuilder().setName('setup').setDescription('Tạo bảng giao dịch KingSMP'),
        new SlashCommandBuilder().setName('setstock').setDescription('Chỉnh sửa kho tiền').addStringOption(o=>o.setName('amount').setDescription('Số lượng, VD: 500m, 2.65b').setRequired(true)),
        new SlashCommandBuilder().setName('rate').setDescription('Đổi tỷ giá VNĐ/1M$').addIntegerOption(o=>o.setName('value').setDescription('Giá trị rate').setRequired(true))
    ];
    await rest.put(Routes.applicationCommands(c.user.id), { body: commands.map(c => c.toJSON()) });
    console.log(`🤖 Bot online: ${c.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
