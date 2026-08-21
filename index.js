// 1. Bắt tất cả các Promise bị reject mà không có .catch() (Lỗi API, SSL, Network)
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ [Unhandled Rejection] Bắt được lỗi Promise chưa xử lý:');
  console.error(reason);
});

// 2. Bắt các ngoại lệ đồng bộ chưa được bọc trong try-catch
process.on('uncaughtException', (err, origin) => {
  console.error('💥 [Uncaught Exception] Bắt được lỗi ngoại lệ toàn cục:');
  console.error(err);
});

// 3. Giám sát ngoại lệ nâng cao (Tránh trình cắm khác làm đứt đoạn log)
process.on('uncaughtExceptionMonitor', (err, origin) => {
  console.error('🔍 [Exception Monitor]:', err);
});
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
    MessageFlags,
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
    res.end('SMP BOT AutoBuy Money + Spawner + Account đang hoạt động 24/7!');
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
// 3. CONFIG & FILES
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
const MONEY_ORDERS_FILE = path.join(__dirname, 'money_orders.json');

// SPAWNER FILES
const SPAWNER_STOCK_FILE = path.join(__dirname, 'spawner_stock.json');
const SPAWNER_CONFIG_FILE = path.join(__dirname, 'spawner_config.json');
const SPAWNER_ORDERS_FILE = path.join(__dirname, 'spawner_orders.json');

const ACC_STOCK_FILE = path.join(__dirname, 'accounts.json');
const ACC_DETAIL_FILE = path.join(__dirname, 'accounts_detail.json');

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
        return JSON.parse(fs.readFileSync(file, 'utf8'));
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
        interaction.memberPermissions.has(
            PermissionsBitField.Flags.Administrator
        );

    return Boolean(isAdminId || hasAdminPerm);
}

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
// 7. MONEY DATA & WORKING HOURS LOGIC
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

function isWithinWorkingHours() {
    const config = loadMoneyConfig();
    const start = config.workingHours?.start ?? 10;
    const end = config.workingHours?.end ?? 22;

    const now = new Date();
    const currentHour = (now.getUTCHours() + 7) % 24;

    if (start <= end) {
        return currentHour >= start && currentHour < end;
    } else {
        return currentHour >= start || currentHour < end;
    }
}

function formatStock(moneyM) {
    moneyM = Number(moneyM) || 0;
    if (moneyM <= 0) return '🔴 HẾT HÀNG (0M$)';
    if (moneyM >= 1000) {
        return `${(moneyM / 1000).toFixed(2)}B$ (${moneyM.toLocaleString('vi-VN')}M$)`;
    }
    return `${moneyM.toLocaleString('vi-VN')}M$`;
}

// ============================================================
// 7.1. SPAWNER DATA & LOGIC
// ============================================================

function loadSpawnerStock() {
    const data = readJson(SPAWNER_STOCK_FILE, { stockSp: 50 });
    const amount = Number(data.stockSp);
    return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

function saveSpawnerStock(amountSp) {
    writeJson(SPAWNER_STOCK_FILE, {
        stockSp: Math.max(0, Number(amountSp) || 0)
    });
}

function loadSpawnerConfig() {
    return readJson(SPAWNER_CONFIG_FILE, { price: 50000 });
}

function saveSpawnerConfig(data) {
    writeJson(SPAWNER_CONFIG_FILE, data);
}

function getSpawnerOrders() {
    return readJson(SPAWNER_ORDERS_FILE, {});
}

function saveSpawnerOrders(data) {
    writeJson(SPAWNER_ORDERS_FILE, data);
}

let currentStockSp = loadSpawnerStock();
let spawnerConfig = loadSpawnerConfig();
let SPAWNER_PRICE = Number(spawnerConfig.price) > 0 ? Number(spawnerConfig.price) : 50000;

function formatSpawnerStock(stockSp) {
    stockSp = Number(stockSp) || 0;
    if (stockSp <= 0) return '🔴 HẾT HÀNG (0 Lồng)';
    return `${stockSp.toLocaleString('vi-VN')} Lồng Spawner`;
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
    const startHour = moneyConfig.workingHours?.start ?? 10;
    const endHour = moneyConfig.workingHours?.end ?? 22;

    const embed = new EmbedBuilder()
        .setColor(isOutOfStock ? '#e74c3c' : '#2ecc71')
        .setTitle('🛒 HỆ THỐNG AUTO BUY MONEY KINGSMP')
        .setDescription(
            `🟢 **Trạng thái:** ${isOutOfStock ? '🔴 **ĐÃ ĐÓNG BOT (HẾT KHO)**' : 'Hoạt động'}\n` +
            `⏰ **Giờ làm việc:** \`${startHour}h00 - ${endHour}h00\`\n` +
            `💸 **Tỷ giá:** \`${RATE} VNĐ = 1M$\`\n` +
            `🎟️ **Thẻ cào:** Trừ ${CARD_DISCOUNT * 100}% mệnh giá\n` +
            `📦 **Kho:** \`${stockText}\`\n\n` +
            (isOutOfStock ? '⚠️ Kho đã hết Money. Vui lòng chờ Admin cập nhật Stock!' : '💰 Chọn phương thức mua bên dưới:')
        )
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('buy_bank')
            .setLabel('Mua Bằng Ngân Hàng')
            .setEmoji('💵')
            .setStyle(ButtonStyle.Success)
            .setDisabled(isOutOfStock),

        new ButtonBuilder()
            .setCustomId('buy_card')
            .setLabel('Mua Bằng Thẻ Cào (-20%)')
            .setEmoji('🎟️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(isOutOfStock),

        new ButtonBuilder()
            .setCustomId('calc_price')
            .setLabel('Tính Tiền')
            .setEmoji('🧮')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(isOutOfStock),

        new ButtonBuilder()
            .setCustomId('guide')
            .setLabel('Hướng Dẫn')
            .setEmoji('📖')
            .setStyle(ButtonStyle.Secondary)
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
                moneyConfig.messageId = null;
                saveMoneyConfig(moneyConfig);
            }
        }

        const newMessage = await channel.send(buildAutoBuyEmbed());
        moneyConfig.messageId = newMessage.id;
        saveMoneyConfig(moneyConfig);
    } catch (err) {
        console.error('Lỗi updateAutoBuyPanel:', err.message);
    }
}

// ============================================================
// 9.1. SPAWNER PANEL
// ============================================================

function buildSpawnerAutoBuyEmbed() {
    const isOutOfStock = currentStockSp <= 0;
    const stockText = formatSpawnerStock(currentStockSp);
    const startHour = moneyConfig.workingHours?.start ?? 10;
    const endHour = moneyConfig.workingHours?.end ?? 22;

    const embed = new EmbedBuilder()
        .setColor(isOutOfStock ? '#e74c3c' : '#9b59b6')
        .setTitle('🛒 HỆ THỐNG AUTO BUY SPAWNER KINGSMP')
        .setDescription(
            `🟢 **Trạng thái:** ${isOutOfStock ? '🔴 **ĐÃ ĐÓNG BOT (HẾT KHO)**' : 'Hoạt động'}\n` +
            `⏰ **Giờ làm việc:** \`${startHour}h00 - ${endHour}h00\`\n` +
            `🏷️ **Giá Spawner:** \`${SPAWNER_PRICE.toLocaleString('vi-VN')} VNĐ / 1 Lồng\`\n` +
            `🎟️ **Thẻ cào:** Trừ ${CARD_DISCOUNT * 100}% mệnh giá\n` +
            `📦 **Kho:** \`${stockText}\`\n\n` +
            (isOutOfStock ? '⚠️ Kho đã hết Lồng Spawner. Vui lòng chờ Admin cập nhật Stock!' : '💰 Chọn phương thức mua bên dưới:')
        )
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('spawner_buy_bank')
            .setLabel('Mua Bằng Ngân Hàng')
            .setEmoji('💵')
            .setStyle(ButtonStyle.Success)
            .setDisabled(isOutOfStock),

        new ButtonBuilder()
            .setCustomId('spawner_buy_card')
            .setLabel('Mua Bằng Thẻ Cào (-20%)')
            .setEmoji('🎟️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(isOutOfStock),

        new ButtonBuilder()
            .setCustomId('spawner_calc_price')
            .setLabel('Tính Tiền')
            .setEmoji('🧮')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(isOutOfStock),

        new ButtonBuilder()
            .setCustomId('spawner_guide')
            .setLabel('Hướng Dẫn')
            .setEmoji('📖')
            .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row] };
}

async function updateSpawnerAutoBuyPanel() {
    if (!spawnerConfig?.channelId) return;
    try {
        const channel = await client.channels.fetch(String(spawnerConfig.channelId));
        if (!channel || !channel.isTextBased()) return;

        if (spawnerConfig.messageId) {
            try {
                const message = await channel.messages.fetch(String(spawnerConfig.messageId));
                await message.edit(buildSpawnerAutoBuyEmbed());
                return;
            } catch (err) {
                spawnerConfig.messageId = null;
                saveSpawnerConfig(spawnerConfig);
            }
        }

        const newMessage = await channel.send(buildSpawnerAutoBuyEmbed());
        spawnerConfig.messageId = newMessage.id;
        saveSpawnerConfig(spawnerConfig);
    } catch (err) {
        console.error('Lỗi updateSpawnerAutoBuyPanel:', err.message);
    }
}

// ============================================================
// 10. MONEY & SPAWNER COMMANDS
// ============================================================

async function handleMoneyCommand(interaction) {
    if (!isAdminUser(interaction)) {
        return safeReply(interaction, {
            content: '❌ Bạn không có quyền Administrator!',
            flags: MessageFlags.Ephemeral
        });
    }

    if (interaction.commandName === 'setup') {
        const sub = interaction.options.getSubcommand(false);
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;

        try {
            if (!sub || sub === 'money') {
                const msg = await interaction.channel.send(buildAutoBuyEmbed());
                moneyConfig.channelId = interaction.channelId;
                moneyConfig.messageId = msg.id;
                saveMoneyConfig(moneyConfig);
                return safeEditReply(interaction, { content: '✅ Đã thiết lập Bảng AutoBuy Money cố định thành công!' });
            } else if (sub === 'spawner') {
                const msg = await interaction.channel.send(buildSpawnerAutoBuyEmbed());
                spawnerConfig.channelId = interaction.channelId;
                spawnerConfig.messageId = msg.id;
                saveSpawnerConfig(spawnerConfig);
                return safeEditReply(interaction, { content: '✅ Đã thiết lập Bảng AutoBuy Spawner cố định thành công!' });
            }
        } catch (err) {
            return safeEditReply(interaction, { content: `❌ Lỗi: \`${err.message}\`` });
        }
    }

    if (interaction.commandName === 'setstock') {
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;
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

    if (interaction.commandName === 'setstockspawner') {
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;
        try {
            const amount = interaction.options.getInteger('amount');
            if (amount < 0) {
                return safeEditReply(interaction, { content: '❌ Số lượng không hợp lệ.' });
            }
            currentStockSp = amount;
            saveSpawnerStock(currentStockSp);
            await updateSpawnerAutoBuyPanel();
            return safeEditReply(interaction, { content: `✅ Kho Spawner hiện tại: **${formatSpawnerStock(currentStockSp)}**` });
        } catch (err) {
            return safeEditReply(interaction, { content: `❌ Thất bại: \`${err.message}\`` });
        }
    }

    if (interaction.commandName === 'rate') {
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;
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

    if (interaction.commandName === 'spawnerprice') {
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;
        try {
            const newPrice = interaction.options.getInteger('price');
            if (!Number.isInteger(newPrice) || newPrice <= 0) {
                return safeEditReply(interaction, { content: '❌ Giá không hợp lệ.' });
            }
            SPAWNER_PRICE = newPrice;
            spawnerConfig.price = SPAWNER_PRICE;
            saveSpawnerConfig(spawnerConfig);
            await updateSpawnerAutoBuyPanel();
            return safeEditReply(interaction, { content: `✅ Đã đổi giá Spawner thành **${SPAWNER_PRICE.toLocaleString('vi-VN')} VNĐ / 1 Lồng**` });
        } catch (err) {
            return safeEditReply(interaction, { content: `❌ Không thể đổi giá: \`${err.message}\`` });
        }
    }

    if (interaction.commandName === 'time') {
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;
        try {
            const start = interaction.options.getInteger('start');
            const end = interaction.options.getInteger('end');
            moneyConfig.workingHours = { start, end };
            saveMoneyConfig(moneyConfig);
            await updateAutoBuyPanel();
            await updateSpawnerAutoBuyPanel();
            return safeEditReply(interaction, { content: `✅ Đã cập nhật khung giờ làm việc thành: **${start}h00 - ${end}h00**` });
        } catch (err) {
            return safeEditReply(interaction, { content: `❌ Lỗi khi cập nhật giờ: \`${err.message}\`` });
        }
    }
}

// ============================================================
// 11. MONEY & SPAWNER BUTTONS
// ============================================================

async function handleMoneyButton(interaction) {
    const id = interaction.customId;

    // MONEY APPROVE / REJECT
    if (id.startsWith('money_approve_') || id.startsWith('money_reject_')) {
        if (!isAdminUser(interaction)) {
            return safeReply(interaction, { content: '❌ Chỉ Admin mới có quyền duyệt hoặc từ chối đơn!', flags: MessageFlags.Ephemeral });
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
                return safeEditReply(interaction, { content: `❌ Kho không đủ! Còn: **${formatStock(currentStockM)}**` });
            }
            currentStockM -= order.amountM;
            saveStock(currentStockM);
            order.status = 'approved';
            order.approvedBy = interaction.user.id;
            saveMoneyOrders(orders);
            await updateAutoBuyPanel();

            const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor('#2ecc71')
                .setTitle('✅ ĐƠN MONEY ĐÃ ĐƯỢC DUYỆT')
                .addFields({ name: '📌 Trạng thái', value: `✅ Duyệt bởi <@${interaction.user.id}>\n📉 Đã trừ **${order.amountM.toLocaleString('vi-VN')}M$**` });

            const closeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('money_done').setLabel('✅ Đã Duyệt Đơn').setStyle(ButtonStyle.Success).setDisabled(true),
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
            );

            await safeEditReply(interaction, { embeds: [updatedEmbed], components: [closeRow] });

            try {
                const user = await client.users.fetch(order.userId);
                await user.send(`🎉 **Đơn nạp Money của bạn đã được duyệt!**\n💰 Nhận: **${order.amountM.toLocaleString('vi-VN')}M$**`);
            } catch (err) {}
            return;
        }

        order.status = 'rejected';
        saveMoneyOrders(orders);
        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor('#e74c3c')
            .setTitle('❌ ĐƠN MONEY BỊ TỪ CHỐI');
        await safeEditReply(interaction, { embeds: [updatedEmbed], components: [] });
        return;
    }

    // SPAWNER APPROVE / REJECT
    if (id.startsWith('spawner_approve_') || id.startsWith('spawner_reject_')) {
        if (!isAdminUser(interaction)) {
            return safeReply(interaction, { content: '❌ Chỉ Admin mới có quyền duyệt hoặc từ chối đơn!', flags: MessageFlags.Ephemeral });
        }
        if (!(await safeDeferUpdate(interaction))) return;

        const isApprove = id.startsWith('spawner_approve_');
        const orderId = id.replace(isApprove ? 'spawner_approve_' : 'spawner_reject_', '');
        const orders = getSpawnerOrders();
        const order = orders[orderId];

        if (!order) {
            return safeEditReply(interaction, { content: '❌ Không tìm thấy đơn spawner này.', components: [] });
        }
        if (order.status === 'approved') {
            return safeEditReply(interaction, { content: `⚠️ Đơn \`${orderId}\` đã được duyệt trước đó.`, components: [] });
        }

        if (isApprove) {
            if (currentStockSp < order.quantity) {
                return safeEditReply(interaction, { content: `❌ Kho Spawner không đủ! Còn: **${formatSpawnerStock(currentStockSp)}**` });
            }
            currentStockSp -= order.quantity;
            saveSpawnerStock(currentStockSp);
            order.status = 'approved';
            order.approvedBy = interaction.user.id;
            saveSpawnerOrders(orders);
            await updateSpawnerAutoBuyPanel();

            const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor('#2ecc71')
                .setTitle('✅ ĐƠN SPAWNER ĐÃ ĐƯỢC DUYỆT')
                .addFields({ name: '📌 Trạng thái', value: `✅ Duyệt bởi <@${interaction.user.id}>\n📉 Đã trừ **${order.quantity} Lồng Spawner**` });

            const closeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('spawner_done').setLabel('✅ Đã Duyệt Đơn').setStyle(ButtonStyle.Success).setDisabled(true),
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
            );

            await safeEditReply(interaction, { embeds: [updatedEmbed], components: [closeRow] });

            try {
                const user = await client.users.fetch(order.userId);
                await user.send(`🎉 **Đơn mua Spawner của bạn đã được duyệt!**\n📦 Số lượng: **${order.quantity} Lồng Spawner**`);
            } catch (err) {}
            return;
        }

        order.status = 'rejected';
        saveSpawnerOrders(orders);
        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor('#e74c3c')
            .setTitle('❌ ĐƠN SPAWNER BỊ TỪ CHỐI');
        await safeEditReply(interaction, { embeds: [updatedEmbed], components: [] });
        return;
    }

    // CHECK WORKING HOURS & STOCK
    if (!isWithinWorkingHours() && !['guide', 'spawner_guide'].includes(id)) {
        const startHour = moneyConfig.workingHours?.start ?? 10;
        const endHour = moneyConfig.workingHours?.end ?? 22;
        return safeReply(interaction, {
            content: `🛑 **Shop hiện đã đóng cửa!**\n⏰ Giờ hoạt động của Bot: **${startHour}h00 - ${endHour}h00**.`,
            flags: MessageFlags.Ephemeral
        });
    }

    // MONEY BUTTONS
    if (id === 'buy_bank') {
        const modal = new ModalBuilder().setCustomId('modal_bank').setTitle(`Mua Bank - Rate ${RATE}đ/1M`);
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bank_name').setLabel('Tên Ingame').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bank_vnd').setLabel('Số tiền nạp (VNĐ)').setStyle(TextInputStyle.Short).setPlaceholder('Ví dụ: 10k, 20k, 50k').setRequired(true))
        );
        return await interaction.showModal(modal);
    }

    if (id === 'buy_card') {
        const modal = new ModalBuilder().setCustomId('modal_card').setTitle(`Nạp Thẻ - Rate ${RATE}đ/1M`);
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_ign').setLabel('Tên Ingame').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_type').setLabel('Loại thẻ').setStyle(TextInputStyle.Short).setPlaceholder('Viettel, Zing...').setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_val').setLabel('Mệnh giá thẻ').setStyle(TextInputStyle.Short).setPlaceholder('10k, 20k...').setRequired(true)),
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
            content: `📖 **HƯỚNG DẪN MUA MONEY KINGSMP**\n• Rate Bank: **${RATE} VNĐ = 1M$**\n• Thẻ cào: trừ **20%**\n• Kho: **${formatStock(currentStockM)}**`,
            flags: MessageFlags.Ephemeral
        });
    }

    // SPAWNER BUTTONS
    if (id === 'spawner_buy_bank') {
        const modal = new ModalBuilder().setCustomId('modal_spawner_bank').setTitle('Mua Spawner Qua Ngân Hàng');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('spawner_bank_name').setLabel('Tên Ingame').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('spawner_bank_qty').setLabel('Số lượng lồng muốn mua').setStyle(TextInputStyle.Short).setPlaceholder('Ví dụ: 1, 2, 5').setRequired(true))
        );
        return await interaction.showModal(modal);
    }

    if (id === 'spawner_buy_card') {
        const modal = new ModalBuilder().setCustomId('modal_spawner_card').setTitle('Mua Spawner Qua Thẻ Cào (-20%)');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('spawner_card_ign').setLabel('Tên Ingame').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('spawner_card_type').setLabel('Loại thẻ (Viettel, Mobi...)').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('spawner_card_val').setLabel('Mệnh giá thẻ').setStyle(TextInputStyle.Short).setPlaceholder('100k, 200k...').setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('spawner_card_code').setLabel('Mã thẻ (Pin)').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('spawner_card_seri').setLabel('Mã Seri').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return await interaction.showModal(modal);
    }

    if (id === 'spawner_calc_price') {
        const modal = new ModalBuilder().setCustomId('modal_spawner_calc').setTitle('Tính Tiền Spawner');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('spawner_calc_qty').setLabel('Nhập số lượng lồng spawner').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return await interaction.showModal(modal);
    }

    if (id === 'spawner_guide') {
        return safeReply(interaction, {
            content: `📖 **HƯỚNG DẪN MUA SPAWNER KINGSMP**\n• Giá: **${SPAWNER_PRICE.toLocaleString('vi-VN')} VNĐ / 1 Lồng**\n• Thẻ cào: trừ **20%**\n• Kho: **${formatSpawnerStock(currentStockSp)}**`,
            flags: MessageFlags.Ephemeral
        });
    }
}

// ============================================================
// 12. MONEY & SPAWNER MODALS
// ============================================================

async function handleMoneyModal(interaction) {
    // MONEY BANK MODAL
    if (interaction.customId === 'modal_bank') {
        const ign = interaction.fields.getTextInputValue('bank_name').trim();
        const rawVnd = interaction.fields.getTextInputValue('bank_vnd');
        const vndAmount = Math.floor(parseCardValue(rawVnd));
        const moneyReceivedM = vndAmount > 0 ? Math.floor(vndAmount / RATE) : 0;

        if (vndAmount < 1000 || moneyReceivedM <= 0) {
            return safeReply(interaction, { content: '❌ Số tiền không hợp lệ hoặc quá thấp.', flags: MessageFlags.Ephemeral });
        }
        if (moneyReceivedM > currentStockM) {
            return safeReply(interaction, { content: `❌ Kho không đủ! Còn: **${formatStock(currentStockM)}**`, flags: MessageFlags.Ephemeral });
        }

        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;

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
                name: `ticket-money-${ign.toLowerCase().replace(/[^a-z0-9-_]/gi, '').slice(0, 60)}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] },
                    ...adminOverwrite(interaction.guild.id)
                ]
            });

            await ticketChannel.setTopic(`moneyOrder:${orderId}`);

            const qrEmbed = new EmbedBuilder()
                .setTitle('💳 THANH TOÁN ĐƠN MONEY (BANK)')
                .setColor('#3498db')
                .setDescription(`Chào <@${interaction.user.id}>!\nVui lòng chuyển khoản và **gửi ảnh bill vào kênh này**.\n\n👤 Ingame: \`${ign}\`\n💰 Nhận: \`${moneyReceivedM.toLocaleString('vi-VN')}M$\`\n💵 Số tiền: \`${vndAmount.toLocaleString('vi-VN')} VNĐ\`\n📌 Nội dung CK: \`\`\`${memo}\`\`\``)
                .setImage(qrUrl)
                .setTimestamp();

            const adminRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`money_approve_${orderId}`).setLabel('Duyệt Đơn').setEmoji('✅').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`money_reject_${orderId}`).setLabel('Từ Chối').setEmoji('❌').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
            );

            await ticketChannel.send({ content: `<@${interaction.user.id}>`, embeds: [qrEmbed], components: [adminRow] });
            return safeEditReply(interaction, { content: `✅ **Đã tạo Ticket!** 👉 ${ticketChannel}` });
        } catch (err) {
            return safeEditReply(interaction, { content: `❌ Lỗi tạo Ticket: \`${err.message}\`` });
        }
    }

    // MONEY CARD MODAL
    if (interaction.customId === 'modal_card') {
        const ign = interaction.fields.getTextInputValue('card_ign').trim();
        const type = interaction.fields.getTextInputValue('card_type').trim();
        const val = interaction.fields.getTextInputValue('card_val').trim();
        const code = interaction.fields.getTextInputValue('card_code').trim();
        const seri = interaction.fields.getTextInputValue('card_seri').trim();

        const cardValueVnd = Math.floor(parseCardValue(val));
        if (cardValueVnd < 1000) return safeReply(interaction, { content: '❌ Mệnh giá thẻ không hợp lệ.', flags: MessageFlags.Ephemeral });

        const netVnd = Math.floor(cardValueVnd * (1 - CARD_DISCOUNT));
        const moneyReceivedM = Math.floor(netVnd / RATE);

        if (moneyReceivedM <= 0 || moneyReceivedM > currentStockM) {
            return safeReply(interaction, { content: `❌ Số tiền quy đổi không hợp lệ hoặc vượt kho (${formatStock(currentStockM)}).`, flags: MessageFlags.Ephemeral });
        }

        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral })))) return;

        const orderId = `C${Date.now()}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
        const orders = getMoneyOrders();
        orders[orderId] = {
            id: orderId, type: 'card', userId: interaction.user.id, username: interaction.user.username,
            ign, cardType: type, cardValueVnd, netVnd, amountM: moneyReceivedM, cardCode: code, cardSeri: seri, status: 'pending', createdAt: Date.now()
        };
        saveMoneyOrders(orders);

        try {
            const ticketChannel = await interaction.guild.channels.create({
                name: `ticket-card-${ign.toLowerCase().replace(/[^a-z0-9-_]/gi, '').slice(0, 60)}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] },
                    ...adminOverwrite(interaction.guild.id)
                ]
            });

            await ticketChannel.setTopic(`moneyOrder:${orderId}`);

            const cardEmbed = new EmbedBuilder()
                .setTitle('🎟️ THÔNG TIN ĐƠN NẠP THẺ CÀO (MONEY)')
                .setColor('#f1c40f')
                .setDescription(`👤 Ingame: \`${ign}\`\n💳 Loại thẻ: \`${type}\`\n💵 Mệnh giá: \`${cardValueVnd.toLocaleString('vi-VN')} VNĐ\`\n💰 Money quy đổi: \`${moneyReceivedM.toLocaleString('vi-VN')}M$\`\n🔑 Mã thẻ: \`\`\`${code}\`\`\`\n🔢 Seri: \`\`\`${seri}\`\`\``)
                .setTimestamp();

            const adminRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`money_approve_${orderId}`).setLabel('Duyệt Thẻ').setEmoji('✅').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`money_reject_${orderId}`).setLabel('Từ Chối').setEmoji('❌').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
            );

            await ticketChannel.send({ content: `<@${interaction.user.id}>`, embeds: [cardEmbed], components: [adminRow] });
            return safeEditReply(interaction, { content: `✅ **Đã tạo Ticket thẻ!** 👉 ${ticketChannel}` });
        } catch (err) {
            return safeEditReply(interaction, { content: `❌ Lỗi tạo Ticket: \`${err.message}\`` });
        }
    }

    // MONEY CALC MODAL
    if (interaction.customId === 'modal_calc') {
        const rawInput = interaction.fields.getTextInputValue('calc_money');
        const moneyM = parseMoneyToM(rawInput);
        if (moneyM <= 0) return safeReply(interaction, { content: '❌ Số Money không hợp lệ.', flags: MessageFlags.Ephemeral });

        const priceBankVnd = Math.round(moneyM * RATE);
        const requiredCardVnd = Math.round(priceBankVnd / (1 - CARD_DISCOUNT));

        return safeReply(interaction, {
            content: `🧮 **BẢNG TÍNH GIÁ MONEY**\n• Mua: \`${rawInput}\` → **${moneyM.toLocaleString('vi-VN')}M$**\n💵 Bank: **${priceBankVnd.toLocaleString('vi-VN')} VNĐ**\n🎟️ Thẻ cào: **${requiredCardVnd.toLocaleString('vi-VN')} VNĐ**`,
            flags: MessageFlags.Ephemeral
        });
    }

    // ==========================================
    // SPAWNER MODALS
    // ==========================================
    if (interaction.customId === 'modal_spawner_bank') {
        const ign = interaction.fields.getTextInputValue('spawner_bank_name').trim();
        const rawQty = interaction.fields.getTextInputValue('spawner_spawner_qty') || interaction.fields.getTextInputValue('spawner_bank_qty');
        const quantity = parseInt(rawQty, 10);

        if (!Number.isInteger(quantity) || quantity <= 0) {
            return safeReply(interaction, { content: '❌ Số lượng lồng spawner không hợp lệ.', flags: MessageFlags.Ephemeral });
        }
        if (quantity > currentStockSp) {
            return safeReply(interaction, { content: `❌ Kho Spawner không đủ! Hiện còn: **${formatSpawnerStock(currentStockSp)}**`, flags: MessageFlags.Ephemeral });
        }

        const totalVnd = quantity * SPAWNER_PRICE;
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral })))) return;

        const orderId = `SP${Date.now()}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
        const memo = `KSMP SP ${ign}`;
        const qrUrl = `https://img.vietqr.io/image/${BANK_CONFIG.BANK_ID}-${BANK_CONFIG.ACCOUNT_NO}-compact2.png?amount=${totalVnd}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(BANK_CONFIG.ACCOUNT_NAME)}`;

        const orders = getSpawnerOrders();
        orders[orderId] = {
            id: orderId, type: 'bank', userId: interaction.user.id, username: interaction.user.username,
            ign, quantity, totalVnd, status: 'pending', createdAt: Date.now()
        };
        saveSpawnerOrders(orders);

        try {
            const ticketChannel = await interaction.guild.channels.create({
                name: `ticket-spawner-${ign.toLowerCase().replace(/[^a-z0-9-_]/gi, '').slice(0, 60)}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] },
                    ...adminOverwrite(interaction.guild.id)
                ]
            });

            await ticketChannel.setTopic(`spawnerOrder:${orderId}`);

            const qrEmbed = new EmbedBuilder()
                .setTitle('💳 THANH TOÁN ĐƠN SPAWNER (BANK)')
                .setColor('#9b59b6')
                .setDescription(`Chào <@${interaction.user.id}>!\nVui lòng chuyển khoản và **gửi ảnh bill vào kênh này**.\n\n👤 Ingame: \`${ign}\`\n📦 Số lượng: \`${quantity} Lồng Spawner\`\n💵 Tổng tiền: \`${totalVnd.toLocaleString('vi-VN')} VNĐ\`\n📌 Nội dung CK: \`\`\`${memo}\`\`\``)
                .setImage(qrUrl)
                .setTimestamp();

            const adminRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`spawner_approve_${orderId}`).setLabel('Duyệt Đơn').setEmoji('✅').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`spawner_reject_${orderId}`).setLabel('Từ Chối').setEmoji('❌').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
            );

            await ticketChannel.send({ content: `<@${interaction.user.id}>`, embeds: [qrEmbed], components: [adminRow] });
            return safeEditReply(interaction, { content: `✅ **Đã tạo Ticket Spawner!** 👉 ${ticketChannel}` });
        } catch (err) {
            return safeEditReply(interaction, { content: `❌ Lỗi tạo Ticket: \`${err.message}\`` });
        }
    }

    if (interaction.customId === 'modal_spawner_card') {
        const ign = interaction.fields.getTextInputValue('spawner_card_ign').trim();
        const type = interaction.fields.getTextInputValue('spawner_card_type').trim();
        const val = interaction.fields.getTextInputValue('spawner_card_val').trim();
        const code = interaction.fields.getTextInputValue('spawner_card_code').trim();
        const seri = interaction.fields.getTextInputValue('spawner_card_seri').trim();

        const cardValueVnd = Math.floor(parseCardValue(val));
        if (cardValueVnd < 1000) return safeReply(interaction, { content: '❌ Mệnh giá thẻ không hợp lệ.', flags: MessageFlags.Ephemeral });

        const netVnd = Math.floor(cardValueVnd * (1 - CARD_DISCOUNT));
        const quantity = Math.floor(netVnd / SPAWNER_PRICE);

        if (quantity <= 0) {
            return safeReply(interaction, { content: '❌ Mệnh giá thẻ quá thấp để mua 1 lồng spawner.', flags: MessageFlags.Ephemeral });
        }
        if (quantity > currentStockSp) {
            return safeReply(interaction, { content: `❌ Số lượng quy đổi vượt kho Spawner hiện tại (${formatSpawnerStock(currentStockSp)}).`, flags: MessageFlags.Ephemeral });
        }

        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral })))) return;

        const orderId = `SPC${Date.now()}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
        const orders = getSpawnerOrders();
        orders[orderId] = {
            id: orderId, type: 'card', userId: interaction.user.id, username: interaction.user.username,
            ign, cardType: type, cardValueVnd, netVnd, quantity, cardCode: code, cardSeri: seri, status: 'pending', createdAt: Date.now()
        };
        saveSpawnerOrders(orders);

        try {
            const ticketChannel = await interaction.guild.channels.create({
                name: `ticket-spawner-card-${ign.toLowerCase().replace(/[^a-z0-9-_]/gi, '').slice(0, 60)}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] },
                    ...adminOverwrite(interaction.guild.id)
                ]
            });

            await ticketChannel.setTopic(`spawnerOrder:${orderId}`);

            const cardEmbed = new EmbedBuilder()
                .setTitle('🎟️ THÔNG TIN ĐƠN NẠP THẺ CÀO (SPAWNER)')
                .setColor('#f1c40f')
                .setDescription(`👤 Ingame: \`${ign}\`\n💳 Loại thẻ: \`${type}\`\n💵 Mệnh giá: \`${cardValueVnd.toLocaleString('vi-VN')} VNĐ\`\n📦 Số lượng lồng: \`${quantity} Lồng\`\n🔑 Mã thẻ: \`\`\`${code}\`\`\`\n🔢 Seri: \`\`\`${seri}\`\`\``)
                .setTimestamp();

            const adminRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`spawner_approve_${orderId}`).setLabel('Duyệt Thẻ').setEmoji('✅').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`spawner_reject_${orderId}`).setLabel('Từ Chối').setEmoji('❌').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
            );

            await ticketChannel.send({ content: `<@${interaction.user.id}>`, embeds: [cardEmbed], components: [adminRow] });
            return safeEditReply(interaction, { content: `✅ **Đã tạo Ticket thẻ Spawner!** 👉 ${ticketChannel}` });
        } catch (err) {
            return safeEditReply(interaction, { content: `❌ Lỗi tạo Ticket: \`${err.message}\`` });
        }
    }

    if (interaction.customId === 'modal_spawner_calc') {
        const rawQty = interaction.fields.getTextInputValue('spawner_calc_qty');
        const quantity = parseInt(rawQty, 10);
        if (!Number.isInteger(quantity) || quantity <= 0) {
            return safeReply(interaction, { content: '❌ Số lượng không hợp lệ.', flags: MessageFlags.Ephemeral });
        }

        const priceBankVnd = quantity * SPAWNER_PRICE;
        const requiredCardVnd = Math.round(priceBankVnd / (1 - CARD_DISCOUNT));

        return safeReply(interaction, {
            content: `🧮 **BẢNG TÍNH GIÁ SPAWNER**\n• Số lượng: \`${quantity} Lồng\`\n💵 Bank: **${priceBankVnd.toLocaleString('vi-VN')} VNĐ**\n🎟️ Thẻ cào (-20%): **${requiredCardVnd.toLocaleString('vi-VN')} VNĐ**`,
            flags: MessageFlags.Ephemeral
        });
    }
}

// ============================================================
// 13. ACCOUNT DATA & FUNCTIONS
// ============================================================

function getAccStock() {
    return readJson(ACC_STOCK_FILE, []);
}

function saveAccStock(stockArray) {
    writeJson(ACC_STOCK_FILE, stockArray);
}

function getDetailedAccs() {
    return readJson(ACC_DETAIL_FILE, []);
}

function saveDetailedAccs(accs) {
    writeJson(ACC_DETAIL_FILE, accs);
}

function createAccEmbed(acc) {
    const embed = new EmbedBuilder()
        .setColor(acc.status === 'available' ? '#2ecc71' : acc.status === 'pending' ? '#f1c40f' : '#e74c3c')
        .setAuthor({ name: 'AUTO BUY' })
        .setTitle(`🎮 ${acc.username}`)
        .setDescription(
            `🏷️ **Giá Bank:** ${acc.priceBank.toLocaleString('vi-VN')} VNĐ\n` +
            `🎟️ **Giá Thẻ:** ${acc.priceCard.toLocaleString('vi-VN')} VNĐ\n` +
            `✅ **Trạng thái:** ${acc.status === 'available' ? '🟢 Có Sẵn' : acc.status === 'pending' ? '🟡 Đang Có Người Mua' : '🔴 Đã Bán'}`
        )
        .addFields(
            { name: '🏷️ Username', value: `\`${acc.username}\`` },
            { name: '👕 Cape Số Lượng', value: `\`${acc.capeCount}\``, inline: true },
            { name: '✨ Cape Chi Tiết', value: `\`${acc.capeList || 'Không'}\``, inline: true },
            { name: '⭐ Rank', value: `\`${acc.rank}\`` }
        );
    if (acc.imageUrl) embed.setImage(acc.imageUrl);
    return embed;
}

async function updateAccListingMessage(acc) {
    if (!acc?.channelId || !acc?.messageId) return false;
    try {
        const channel = await client.channels.fetch(String(acc.channelId));
        if (!channel || !channel.isTextBased()) return false;
        const message = await channel.messages.fetch(String(acc.messageId));
        const soldRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`sold_${acc.id}`).setLabel('🔴 Đã Bán').setStyle(ButtonStyle.Danger).setDisabled(true)
        );
        await message.edit({ embeds: [createAccEmbed(acc)], components: [soldRow] });
        return true;
    } catch (err) {
        return false;
    }
}

async function updateAccListingAvailable(acc) {
    if (!acc?.channelId || !acc?.messageId) return false;
    try {
        const channel = await client.channels.fetch(String(acc.channelId));
        if (!channel || !channel.isTextBased()) return false;
        const message = await channel.messages.fetch(String(acc.messageId));
        const buyRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`buy_single_${acc.id}`).setLabel('Mua Ngay').setEmoji('🛒').setStyle(ButtonStyle.Success)
        );
        await message.edit({ embeds: [createAccEmbed(acc)], components: [buyRow] });
        return true;
    } catch (err) {
        return false;
    }
}

// ============================================================
// 14. ACCOUNT COMMANDS
// ============================================================

async function handleAccCommand(interaction) {
    if (!isAdminUser(interaction)) {
        return safeReply(interaction, { content: '❌ Bạn không có quyền dùng lệnh này!', flags: MessageFlags.Ephemeral });
    }

    if (interaction.commandName === 'setstockacc') {
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;
        const rawData = interaction.options.getString('danh_sach');
        const lines = rawData.split('\n').map(line => line.trim()).filter(Boolean);
        const stock = getAccStock();
        let count = 0;

        for (const line of lines) {
            const parts = line.split('|').map(p => p.trim());
            if (parts.length >= 2) {
                stock.push({
                    id: `stock_${Date.now()}_` + Math.random().toString(36).slice(2, 8),
                    name: parts[0] || 'Chưa đặt tên',
                    email: parts[1] || 'Không có email',
                    recoveryCode: parts[2] || 'Không có'
                });
                count++;
            }
        }
        saveAccStock(stock);
        return safeEditReply(interaction, { content: `✅ Đã thêm **${count} acc** vào kho! Tổng kho: **${stock.length} acc**` });
    }

    if (interaction.commandName === 'acc') {
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;
        const stock = getAccStock();
        if (stock.length === 0) return safeEditReply(interaction, { content: '❌ Kho tài khoản đang trống!' });

        const options = stock.slice(0, 25).map(item => new StringSelectMenuOptionBuilder()
            .setLabel(String(item.name || 'Không có tên').slice(0, 100))
            .setDescription(`Email: ${String(item.email || '').slice(0, 90)}`)
            .setValue(String(item.id))
        );

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_stock_acc_manual')
            .setPlaceholder('📦 Chọn 1 tài khoản để lấy...')
            .addOptions(options);

        return safeEditReply(interaction, {
            content: `📦 **Kho tài khoản: ${stock.length} acc**`,
            components: [new ActionRowBuilder().addComponents(selectMenu)]
        });
    }

    if (interaction.commandName === 'deleteacc') {
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;
        const stock = getAccStock();
        if (stock.length === 0) return safeEditReply(interaction, { content: '❌ Kho tài khoản đang trống!' });

        const options = stock.slice(0, 25).map(item => new StringSelectMenuOptionBuilder()
            .setLabel(String(item.name || 'Không tên').slice(0, 100))
            .setDescription(`Email: ${String(item.email || '').slice(0, 90)}`)
            .setValue(String(item.id))
        );

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_delete_acc_menu')
            .setPlaceholder('🗑️ Chọn tài khoản muốn xóa...')
            .addOptions(options);

        return safeEditReply(interaction, {
            content: `🗑️ **Kho hiện có ${stock.length} acc**`,
            components: [new ActionRowBuilder().addComponents(selectMenu)]
        });
    }

    if (interaction.commandName === 'thongtin') {
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;
        const username = interaction.options.getString('username').trim();
        const priceBank = interaction.options.getInteger('price_bank');
        const priceCard = interaction.options.getInteger('price_card');
        const capeCount = interaction.options.getInteger('cape_count');
        const capeList = interaction.options.getString('cape_list').trim();
        const rank = interaction.options.getString('rank');
        const imageUrl = interaction.options.getString('image_url') || null;

        const accs = getDetailedAccs();
        const newAcc = {
            id: `acc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            username, priceBank, priceCard, capeCount, capeList, rank, imageUrl,
            status: 'available', channelId: interaction.channel.id, messageId: null, pendingTicketId: null, pendingBuyerId: null
        };

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`buy_single_${newAcc.id}`).setLabel('Mua Ngay').setEmoji('🛒').setStyle(ButtonStyle.Success)
        );

        const msg = await interaction.channel.send({ embeds: [createAccEmbed(newAcc)], components: [row] });
        newAcc.messageId = msg.id;
        accs.push(newAcc);
        saveDetailedAccs(accs);

        return safeEditReply(interaction, { content: `✅ Đã đăng bán Acc \`${username}\` thành công!` });
    }

    if (interaction.commandName === 'price') {
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;
        const username = interaction.options.getString('username').trim();
        const newBank = interaction.options.getInteger('price_bank');
        const newCard = interaction.options.getInteger('price_card');
        const accs = getDetailedAccs();
        const target = accs.find(a => a.username.toLowerCase() === username.toLowerCase());

        if (!target) return safeEditReply(interaction, { content: `❌ Không tìm thấy Acc: \`${username}\`` });

        target.priceBank = newBank;
        target.priceCard = newCard;
        saveDetailedAccs(accs);

        try {
            const ch = await client.channels.fetch(target.channelId);
            const msg = await ch.messages.fetch(target.messageId);
            await msg.edit({ embeds: [createAccEmbed(target)] });
        } catch (err) {}

        return safeEditReply(interaction, { content: `✅ Đã cập nhật giá cho Acc \`${username}\`!` });
    }

    if (interaction.commandName === 'cape') {
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;
        const username = interaction.options.getString('username').trim();
        const count = interaction.options.getInteger('cape_count');
        const list = interaction.options.getString('cape_list').trim();
        const accs = getDetailedAccs();
        const target = accs.find(a => a.username.toLowerCase() === username.toLowerCase());

        if (!target) return safeEditReply(interaction, { content: `❌ Không tìm thấy Acc: \`${username}\`` });

        target.capeCount = count;
        target.capeList = list;
        saveDetailedAccs(accs);

        try {
            const ch = await client.channels.fetch(target.channelId);
            const msg = await ch.messages.fetch(target.messageId);
            await msg.edit({ embeds: [createAccEmbed(target)] });
        } catch (err) {}

        return safeEditReply(interaction, { content: `✅ Đã cập nhật Cape cho Acc \`${username}\`!` });
    }
}

// ============================================================
// 15. ACCOUNT SELECT MENUS
// ============================================================

async function handleAccSelectMenu(interaction) {
    if (interaction.customId === 'select_delete_acc_menu') {
        if (!isAdminUser(interaction)) return safeReply(interaction, { content: '❌ Bạn không có quyền!', flags: MessageFlags.Ephemeral });
        if (!(await safeDeferUpdate(interaction))) return;

        const selectedId = interaction.values[0];
        const stock = getAccStock();
        const target = stock.find(a => String(a.id) === String(selectedId));

        if (!target) return safeEditReply(interaction, { content: '❌ Tài khoản không tồn tại!', components: [] });

        const confirmRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`confirm_delete_${target.id}`).setLabel('Xác Nhận Xóa').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('cancel_delete').setLabel('Hủy Bỏ').setEmoji('❌').setStyle(ButtonStyle.Secondary)
        );

        return safeEditReply(interaction, { content: `⚠️ **Xác nhận xóa tài khoản?**\n• Tên: \`${target.name}\``, components: [confirmRow] });
    }

    if (interaction.customId === 'select_stock_acc_manual') {
        if (!isAdminUser(interaction)) return safeReply(interaction, { content: '❌ Bạn không có quyền!', flags: MessageFlags.Ephemeral });
        if (!(await safeDeferUpdate(interaction))) return;

        const selectedId = interaction.values[0];
        const stock = getAccStock();
        const index = stock.findIndex(a => String(a.id) === String(selectedId));
        if (index === -1) return safeEditReply(interaction, { content: '❌ Tài khoản không còn trong kho!', components: [] });

        const [foundAcc] = stock.splice(index, 1);
        saveAccStock(stock);

        const embed = new EmbedBuilder()
            .setTitle(`🔑 THÔNG TIN ACC: ${foundAcc.name}`)
            .setColor('#3498db')
            .addFields(
                { name: '🏷️ Tên / Ghi chú', value: `\`${foundAcc.name || 'Không có'}\`` },
                { name: '📧 Email', value: `\`\`\`${foundAcc.email || 'Không có'}\`\`\`` },
                { name: '🔑 Recovery Code', value: `\`\`\`${foundAcc.recoveryCode || 'Không có'}\`\`\`` }
            );

        return safeEditReply(interaction, { content: `✅ Đã rút thành công: \`${foundAcc.name}\``, embeds: [embed], components: [] });
    }

    if (interaction.customId.startsWith('select_deliver_acc_')) {
        if (!isAdminUser(interaction)) return safeReply(interaction, { content: '❌ Chỉ Admin mới có quyền!', flags: MessageFlags.Ephemeral });
        if (!(await safeDeferUpdate(interaction))) return;

        const targetMessageId = interaction.customId.replace('select_deliver_acc_', '');
        const selectedId = interaction.values[0];
        const stock = getAccStock();
        const index = stock.findIndex(a => String(a.id) === String(selectedId));
        if (index === -1) return safeEditReply(interaction, { content: '❌ Tài khoản không tồn tại trong kho!', components: [] });

        const topic = interaction.channel.topic || '';
        if (!topic.startsWith('accOrder:')) return safeEditReply(interaction, { content: '❌ Không xác định được đơn hàng Account.', components: [] });

        const accId = topic.replace('accOrder:', '');
        const accs = getDetailedAccs();
        const target = accs.find(a => a.id === accId);
        if (!target || target.status !== 'pending') return safeEditReply(interaction, { content: '❌ Đơn hàng không hợp lệ.', components: [] });

        const [deliveredAcc] = stock.splice(index, 1);
        saveAccStock(stock);

        target.status = 'sold';
        target.pendingTicketId = null;
        target.pendingBuyerId = null;
        saveDetailedAccs(accs);
        await updateAccListingMessage(target);

        const closeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger)
        );

        const deliverEmbed = new EmbedBuilder()
            .setTitle('🎉 THANH TOÁN THÀNH CÔNG!')
            .setColor('#2ecc71')
            .addFields(
                { name: '🎮 Tên / Ghi chú', value: `\`${deliveredAcc.name || 'Acc'}\`` },
                { name: '📧 Email', value: `\`\`\`${deliveredAcc.email || 'Không có'}\`\`\`` },
                { name: '🔑 Recovery Code', value: `\`\`\`${deliveredAcc.recoveryCode || 'Không có'}\`\`\`` }
            );

        await interaction.channel.send({ embeds: [deliverEmbed], components: [closeRow] });
        return safeEditReply(interaction, { content: `✅ Đã gửi acc cho khách!`, components: [] });
    }
}

// ============================================================
// 16. ACCOUNT BUTTONS
// ============================================================

async function handleAccButton(interaction) {
    const id = interaction.customId;

    if (id.startsWith('confirm_delete_')) {
        if (!isAdminUser(interaction)) return safeReply(interaction, { content: '❌ Bạn không có quyền!', flags: MessageFlags.Ephemeral });
        if (!(await safeDeferUpdate(interaction))) return;

        const targetId = id.replace('confirm_delete_', '');
        let stock = getAccStock();
        stock = stock.filter(a => String(a.id) !== String(targetId));
        saveAccStock(stock);

        return safeEditReply(interaction, { content: `✅ Đã xóa tài khoản khỏi kho!`, components: [] });
    }

    if (id === 'cancel_delete') {
        if (!(await safeDeferUpdate(interaction))) return;
        return safeEditReply(interaction, { content: '❌ Đã hủy thao tác xóa.', components: [] });
    }

    if (id.startsWith('buy_single_')) {
        if (!isWithinWorkingHours()) {
            return safeReply(interaction, { content: '🛑 **Shop hiện đã đóng cửa!**', flags: MessageFlags.Ephemeral });
        }
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;

        const accId = id.replace('buy_single_', '');
        const accs = getDetailedAccs();
        const target = accs.find(a => a.id === accId);
        if (!target || target.status !== 'available') {
            return safeEditReply(interaction, { content: '❌ Sản phẩm hiện không có sẵn.' });
        }

        const guild = interaction.guild;
        const channelName = `ticket-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 60);

        try {
            const ticketChannel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] },
                    ...adminOverwrite(guild.id)
                ]
            });

            await ticketChannel.setTopic(`accOrder:${target.id}`);
            target.status = 'pending';
            target.pendingTicketId = ticketChannel.id;
            target.pendingBuyerId = interaction.user.id;
            saveDetailedAccs(accs);

            const qrUrl = `https://img.vietqr.io/image/${BANK_CONFIG.BANK_ID}-${BANK_CONFIG.ACCOUNT_NO}-compact2.png?amount=${target.priceBank}&addInfo=${encodeURIComponent(`ACC ${target.username}`)}&accountName=${encodeURIComponent(BANK_CONFIG.ACCOUNT_NAME)}`;

            const payEmbed = new EmbedBuilder()
                .setTitle(`💳 THANH TOÁN MUA ACC: ${target.username}`)
                .setColor('#2ecc71')
                .setDescription('Vui lòng chuyển khoản đúng số tiền và gửi ảnh bill vào đây.')
                .addFields(
                    { name: '💵 Giá Bank', value: `\`${target.priceBank.toLocaleString('vi-VN')} VNĐ\``, inline: true },
                    { name: '📲 Giá Thẻ Cào', value: `\`${target.priceCard.toLocaleString('vi-VN')} VNĐ\``, inline: true }
                )
                .setImage(qrUrl);

            await ticketChannel.send({ content: `<@${interaction.user.id}>`, embeds: [payEmbed] });
            return safeEditReply(interaction, { content: `✅ **Đã tạo Ticket mua Acc!** 👉 ${ticketChannel}` });
        } catch (err) {
            target.status = 'available';
            saveDetailedAccs(accs);
            return safeEditReply(interaction, { content: `❌ Lỗi tạo Ticket: \`${err.message}\`` });
        }
    }

    if (id === 'approve_bill') {
        if (!isAdminUser(interaction)) return safeReply(interaction, { content: '❌ Chỉ Admin!', flags: MessageFlags.Ephemeral });
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;

        const topic = interaction.channel.topic || '';
        if (!topic.startsWith('accOrder:')) return safeEditReply(interaction, { content: '❌ Không phải ticket mua Acc.' });

        const stock = getAccStock();
        if (stock.length === 0) return safeEditReply(interaction, { content: '❌ Kho Account đang trống!' });

        const options = stock.slice(0, 25).map(item => new StringSelectMenuOptionBuilder()
            .setLabel(String(item.name || 'Không tên').slice(0, 100))
            .setDescription(`Email: ${String(item.email || '').slice(0, 90)}`)
            .setValue(String(item.id))
        );

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`select_deliver_acc_${interaction.message.id}`)
            .setPlaceholder('📦 Chọn tài khoản trong kho để gửi...')
            .addOptions(options);

        return safeEditReply(interaction, {
            content: `📋 Chọn acc để gửi cho khách:`,
            components: [new ActionRowBuilder().addComponents(selectMenu)]
        });
    }

    if (id === 'reject_bill') {
        if (!isAdminUser(interaction)) return safeReply(interaction, { content: '❌ Chỉ Admin!', flags: MessageFlags.Ephemeral });
        if (!(await safeDeferUpdate(interaction))) return;
        return interaction.channel.send('⚠️ **Bill chưa hợp lệ. Vui lòng gửi lại bill chính xác.**');
    }
}

// ============================================================
// 17. CLOSE TICKET
// ============================================================

async function handleCloseTicket(interaction) {
    if (!isAdminUser(interaction)) {
        return safeReply(interaction, { content: '❌ Chỉ Admin mới có quyền đóng Ticket!', flags: MessageFlags.Ephemeral });
    }

    const topic = interaction.channel?.topic || '';
    if (topic.startsWith('accOrder:')) {
        const accId = topic.replace('accOrder:', '');
        const accs = getDetailedAccs();
        const target = accs.find(a => a.id === accId);
        if (target && target.status === 'pending') {
            target.status = 'available';
            target.pendingTicketId = null;
            target.pendingBuyerId = null;
            saveDetailedAccs(accs);
            await updateAccListingAvailable(target);
        }
    }

    await safeReply(interaction, { content: '🔒 **Kênh Ticket sẽ tự động xóa sau 5 giây...**' });
    setTimeout(() => {
        interaction.channel.delete().catch(() => {});
    }, 5000);
}

// ============================================================
// 18. SLASH COMMANDS BUILDER
// ============================================================

const MONEY_COMMAND_NAMES = ['setup', 'setstock', 'setstockspawner', 'rate', 'spawnerprice', 'time'];
const ACC_COMMAND_NAMES = ['setstockacc', 'acc', 'deleteacc', 'thongtin', 'price', 'cape'];

const commands = [
    // SETUP (Money & Spawner Subcommands)
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Thiết lập Bảng AutoBuy cố định vào kênh này')
        .addSubcommand(sub =>
            sub.setName('money')
                .setDescription('Thiết lập Bảng AutoBuy Money')
        )
        .addSubcommand(sub =>
            sub.setName('spawner')
                .setDescription('Thiết lập Bảng AutoBuy Spawner')
        ),

    // SETSTOCK MONEY
    new SlashCommandBuilder()
        .setName('setstock')
        .setDescription('Cập nhật số lượng kho Money')
        .addStringOption(opt =>
            opt.setName('amount').setDescription('Ví dụ: 10b, 500m').setRequired(true)
        ),

    // SETSTOCK SPAWNER
    new SlashCommandBuilder()
        .setName('setstockspawner')
        .setDescription('Cập nhật số lượng kho Spawner')
        .addIntegerOption(opt =>
            opt.setName('amount').setDescription('Số lượng lồng spawner mới').setMinValue(0).setRequired(true)
        ),

    // RATE MONEY
    new SlashCommandBuilder()
        .setName('rate')
        .setDescription('Đổi tỷ giá Money (VNĐ / 1M$)')
        .addIntegerOption(opt =>
            opt.setName('value').setDescription('Rate mới, ví dụ: 130').setMinValue(1).setRequired(true)
        ),

    // SPAWNER PRICE
    new SlashCommandBuilder()
        .setName('spawnerprice')
        .setDescription('Đổi giá 1 Lồng Spawner (VNĐ)')
        .addIntegerOption(opt =>
            opt.setName('price').setDescription('Giá VNĐ, ví dụ: 50000').setMinValue(1).setRequired(true)
        ),

    // TIME
    new SlashCommandBuilder()
        .setName('time')
        .setDescription('Cài đặt giờ hoạt động của Bot (GMT+7)')
        .addIntegerOption(opt =>
            opt.setName('start').setDescription('Giờ bắt đầu (0-23)').setMinValue(0).setMaxValue(23).setRequired(true)
        )
        .addIntegerOption(opt =>
            opt.setName('end').setDescription('Giờ kết thúc (0-23)').setMinValue(0).setMaxValue(23).setRequired(true)
        ),

    // ACCOUNT COMMANDS
    new SlashCommandBuilder()
        .setName('setstockacc')
        .setDescription('Nạp danh sách tài khoản vào kho')
        .addStringOption(o => o.setName('danh_sach').setDescription('Tên Acc | Email | Recovery Code').setRequired(true)),
    new SlashCommandBuilder()
        .setName('acc')
        .setDescription('Xem và lấy tài khoản ra khỏi kho'),
    new SlashCommandBuilder()
        .setName('deleteacc')
        .setDescription('Xóa tài khoản khỏi kho'),
    new SlashCommandBuilder()
        .setName('thongtin')
        .setDescription('Đăng tin bán Acc Minecraft')
        .addStringOption(o => o.setName('username').setDescription('Username').setRequired(true))
        .addIntegerOption(o => o.setName('price_bank').setDescription('Giá Bank').setRequired(true))
        .addIntegerOption(o => o.setName('price_card').setDescription('Giá Thẻ').setRequired(true))
        .addIntegerOption(o => o.setName('cape_count').setDescription('Số Cape').setRequired(true))
        .addStringOption(o => o.setName('cape_list').setDescription('Danh sách Cape').setRequired(true))
        .addStringOption(o => o.setName('rank').setDescription('Rank').setRequired(true))
        .addStringOption(o => o.setName('image_url').setDescription('Link banner').setRequired(false)),
    new SlashCommandBuilder()
        .setName('price')
        .setDescription('Cập nhật giá Acc')
        .addStringOption(o => o.setName('username').setDescription('Username').setRequired(true))
        .addIntegerOption(o => o.setName('price_bank').setDescription('Giá Bank mới').setRequired(true))
        .addIntegerOption(o => o.setName('price_card').setDescription('Giá Thẻ mới').setRequired(true)),
    new SlashCommandBuilder()
        .setName('cape')
        .setDescription('Cập nhật Cape cho Acc')
        .addStringOption(o => o.setName('username').setDescription('Username').setRequired(true))
        .addIntegerOption(o => o.setName('cape_count').setDescription('Số Cape mới').setRequired(true))
        .addStringOption(o => o.setName('cape_list').setDescription('Danh sách Cape mới').setRequired(true))
];

// ============================================================
// 19. REGISTER COMMANDS
// ============================================================

async function registerSlashCommands() {
    const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
    const clientId = process.env.CLIENT_ID || process.env.APPLICATION_ID;

    if (!token || !clientId) return;

    const rest = new REST({ version: '10' }).setToken(token);

    try {
        if (process.env.GUILD_ID) {
            await rest.put(Routes.applicationGuildCommands(clientId, process.env.GUILD_ID), { body: commands.map(c => c.toJSON()) });
        } else {
            await rest.put(Routes.applicationCommands(clientId), { body: commands.map(c => c.toJSON()) });
        }
        console.log(`✅ Đã đăng ký ${commands.length} Slash Commands thành công!`);
    } catch (error) {
        console.error('❌ Lỗi đăng ký command:', error);
    }
}

// ============================================================
// 20. MESSAGE CREATE
// ============================================================

client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;

    try {
        const contentLower = message.content.toLowerCase();
        if (contentLower.includes('sell') || contentLower.includes('stock')) {
            const stockText = formatStock(currentStockM);
            const stockSpawnerText = formatSpawnerStock(currentStockSp);

            const replyEmbed = new EmbedBuilder()
                .setColor('#3498db')
                .setTitle('📦 THÔNG TIN KHO HÀNG KINGSMP')
                .setDescription(
                    `💰 **Money Stock:** \`${stockText}\` (\`${RATE}đ/1M$\`)\n` +
                    `📦 **Spawner Stock:** \`${stockSpawnerText}\` (\`${SPAWNER_PRICE.toLocaleString('vi-VN')}đ/lồng\`)\n` +
                    `🎟️ **Thẻ cào:** -20%`
                )
                .setTimestamp();

            await message.channel.send({ embeds: [replyEmbed] });
        }

        if (
            message.channel.type === ChannelType.GuildText &&
            message.channel.name?.startsWith('ticket-') &&
            message.channel.topic?.startsWith('accOrder:')
        ) {
            const hasImage = message.attachments.some(att => att.contentType && att.contentType.startsWith('image/'));
            if (!hasImage) return;

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('approve_bill').setLabel('Duyệt - Chọn Acc').setEmoji('✅').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('reject_bill').setLabel('Từ Chối').setEmoji('❌').setStyle(ButtonStyle.Danger)
            );

            const embed = new EmbedBuilder()
                .setTitle('🧾 PHÁT HIỆN BILL CHUYỂN KHOẢN')
                .setColor('#f1c40f')
                .setDescription(`Khách hàng <@${message.author.id}> đã gửi bill.`);

            await message.channel.send({ embeds: [embed], components: [row] });
        }
    } catch (err) {
        console.error('Lỗi MessageCreate:', err.message);
    }
});

// ============================================================
// 21. INTERACTION CREATE
// ============================================================

client.on(Events.InteractionCreate, async interaction => {
    try {
        if (!claimInteraction(interaction)) return;

        if (interaction.isChatInputCommand()) {
            if (MONEY_COMMAND_NAMES.includes(interaction.commandName)) {
                return await handleMoneyCommand(interaction);
            }
            if (ACC_COMMAND_NAMES.includes(interaction.commandName)) {
                return await handleAccCommand(interaction);
            }
            return;
        }

        if (interaction.isButton()) {
            const id = interaction.customId;
            if (id === 'close_ticket') return await handleCloseTicket(interaction);

            if (
                id.startsWith('money_approve_') || id.startsWith('money_reject_') ||
                id.startsWith('spawner_approve_') || id.startsWith('spawner_reject_') ||
                [
                    'buy_bank', 'buy_card', 'calc_price', 'guide',
                    'spawner_buy_bank', 'spawner_buy_card', 'spawner_calc_price', 'spawner_guide'
                ].includes(id)
            ) {
                return await handleMoneyButton(interaction);
            }

            if (
                id.startsWith('buy_single_') || id.startsWith('confirm_delete_') ||
                id === 'cancel_delete' || id === 'approve_bill' || id === 'reject_bill'
            ) {
                return await handleAccButton(interaction);
            }
            return;
        }

        if (interaction.isStringSelectMenu()) {
            const id = interaction.customId;
            if (id === 'select_stock_acc_manual' || id === 'select_delete_acc_menu' || id.startsWith('select_deliver_acc_')) {
                return await handleAccSelectMenu(interaction);
            }
            return;
        }

        if (interaction.isModalSubmit()) {
            if ([
                'modal_bank', 'modal_card', 'modal_calc',
                'modal_spawner_bank', 'modal_spawner_card', 'modal_spawner_calc'
            ].includes(interaction.customId)) {
                return await handleMoneyModal(interaction);
            }
            return;
        }
    } catch (err) {
        console.error('❌ Lỗi Xử Lý Interaction:', err);
    }
});

// ============================================================
// 22. READY
// ============================================================

client.once(Events.ClientReady, async c => {
    console.log(`🤖 Bot đã online thành công: ${c.user.tag}`);

    ensureJsonFile(STOCK_FILE, { stockM: 5000 });
    ensureJsonFile(CONFIG_FILE, {});
    ensureJsonFile(MONEY_ORDERS_FILE, {});

    ensureJsonFile(SPAWNER_STOCK_FILE, { stockSp: 50 });
    ensureJsonFile(SPAWNER_CONFIG_FILE, { price: 50000 });
    ensureJsonFile(SPAWNER_ORDERS_FILE, {});

    ensureJsonFile(ACC_STOCK_FILE, []);
    ensureJsonFile(ACC_DETAIL_FILE, []);

    console.log(`📦 [STARTUP] Money stock: ${currentStockM}M$ | Spawner stock: ${currentStockSp} lồng`);
    await registerSlashCommands();
    await updateAutoBuyPanel();
    await updateSpawnerAutoBuyPanel();
});

// ============================================================
// 23. ERROR HANDLING
// ============================================================

process.on('unhandledRejection', err => {
    console.error('⚠️ [Unhandled Rejection]:', err);
});

process.on('uncaughtException', err => {
    console.error('⚠️ [Uncaught Exception]:', err);
});

// ============================================================
// 24. LOGIN
// ============================================================

const botToken = process.env.DISCORD_TOKEN || process.env.TOKEN;

if (!botToken) {
    console.error('❌ Không tìm thấy DISCORD_TOKEN/TOKEN trong .env!');
} else {
    client.login(botToken).catch(err => {
        console.error('❌ Login Discord thất bại:', err.message);
    });
}
