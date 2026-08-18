require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');

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
    PermissionsBitField,
    ChannelType,
    Events
} = require('discord.js');

// ============================================================
// 1. WEB SERVER
// ============================================================

const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('SMP BOT AutoBuy Money + Account đang hoạt động 24/7!');
}).listen(PORT, () => {
    console.log(`[HTTP Server] Đã mở cổng thành công trên Port: ${PORT}`);
});

// ============================================================
// 2. CLIENT
// ============================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ============================================================
// 3. CONFIG
// ============================================================

const CARD_DISCOUNT = 0.20;

const BANK_CONFIG = {
    BANK_ID: 'MB',
    BIN: '970422',
    ACCOUNT_NO: '0357597469',
    ACCOUNT_NAME: 'TRAN HUU HAI SON'
};

const STOCK_FILE = path.join(__dirname, 'stock.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const ACC_STOCK_FILE = path.join(__dirname, 'accounts.json');
const ACC_DETAIL_FILE = path.join(__dirname, 'accounts_detail.json');
const MONEY_ORDERS_FILE = path.join(__dirname, 'money_orders.json');

// ============================================================
// 4. SAFE JSON HELPERS
// ============================================================

function ensureJsonFile(file, defaultValue) {
    try {
        if (!fs.existsSync(file)) {
            fs.writeFileSync(file, JSON.stringify(defaultValue, null, 2), 'utf8');
        }
    } catch (err) {
        console.error(`Lỗi tạo file ${file}:`, err.message);
    }
}

function readJson(file, fallback) {
    try {
        ensureJsonFile(file, fallback);
        const raw = fs.readFileSync(file, 'utf8');
        return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
        console.error(`Lỗi đọc ${file}:`, err.message);
        return fallback;
    }
}

function writeJson(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error(`Lỗi ghi ${file}:`, err.message);
        return false;
    }
}

// ============================================================
// 5. INTERACTION SAFETY
// ============================================================

const seenInteractions = new Set();

function claimInteraction(interaction) {
    if (seenInteractions.has(interaction.id)) return false;
    seenInteractions.add(interaction.id);
    setTimeout(() => {
        seenInteractions.delete(interaction.id);
    }, 10 * 60 * 1000);
    return true;
}

async function safeReply(interaction, data) {
    try {
        if (interaction.replied || interaction.deferred) {
            return await interaction.followUp(data);
        }
        return await interaction.reply(data);
    } catch (err) {
        if (err?.code === 40060) return null;
        console.error('Lỗi safeReply:', err.message);
        return null;
    }
}

async function safeDeferReply(interaction, data = {}) {
    try {
        if (interaction.replied || interaction.deferred) return true;
        await interaction.deferReply(data);
        return true;
    } catch (err) {
        if (err?.code === 40060) return false;
        console.error('Lỗi deferReply:', err.message);
        return false;
    }
}

async function safeDeferUpdate(interaction) {
    try {
        if (interaction.replied || interaction.deferred) return true;
        await interaction.deferUpdate();
        return true;
    } catch (err) {
        if (err?.code === 40060) return false;
        console.error('Lỗi deferUpdate:', err.message);
        return false;
    }
}

async function safeEditReply(interaction, data) {
    try {
        if (!interaction.replied && !interaction.deferred) {
            return await interaction.reply(data);
        }
        return await interaction.editReply(data);
    } catch (err) {
        console.error('Lỗi editReply:', err.message);
        return null;
    }
}

// ============================================================
// 6. ADMIN
// ============================================================

function isAdminUser(interaction) {
    const isAdminId =
        process.env.ADMIN_DISCORD_ID &&
        interaction.user?.id === process.env.ADMIN_DISCORD_ID;

    const hasAdminPerm =
        interaction.memberPermissions &&
        interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator);

    return Boolean(isAdminId || hasAdminPerm);
}

// ĐÃ SỬA: Lỗi crash khi process.env.ADMIN_DISCORD_ID không tồn tại
function adminOverwrite(guildId) {
    if (!process.env.ADMIN_DISCORD_ID) return [];

    return [{
        id: process.env.ADMIN_DISCORD_ID,
        allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.AttachFiles,
            PermissionsBitField.Flags.ManageChannels
        ]
    }];
}

// ============================================================
// 7. MONEY DATA
// ============================================================

function loadStock() {
    const data = readJson(STOCK_FILE, { stockM: 5000 });
    const amount = Number(data.stockM);
    return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

function saveStock(amountM) {
    writeJson(STOCK_FILE, {
        stockM: Math.max(0, Number(amountM) || 0)
    });
}

function loadMoneyConfig() {
    return readJson(CONFIG_FILE, {});
}

function saveMoneyConfig(data) {
    writeJson(CONFIG_FILE, data);
}

function getMoneyOrders() {
    return readJson(MONEY_ORDERS_FILE, {});
}

function saveMoneyOrders(data) {
    writeJson(MONEY_ORDERS_FILE, data);
}

let currentStockM = loadStock();
let moneyConfig = loadMoneyConfig();
let RATE = Number(moneyConfig.rate) > 0 ? Number(moneyConfig.rate) : 130;

function formatStock(moneyM) {
    moneyM = Number(moneyM) || 0;
    if (moneyM <= 0) return '🔴 HẾT HÀNG (0M$)';
    if (moneyM >= 1000) {
        return `${(moneyM / 1000).toFixed(2)}B$ (${moneyM.toLocaleString('vi-VN')}M$)`;
    }
    return `${moneyM.toLocaleString('vi-VN')}M$`;
}

// ============================================================
// 8. MONEY PARSERS
// ============================================================

function parseCardValue(input) {
    if (!input) return 0;
    let str = String(input).trim().toLowerCase().replace(/\s/g, '');
    let multiplier = 1;

    if (str.endsWith('k')) {
        multiplier = 1000;
        str = str.slice(0, -1);
    } else if (str.endsWith('m')) {
        multiplier = 1000000;
        str = str.slice(0, -1);
    }

    str = str.replace(/,/g, '').replace(/\./g, '');
    const value = Number(str);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.floor(value * multiplier);
}

function parseMoneyToM(input) {
    if (!input) return 0;
    let str = String(input).trim().toLowerCase().replace(/\s/g, '').replace(/,/g, '');
    let multiplier = 1;

    if (str.endsWith('b')) {
        multiplier = 1000;
        str = str.slice(0, -1);
    } else if (str.endsWith('m')) {
        multiplier = 1;
        str = str.slice(0, -1);
    } else if (str.endsWith('k')) {
        multiplier = 0.001;
        str = str.slice(0, -1);
    }

    const value = Number(str);
    if (!Number.isFinite(value) || value <= 0) return 0;

    if (multiplier !== 1 || /[bmk]$/.test(String(input).toLowerCase())) {
        return value * multiplier;
    }
    return value >= 10000 ? value / 1000000 : value;
}

// ============================================================
// 9. MONEY PANEL
// ============================================================

function buildAutoBuyEmbed() {
    const isOutOfStock = currentStockM <= 0;
    const stockText = formatStock(currentStockM);

    const embed = new EmbedBuilder()
        .setColor(isOutOfStock ? '#e74c3c' : '#2ecc71')
        .setTitle('🛒 HỆ THỐNG AUTO BUY MONEY KINGSMP')
        .setDescription(
            `🟢 **Trạng thái:** ${isOutOfStock ? '🔴 **ĐÃ ĐÓNG BOT (HẾT KHO)**' : 'Hoạt động 24/7'}\n` +
            `💸 **Tỷ giá:** \`${RATE} VNĐ = 1M$\`\n` +
            `🎟️ **Thẻ cào:** Trừ ${CARD_DISCOUNT * 100}% mệnh giá\n` +
            `📦 **Kho:** \`${stockText}\`\n\n` +
            (isOutOfStock ? '⚠️ Kho đã hết Money. Vui lòng chờ Admin cập nhật Stock!' : '💰 Chọn phương thức mua bên dưới:')
        )
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('buy_bank').setLabel('Mua Bằng Ngân Hàng').setEmoji('💵').setStyle(ButtonStyle.Success).setDisabled(isOutOfStock),
        new ButtonBuilder().setCustomId('buy_card').setLabel('Mua Bằng Thẻ Cào (-20%)').setEmoji('🎟️').setStyle(ButtonStyle.Primary).setDisabled(isOutOfStock),
        new ButtonBuilder().setCustomId('calc_price').setLabel('Tính Tiền').setEmoji('🧮').setStyle(ButtonStyle.Secondary).setDisabled(isOutOfStock),
        new ButtonBuilder().setCustomId('guide').setLabel('Hướng Dẫn').setEmoji('📖').setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row] };
}

async function updateAutoBuyPanel() {
    if (!moneyConfig?.channelId) return;

    try {
        const channel = await client.channels.fetch(String(moneyConfig.channelId));
        if (!channel || !channel.isTextBased()) return;

        if (moneyConfig.messageId) {
            try {
                const message = await channel.messages.fetch(String(moneyConfig.messageId));
                await message.edit(buildAutoBuyEmbed());
                return;
            } catch (err) {
                console.warn('⚠️ Panel cũ không tồn tại. Đang tạo mới...');
            }
        }

        moneyConfig.messageId = null;
        saveMoneyConfig(moneyConfig);

        const newMessage = await channel.send(buildAutoBuyEmbed());
        moneyConfig = { channelId: channel.id, messageId: newMessage.id, rate: RATE };
        saveMoneyConfig(moneyConfig);
    } catch (err) {
        console.error('❌ Lỗi cập nhật panel:', err.message);
    }
}

// ============================================================
// 10. MONEY COMMANDS
// ============================================================

async function handleMoneyCommand(interaction) {
    if (!isAdminUser(interaction)) {
        return safeReply(interaction, { content: '❌ Bạn không có quyền Administrator!', ephemeral: true });
    }

    if (interaction.commandName === 'setup') {
        if (!(await safeDeferReply(interaction, { ephemeral: true }))) return;
        try {
            const msg = await interaction.channel.send(buildAutoBuyEmbed());
            moneyConfig.channelId = interaction.channelId;
            moneyConfig.messageId = msg.id;
            saveMoneyConfig(moneyConfig);
            return safeEditReply(interaction, { content: '✅ Đã thiết lập Bảng AutoBuy Money cố định thành công!' });
        } catch (err) {
            return safeEditReply(interaction, { content: `❌ Lỗi: \`${err.message}\`` });
        }
    }

    if (interaction.commandName === 'setstock') {
        if (!(await safeDeferReply(interaction, { ephemeral: true }))) return;
        try {
            const amountInput = interaction.options.getString('amount');
            const amountM = parseMoneyToM(amountInput);

            if (amountM <= 0) {
                return safeEditReply(interaction, { content: '❌ Số Stock không hợp lệ. Ví dụ: `500m`, `10b`.' });
            }

            currentStockM = amountM;
            saveStock(currentStockM);
            await updateAutoBuyPanel();

            return safeEditReply(interaction, { content: `✅ Kho Money hiện tại: **${formatStock(currentStockM)}**` });
        } catch (err) {
            return safeEditReply(interaction, { content: `❌ Thất bại: \`${err.message}\`` });
        }
    }

    if (interaction.commandName === 'rate') {
        if (!(await safeDeferReply(interaction, { ephemeral: true }))) return;
        try {
            const newRate = interaction.options.getInteger('value');
            if (!Number.isInteger(newRate) || newRate <= 0) {
                return safeEditReply(interaction, { content: '❌ Rate không hợp lệ.' });
            }

            RATE = newRate;
            moneyConfig.rate = RATE;
            saveMoneyConfig(moneyConfig);
            await updateAutoBuyPanel();

            return safeEditReply(interaction, { content: `✅ Đã đổi Rate thành **${RATE}đ / 1M$**` });
        } catch (err) {
            return safeEditReply(interaction, { content: `❌ Không thể đổi Rate: \`${err.message}\`` });
        }
    }
}

// ============================================================
// 11. MONEY BUTTONS
// ============================================================

async function handleMoneyButton(interaction) {
    const id = interaction.customId;

    if (id.startsWith('money_approve_') || id.startsWith('money_reject_')) {
        if (!isAdminUser(interaction)) {
            return safeReply(interaction, { content: '❌ Chỉ Admin mới có quyền duyệt!', ephemeral: true });
        }

        if (!(await safeDeferUpdate(interaction))) return;

        const isApprove = id.startsWith('money_approve_');
        const orderId = id.replace(isApprove ? 'money_approve_' : 'money_reject_', '');

        const orders = getMoneyOrders();
        const order = orders[orderId];

        if (!order) {
            return safeEditReply(interaction, { content: '❌ Không tìm thấy đơn hàng này.', components: [] });
        }

        if (order.status === 'approved') {
            return safeEditReply(interaction, { content: `⚠️ Đơn \`${orderId}\` đã được duyệt trước đó.`, components: [] });
        }

        if (isApprove) {
            if (currentStockM < order.amountM) {
                return safeEditReply(interaction, {
                    content: `❌ Kho không đủ!\nCần: **${order.amountM.toLocaleString('vi-VN')}M$**\nCòn: **${formatStock(currentStockM)}**`
                });
            }

            currentStockM -= order.amountM;
            saveStock(currentStockM);

            order.status = 'approved';
            order.approvedBy = interaction.user.id;
            order.approvedAt = Date.now();
            orders[orderId] = order;
            saveMoneyOrders(orders);

            await updateAutoBuyPanel();

            const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor('#2ecc71')
                .setTitle('✅ ĐƠN ĐÃ ĐƯỢC DUYỆT')
                .addFields({
                    name: '📌 Trạng thái',
                    value: `✅ Duyệt bởi <@${interaction.user.id}>\n📉 Đã trừ **${order.amountM.toLocaleString('vi-VN')}M$**`
                });

            const closeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('money_done').setLabel('✅ Đã Duyệt Đơn').setStyle(ButtonStyle.Success).setDisabled(true),
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
            );

            await safeEditReply(interaction, { embeds: [updatedEmbed], components: [closeRow] });

            try {
                const user = await client.users.fetch(order.userId);
                await user.send(`🎉 **Đơn nạp của bạn đã được duyệt!** Money nhận: **${order.amountM.toLocaleString('vi-VN')}M$**`);
            } catch (err) {}

            return;
        }

        // REJECT
        order.status = 'rejected';
        order.rejectedBy = interaction.user.id;
        order.rejectedAt = Date.now();
        orders[orderId] = order;
        saveMoneyOrders(orders);

        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor('#e74c3c')
            .setTitle('❌ ĐƠN TẠM BỊ TỪ CHỐI');

        const activeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`money_approve_${orderId}`).setLabel('Duyệt Lại Đơn').setEmoji('✅').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
        );

        await safeEditReply(interaction, { embeds: [updatedEmbed], components: [activeRow] });
        return;
    }

    if (currentStockM <= 0 && id !== 'guide') {
        return safeReply(interaction, { content: '🔴 **Hệ thống đang tạm HẾT KHO.**', ephemeral: true });
    }

    if (id === 'buy_bank') {
        const modal = new ModalBuilder().setCustomId('modal_bank').setTitle(`Mua Bank - Rate ${RATE}đ/1M`);
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bank_name').setLabel('Tên Ingame').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bank_vnd').setLabel('Số tiền nạp (VNĐ)').setStyle(TextInputStyle.Short).setPlaceholder('10k, 20k...').setRequired(true))
        );
        return await interaction.showModal(modal);
    }

    if (id === 'buy_card') {
        const modal = new ModalBuilder().setCustomId('modal_card').setTitle(`Nạp Thẻ - Rate ${RATE}đ/1M`);
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_ign').setLabel('Tên Ingame').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_type').setLabel('Loại thẻ').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_val').setLabel('Mệnh giá thẻ').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_code').setLabel('Mã thẻ (Pin)').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_seri').setLabel('Mã Seri').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return await interaction.showModal(modal);
    }

    if (id === 'calc_price') {
        const modal = new ModalBuilder().setCustomId('modal_calc').setTitle('Tính Tiền Money');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('calc_money').setLabel('Nhập số Money (b, m, k)').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return await interaction.showModal(modal);
    }

    if (id === 'guide') {
        return safeReply(interaction, {
            content: `📖 **HƯỚNG DẪN MUA MONEY**\n• Rate Bank: **${RATE} VNĐ = 1M$**\n• Thẻ cào: trừ **20%**\n• Kho: **${formatStock(currentStockM)}**`,
            ephemeral: true
        });
    }
}

// ============================================================
// 12. MONEY MODALS
// ============================================================

async function handleMoneyModal(interaction) {
    if (interaction.customId === 'modal_bank') {
        const ign = interaction.fields.getTextInputValue('bank_name').trim();
        const rawVnd = interaction.fields.getTextInputValue('bank_vnd');
        const vndAmount = Math.floor(parseCardValue(rawVnd));
        const moneyReceivedM = vndAmount > 0 ? Math.floor(vndAmount / RATE) : 0;

        if (vndAmount < 1000 || moneyReceivedM <= 0) {
            return safeReply(interaction, { content: '❌ Số tiền nạp không hợp lệ!', ephemeral: true });
        }

        if (moneyReceivedM > currentStockM) {
            return safeReply(interaction, { content: `❌ Kho không đủ! Còn lại: ${formatStock(currentStockM)}`, ephemeral: true });
        }

        if (!(await safeDeferReply(interaction, { ephemeral: true }))) return;

        const orderId = `M${Date.now()}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
        const memo = `KSMP ${ign}`;
        const qrUrl = `https://img.vietqr.io/image/${BANK_CONFIG.BANK_ID}-${BANK_CONFIG.ACCOUNT_NO}-compact2.png?amount=${vndAmount}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(BANK_CONFIG.ACCOUNT_NAME)}`;

        const orders = getMoneyOrders();
        orders[orderId] = {
            id: orderId, type: 'bank', userId: interaction.user.id, username: interaction.user.username,
            ign, vndAmount, amountM: moneyReceivedM, status: 'pending', createdAt: Date.now()
        };
        saveMoneyOrders(orders);

        try {
            const ticketChannel = await interaction.guild.channels.create({
                name: `ticket-bank-${ign.toLowerCase().replace(/[^a-z0-9-_]/gi, '').slice(0, 70)}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] },
                    ...adminOverwrite(interaction.guild.id)
                ]
            });

            await ticketChannel.setTopic(`moneyOrder:${orderId}`);

            const qrEmbed = new EmbedBuilder()
                .setTitle('💳 THÔNG TIN CHUYỂN KHOẢN BANK')
                .setColor('#3498db')
                .setDescription(`Chào <@${interaction.user.id}>!\nVui lòng CK đúng thông tin. Sau khi chuyển, gửi bill vào đây.`)
                .addFields(
                    { name: '👤 Ingame', value: `\`${ign}\``, inline: true },
                    { name: '💰 Money nhận', value: `\`${moneyReceivedM.toLocaleString('vi-VN')}M$\``, inline: true },
                    { name: '💵 Số tiền', value: `\`${vndAmount.toLocaleString('vi-VN')} VNĐ\``, inline: true },
                    { name: '🏦 STK', value: `\`${BANK_CONFIG.ACCOUNT_NO}\` (${BANK_CONFIG.BANK_ID})` },
                    { name: '📌 Nội dung CK', value: `\`\`\`${memo}\`\`\`` }
                )
                .setImage(qrUrl);

            const adminRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`money_approve_${orderId}`).setLabel('Duyệt Đơn').setEmoji('✅').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`money_reject_${orderId}`).setLabel('Từ Chối').setEmoji('❌').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
            );

            await ticketChannel.send({ content: `<@${interaction.user.id}>`, embeds: [qrEmbed], components: [adminRow] });
            return safeEditReply(interaction, { content: `✅ **ĐÃ TẠO TICKET:** ${ticketChannel}` });
        } catch (err) {
            delete orders[orderId];
            saveMoneyOrders(orders);
            return safeEditReply(interaction, { content: `❌ Tạo Ticket thất bại: \`${err.message}\`` });
        }
    }

    if (interaction.customId === 'modal_calc') {
        const rawInput = interaction.fields.getTextInputValue('calc_money');
        const moneyM = parseMoneyToM(rawInput);
        if (moneyM <= 0) return safeReply(interaction, { content: '❌ Số Money không hợp lệ.', ephemeral: true });

        const priceBankVnd = Math.round(moneyM * RATE);
        const requiredCardVnd = Math.round(priceBankVnd / (1 - CARD_DISCOUNT));

        return safeReply(interaction, {
            content: `🧮 **TÍNH GIÁ MONEY:**\n• Mua: **${moneyM.toLocaleString('vi-VN')}M$**\n💵 Bank: **${priceBankVnd.toLocaleString('vi-VN')} VNĐ**\n🎟️ Thẻ: **${requiredCardVnd.toLocaleString('vi-VN')} VNĐ**`,
            ephemeral: true
        });
    }
}

// ============================================================
// 13. ACCOUNT DATA & HELPERS
// ============================================================

function getAccStock() { return readJson(ACC_STOCK_FILE, []); }
function saveAccStock(data) { writeJson(ACC_STOCK_FILE, data); }
function getDetailedAccs() { return readJson(ACC_DETAIL_FILE, []); }
function saveDetailedAccs(data) { writeJson(ACC_DETAIL_FILE, data); }

function createAccEmbed(acc) {
    return new EmbedBuilder()
        .setColor(acc.status === 'available' ? '#2ecc71' : acc.status === 'pending' ? '#f1c40f' : '#e74c3c')
        .setTitle(`🎮 ${acc.username}`)
        .setDescription(
            `🏷️ **Giá Bank:** ${acc.priceBank.toLocaleString('vi-VN')} VNĐ\n` +
            `🎟️ **Giá Thẻ:** ${acc.priceCard.toLocaleString('vi-VN')} VNĐ\n` +
            `✅ **Trạng thái:** ${acc.status === 'available' ? '🟢 Có Sẵn' : acc.status === 'pending' ? '🟡 Đang Giao Dịch' : '🔴 Đã Bán'}`
        )
        .addFields(
            { name: '👕 Cape Số Lượng', value: `\`${acc.capeCount}\``, inline: true },
            { name: '✨ Cape Chi Tiết', value: `\`${acc.capeList || 'Không'}\``, inline: true },
            { name: '⭐ Rank', value: `\`${acc.rank}\`` }
        );
}

// ============================================================
// 14. CLOSE TICKET & HANDLERS
// ============================================================

async function handleCloseTicket(interaction) {
    if (!isAdminUser(interaction)) {
        return safeReply(interaction, { content: '❌ Chỉ Admin mới có quyền đóng Ticket!', ephemeral: true });
    }

    await safeReply(interaction, { content: '🔒 Kênh Ticket sẽ xóa sau 5 giây...' });
    setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
}

// ============================================================
// 15. SLASH COMMANDS & REGISTRATION
// ============================================================

const commands = [
    new SlashCommandBuilder().setName('setup').setDescription('Thiết lập Bảng AutoBuy Money'),
    new SlashCommandBuilder().setName('setstock').setDescription('Cập nhật kho Money').addStringOption(o => o.setName('amount').setDescription('Ví dụ: 10b, 500m').setRequired(true)),
    new SlashCommandBuilder().setName('rate').setDescription('Đổi tỷ giá Money').addIntegerOption(o => o.setName('value').setDescription('Rate mới (VNĐ/1M)').setRequired(true))
];

async function registerSlashCommands() {
    const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
    const clientId = process.env.CLIENT_ID || process.env.APPLICATION_ID;

    if (!token || !clientId) return;

    const rest = new REST({ version: '10' }).setToken(token);
    try {
        await rest.put(Routes.applicationCommands(clientId), { body: commands.map(c => c.toJSON()) });
        console.log('✅ Đã cập nhật Slash Commands thành công!');
    } catch (error) {
        console.error('❌ Lỗi đăng ký Slash Commands:', error.message);
    }
}

// ============================================================
// 16. EVENTS
// ============================================================

client.on(Events.InteractionCreate, async interaction => {
    try {
        if (!claimInteraction(interaction)) return;

        if (interaction.isChatInputCommand()) {
            return await handleMoneyCommand(interaction);
        }
        if (interaction.isButton()) {
            if (interaction.customId === 'close_ticket') return await handleCloseTicket(interaction);
            return await handleMoneyButton(interaction);
        }
        if (interaction.isModalSubmit()) {
            return await handleMoneyModal(interaction);
        }
    } catch (err) {
        console.error('❌ Lỗi Interaction:', err);
    }
});

client.once(Events.ClientReady, async c => {
    console.log(`🤖 Bot đã online: ${c.user.tag}`);
    await registerSlashCommands();
    await updateAutoBuyPanel();
});

// ============================================================
// 17. LOGIN
// ============================================================

const botToken = process.env.DISCORD_TOKEN || process.env.TOKEN;
if (botToken) {
    client.login(botToken);
} else {
    console.error('❌ Không tìm thấy BOT TOKEN trong .env!');
}
