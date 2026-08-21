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
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
    ]
});

// ============================================================
// 3. CONFIG
// ============================================================

// RATE được lưu trong config.json và có thể đổi bằng /rate
const CARD_DISCOUNT = 0.20;

const BANK_CONFIG = {
    BANK_ID: 'MB',
    BIN: '970422',
    ACCOUNT_NO: '0357597469',
    ACCOUNT_NAME: 'TRAN HUU HAI SON'
};


// ============================================================
// 3A. SPAWNER SHOP CONFIG
// ============================================================

const serverConfig = {
    adminRoleId:
        process.env.ADMIN_ROLE_ID ||
        "ID_ROLE_ADMIN_CUA_BAN",

    ticketCategoryId:
        process.env.TICKET_CATEGORY_ID ||
        "ID_CATEGORY_TICKET_CUA_BAN",

    legitChannelId:
        process.env.LEGIT_CHANNEL_ID ||
        "ID_KENH_LEGIT_CUA_BAN",

    bank: {
        shortName: BANK_CONFIG.BANK_ID,
        accountNo: BANK_CONFIG.ACCOUNT_NO,
        accountName: BANK_CONFIG.ACCOUNT_NAME
    }
};

const spawnerConfig = {
    ske: {
        name: "Skeleton Spawner",
        price: 50000,
        stock: 10,
        emoji: "💀"
    },
    blaze: {
        name: "Blaze Spawner",
        price: 150000,
        stock: 5,
        emoji: "🔥"
    },
    creeper: {
        name: "Creeper Spawner",
        price: 100000,
        stock: 8,
        emoji: "💥"
    },
    golem: {
        name: "Iron Golem Spawner",
        price: 300000,
        stock: 3,
        emoji: "🤖"
    }
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

// Chống cùng một Interaction bị xử lý 2 lần trong cùng process.
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
        if (err?.code === 40060) {
            console.log(`⚠️ Interaction ${interaction.id} đã được acknowledge trước đó.`);
            return null;
        }

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
        if (err?.code === 40060) {
            console.log(`⚠️ Interaction ${interaction.id} đã được acknowledge.`);
            return false;
        }

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
        if (err?.code === 40060) {
            console.log(`⚠️ Interaction ${interaction.id} đã được acknowledge.`);
            return false;
        }

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

    const hasAdminRole =
        serverConfig.adminRoleId !== "ID_ROLE_ADMIN_CUA_BAN" &&
        interaction.member?.roles?.cache?.has(serverConfig.adminRoleId);

    return Boolean(isAdminId || hasAdminPerm || hasAdminRole);
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

    // Giờ GMT+7 (Việt Nam)
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

    if (moneyM <= 0) {
        return '🔴 HẾT HÀNG (0M$)';
    }

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

    let str = String(input)
        .trim()
        .toLowerCase()
        .replace(/\s/g, '');

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

    let str = String(input)
        .trim()
        .toLowerCase()
        .replace(/\s/g, '')
        .replace(/,/g, '');

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
            `🟢 **Trạng thái:** ${
                isOutOfStock
                    ? '🔴 **ĐÃ ĐÓNG BOT (HẾT KHO)**'
                    : 'Hoạt động'
            }\n` +
            `⏰ **Giờ làm việc:** \`${startHour}h00 - ${endHour}h00\`\n` +
            `💸 **Tỷ giá:** \`${RATE} VNĐ = 1M$\`\n` +
            `🎟️ **Thẻ cào:** Trừ ${CARD_DISCOUNT * 100}% mệnh giá\n` +
            `📦 **Kho:** \`${stockText}\`\n\n` +
            (
                isOutOfStock
                    ? '⚠️ Kho đã hết Money. Vui lòng chờ Admin cập nhật Stock!'
                    : '💰 Chọn phương thức mua bên dưới:'
            )
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

    return {
        embeds: [embed],
        components: [row]
    };
}

async function updateAutoBuyPanel() {
    console.log('🔧 [PANEL V3] Bắt đầu kiểm tra AutoBuy Panel...');

    if (!moneyConfig?.channelId) {
        console.log('ℹ️ [PANEL V3] Chưa có channelId. Dùng /setup để tạo panel.');
        return;
    }

    try {
        const channel = await client.channels.fetch(String(moneyConfig.channelId));

        if (!channel || !channel.isTextBased()) {
            console.error('❌ [PANEL V3] channelId không phải kênh text hoặc không truy cập được.');
            return;
        }

        if (moneyConfig.messageId) {
            try {
                const message = await channel.messages.fetch(String(moneyConfig.messageId));
                await message.edit(buildAutoBuyEmbed());
                console.log(`✅ [PANEL V3] Đã cập nhật panel cũ: ${message.id}`);
                return;
            } catch (err) {
                const code = String(err?.code ?? '');
                const msg = String(err?.message ?? '').toLowerCase();

                const isUnknownMessage =
                    code === '10008' ||
                    msg.includes('unknown message');

                const isUnknownChannel =
                    code === '10003' ||
                    msg.includes('unknown channel');

                if (!isUnknownMessage && !isUnknownChannel) {
                    console.error(
                        '❌ [PANEL V3] Không sửa được panel:',
                        `code=${code || 'none'}`,
                        err?.message || err
                    );
                    return;
                }

                console.warn(
                    `⚠️ [PANEL V3] Panel cũ không tồn tại (${isUnknownMessage ? 'Unknown Message' : 'Unknown Channel'}). Tạo panel mới...`
                );
            }
        }

        moneyConfig.messageId = null;
        saveMoneyConfig(moneyConfig);

        const newMessage = await channel.send(buildAutoBuyEmbed());

        moneyConfig = {
            ...moneyConfig,
            channelId: channel.id,
            messageId: newMessage.id
        };

        saveMoneyConfig(moneyConfig);

        console.log(`✅ [PANEL V3] Đã tạo panel mới thành công: ${newMessage.id}`);
    } catch (err) {
        const code = String(err?.code ?? '');
        const msg = String(err?.message ?? '').toLowerCase();

        if (code === '10003' || msg.includes('unknown channel')) {
            console.error('❌ [PANEL V3] Kênh panel cũ không tồn tại. Dùng /setup ở kênh mới.');
            moneyConfig = {};
            saveMoneyConfig(moneyConfig);
            return;
        }

        console.error(
            '❌ [PANEL V3] Lỗi cập nhật/tạo panel:',
            `code=${code || 'none'}`,
            err?.message || err
        );
    }
}


// ============================================================
// 9A. SPAWNER SHOP UI
// ============================================================

function createShopEmbed() {
    const embed = new EmbedBuilder()
        .setColor('#2ECC71')
        .setTitle('🛒 HỆ THỐNG CỬA HÀNG SPAWNER CỐ ĐỊNH')
        .setDescription(
            'Welcome to the Spawner Store! 🎉\n' +
            'Hãy chọn sản phẩm bạn muốn mua bằng cách nhấn vào các nút bấm tương ứng ở bên dưới.\n' +
            '───────────────────────────────────'
        )
        .setTimestamp()
        .setFooter({
            text: '⚡ Hệ thống giao dịch tự động • Uy tín 100%'
        });

    Object.keys(spawnerConfig).forEach(key => {
        const item = spawnerConfig[key];
        const status =
            item.stock > 0
                ? `🟢 Còn lại: **${item.stock}** cái`
                : `🔴 **HẾT HÀNG**`;

        embed.addFields(
            {
                name: `${item.emoji} **${item.name.toUpperCase()}**`,
                value:
                    `>>> 💵 Giá Bank: **${item.price.toLocaleString('vi-VN')} VNĐ**\n` +
                    `📦 Tình trạng: ${status}`,
                inline: false
            },
            {
                name: '\u200B',
                value: '\u200B',
                inline: false
            }
        );
    });

    return embed;
}

function createShopButtons() {
    const row = new ActionRowBuilder();

    Object.keys(spawnerConfig).forEach(key => {
        const item = spawnerConfig[key];

        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`spawner_buy_${key}`)
                .setLabel(`Mua ${item.name.split(' ')[0]}`)
                .setEmoji(item.emoji)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(item.stock <= 0)
        );
    });

    return row;
}

// ============================================================
// 10. MONEY COMMANDS
// ============================================================

async function handleMoneyCommand(interaction) {
    if (!isAdminUser(interaction)) {
        return safeReply(interaction, {
            content: '❌ Bạn không có quyền Administrator!',
            flags: MessageFlags.Ephemeral
        });
    }

    if (interaction.commandName === 'setup') {
        if (!(await safeDeferReply(interaction, {
            flags: MessageFlags.Ephemeral
        }))) return;

        try {
            const msg = await interaction.channel.send(buildAutoBuyEmbed());

            moneyConfig.channelId = interaction.channelId;
            moneyConfig.messageId = msg.id;

            saveMoneyConfig(moneyConfig);

            return safeEditReply(interaction, {
                content: '✅ Đã thiết lập Bảng AutoBuy Money cố định thành công!'
            });
        } catch (err) {
            return safeEditReply(interaction, {
                content: `❌ Lỗi: \`${err.message}\``
            });
        }
    }

    if (interaction.commandName === 'setstock') {
        if (!(await safeDeferReply(interaction, {
            flags: MessageFlags.Ephemeral
        }))) return;

        try {
            const amountInput = interaction.options.getString('amount');
            const amountM = parseMoneyToM(amountInput);

            if (amountM <= 0) {
                return safeEditReply(interaction, {
                    content: '❌ Số Stock không hợp lệ. Ví dụ: `500m`, `10b`, `5000m`.'
                });
            }

            currentStockM = amountM;
            saveStock(currentStockM);

            await updateAutoBuyPanel();

            return safeEditReply(interaction, {
                content: `✅ Kho Money hiện tại: **${formatStock(currentStockM)}**`
            });
        } catch (err) {
            return safeEditReply(interaction, {
                content: `❌ Thất bại: \`${err.message}\``
            });
        }
    }

    if (interaction.commandName === 'rate') {
        if (!(await safeDeferReply(interaction, {
            flags: MessageFlags.Ephemeral
        }))) return;

        try {
            const newRate = interaction.options.getInteger('value');

            if (!Number.isInteger(newRate) || newRate <= 0) {
                return safeEditReply(interaction, {
                    content: '❌ Rate không hợp lệ. Ví dụ: `/rate value:130`'
                });
            }

            RATE = newRate;
            moneyConfig.rate = RATE;
            saveMoneyConfig(moneyConfig);

            await updateAutoBuyPanel();

            return safeEditReply(interaction, {
                content: `✅ Đã đổi Rate thành **${RATE}đ / 1M$**\n\n📌 Rate được lưu vào config.json nên restart bot vẫn giữ nguyên.`
            });
        } catch (err) {
            return safeEditReply(interaction, {
                content: `❌ Không thể đổi Rate: \`${err.message}\``
            });
        }
    }

    if (interaction.commandName === 'time') {
        if (!(await safeDeferReply(interaction, {
            flags: MessageFlags.Ephemeral
        }))) return;

        try {
            const start = interaction.options.getInteger('start');
            const end = interaction.options.getInteger('end');

            moneyConfig.workingHours = {
                start,
                end
            };
            saveMoneyConfig(moneyConfig);

            await updateAutoBuyPanel();

            return safeEditReply(interaction, {
                content: `✅ Đã cập nhật khung giờ làm việc thành: **${start}h00 - ${end}h00**`
            });
        } catch (err) {
            return safeEditReply(interaction, {
                content: `❌ Lỗi khi cập nhật giờ: \`${err.message}\``
            });
        }
    }
}

// ============================================================
// 11. MONEY BUTTONS
// ============================================================

async function handleMoneyButton(interaction) {
    const id = interaction.customId;

    if (
        id.startsWith('money_approve_') ||
        id.startsWith('money_reject_')
    ) {
        if (!isAdminUser(interaction)) {
            return safeReply(interaction, {
                content: '❌ Chỉ Admin mới có quyền duyệt hoặc từ chối đơn!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!(await safeDeferUpdate(interaction))) return;

        const isApprove = id.startsWith('money_approve_');
        const orderId = id.replace(
            isApprove ? 'money_approve_' : 'money_reject_',
            ''
        );

        const orders = getMoneyOrders();
        const order = orders[orderId];

        if (!order) {
            return safeEditReply(interaction, {
                content: '❌ Không tìm thấy đơn hàng này. Có thể dữ liệu đã bị xóa.',
                components: []
            });
        }

        if (order.status === 'approved') {
            return safeEditReply(interaction, {
                content: `⚠️ Đơn \`${orderId}\` đã được duyệt trước đó.`,
                components: []
            });
        }

        if (isApprove) {
            if (order.status !== 'pending' && order.status !== 'rejected') {
                return safeEditReply(interaction, {
                    content: `⚠️ Đơn này đang ở trạng thái: \`${order.status}\`.`,
                    components: []
                });
            }

            if (currentStockM < order.amountM) {
                return safeEditReply(interaction, {
                    content:
                        `❌ Kho không đủ!\n` +
                        `Cần: **${order.amountM.toLocaleString('vi-VN')}M$**\n` +
                        `Còn: **${formatStock(currentStockM)}**`
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

            const updatedEmbed = EmbedBuilder.from(
                interaction.message.embeds[0]
            )
                .setColor('#2ecc71')
                .setTitle('✅ ĐƠN ĐÃ ĐƯỢC DUYỆT')
                .addFields({
                    name: '📌 Trạng thái',
                    value:
                        `✅ Duyệt bởi <@${interaction.user.id}>\n` +
                        `📉 Đã trừ **${order.amountM.toLocaleString('vi-VN')}M$**`
                });

            const closeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('money_done')
                    .setLabel('✅ Đã Duyệt Đơn')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(true),

                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Đóng Ticket')
                    .setEmoji('🔒')
                    .setStyle(ButtonStyle.Secondary)
            );

            await safeEditReply(interaction, {
                embeds: [updatedEmbed],
                components: [closeRow]
            });

            try {
                const user = await client.users.fetch(order.userId);

                await user.send(
                    `🎉 **Đơn nạp của bạn đã được Admin duyệt!**\n` +
                    `💰 Money nhận được: **${order.amountM.toLocaleString('vi-VN')}M$**`
                );
            } catch (err) {}

            if (
                interaction.channel &&
                (
                    interaction.channel.name?.startsWith('ticket-bank-') ||
                    interaction.channel.name?.startsWith('ticket-card-')
                )
            ) {
                const legitChannelId =
                    process.env.LEGIT_CHANNEL_ID ||
                    process.env.LOG_CHANNEL_ID;

                const legitText = legitChannelId
                    ? ` tại <#${legitChannelId}>`
                    : '';

                await interaction.channel.send(
                    `✨ <@${order.userId}> **Giao dịch đã hoàn tất!**\n` +
                    `Vui lòng gửi đánh giá/legit${legitText} để ủng hộ shop.\n` +
                    `🔒 Sau khi gửi legit, Admin có thể bấm **Đóng Ticket**.`
                );
            }

            return;
        }

        order.status = 'rejected';
        order.rejectedBy = interaction.user.id;
        order.rejectedAt = Date.now();

        orders[orderId] = order;
        saveMoneyOrders(orders);

        const updatedEmbed = EmbedBuilder.from(
            interaction.message.embeds[0]
        )
            .setColor('#e74c3c')
            .setTitle('❌ ĐƠN TẠM BỊ TỪ CHỐI')
            .addFields({
                name: '📌 Trạng thái',
                value:
                    `❌ Bị từ chối bởi <@${interaction.user.id}>\n` +
                    `💡 Vui lòng kiểm tra lại thông tin đơn.`
            });

        const activeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`money_approve_${orderId}`)
                .setLabel('Duyệt Lại Đơn')
                .setEmoji('✅')
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Đóng Ticket')
                .setEmoji('🔒')
                .setStyle(ButtonStyle.Secondary)
        );

        await safeEditReply(interaction, {
            embeds: [updatedEmbed],
            components: [activeRow]
        });

        try {
            const user = await client.users.fetch(order.userId);

            await user.send(
                `❌ **Đơn nạp của bạn đang bị từ chối/tạm dừng.**\n` +
                `Vui lòng phản hồi trong Ticket để được Admin hỗ trợ.`
            );
        } catch (err) {}

        return;
    }

    // ========================================================
    // CHECK GIỜ LÀM VIỆC & STOCK KHI BẤM NÚT MUA
    // ========================================================

    if (!isWithinWorkingHours() && id !== 'guide') {
        const startHour = moneyConfig.workingHours?.start ?? 10;
        const endHour = moneyConfig.workingHours?.end ?? 22;
        return safeReply(interaction, {
            content: `🛑 **Shop hiện đã đóng cửa!**\n⏰ Giờ hoạt động của Bot: **${startHour}h00 - ${endHour}h00**. Vui lòng quay lại sau!`,
            flags: MessageFlags.Ephemeral
        });
    }

    if (currentStockM <= 0 && id !== 'guide') {
        return safeReply(interaction, {
            content: '🔴 **Hệ thống đang tạm HẾT KHO STOCK MONEY.**',
            flags: MessageFlags.Ephemeral
        });
    }

    if (id === 'buy_bank') {
        const modal = new ModalBuilder()
            .setCustomId('modal_bank')
            .setTitle(`Mua Bank - Rate ${RATE}đ/1M`);

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('bank_name')
                    .setLabel('Tên Ingame')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('bank_vnd')
                    .setLabel('Số tiền nạp (VNĐ)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Ví dụ: 10k, 20k, 50k')
                    .setRequired(true)
            )
        );

        try {
            return await interaction.showModal(modal);
        } catch (err) {
            if (err?.code === 40060) {
                console.log('⚠️ Modal bank đã được acknowledge.');
                return;
            }
            console.error('Lỗi show modal bank:', err.message);
        }
    }

    if (id === 'buy_card') {
        const modal = new ModalBuilder()
            .setCustomId('modal_card')
            .setTitle(`Nạp Thẻ - Rate ${RATE}đ/1M`);

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('card_ign')
                    .setLabel('Tên Ingame')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('card_type')
                    .setLabel('Loại thẻ')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Viettel, Zing...')
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('card_val')
                    .setLabel('Mệnh giá thẻ')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('10k, 20k, 50k...')
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('card_code')
                    .setLabel('Mã thẻ (Pin)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('card_seri')
                    .setLabel('Mã Seri')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            )
        );

        try {
            return await interaction.showModal(modal);
        } catch (err) {
            if (err?.code === 40060) {
                console.log('⚠️ Modal card đã được acknowledge.');
                return;
            }
            console.error('Lỗi show modal card:', err.message);
        }
    }

    if (id === 'calc_price') {
        const modal = new ModalBuilder()
            .setCustomId('modal_calc')
            .setTitle('Tính Tiền Money');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('calc_money')
                    .setLabel('Nhập số Money (b, m, k)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            )
        );

        try {
            return await interaction.showModal(modal);
        } catch (err) {
            if (err?.code === 40060) {
                console.log('⚠️ Modal calc đã được acknowledge.');
                return;
            }
            console.error('Lỗi show modal calc:', err.message);
        }
    }

    if (id === 'guide') {
        const startHour = moneyConfig.workingHours?.start ?? 10;
        const endHour = moneyConfig.workingHours?.end ?? 22;
        return safeReply(interaction, {
            content:
                `📖 **HƯỚNG DẪN MUA MONEY KINGSMP**\n\n` +
                `• Giờ hoạt động: **${startHour}h00 - ${endHour}h00**\n` +
                `• Rate Bank: **${RATE} VNĐ = 1M$**\n` +
                `• Thẻ cào: trừ **20%**\n` +
                `• Kho hiện tại: **${formatStock(currentStockM)}**`,
            flags: MessageFlags.Ephemeral
        });
    }
}

// ============================================================
// 12. MONEY MODALS
// ============================================================

async function handleMoneyModal(interaction) {
    if (interaction.customId === 'modal_bank') {
        const ign = interaction.fields
            .getTextInputValue('bank_name')
            .trim();

        const rawVnd = interaction.fields
            .getTextInputValue('bank_vnd');

        const vndAmount = Math.floor(parseCardValue(rawVnd));
        const moneyReceivedM =
            vndAmount > 0
                ? Math.floor(vndAmount / RATE)
                : 0;

        if (vndAmount < 1000) {
            return safeReply(interaction, {
                content: '❌ Số tiền không hợp lệ! Tối thiểu 1.000 VNĐ.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (moneyReceivedM <= 0) {
            return safeReply(interaction, {
                content:
                    `❌ Số tiền quá thấp. Với Rate ${RATE}đ/1M, ` +
                    `số tiền phải đủ để nhận ít nhất 1M$.`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (moneyReceivedM > currentStockM) {
            return safeReply(interaction, {
                content:
                    `❌ Kho không đủ!\n` +
                    `Bạn muốn: **${moneyReceivedM.toLocaleString('vi-VN')}M$**\n` +
                    `Kho còn: **${formatStock(currentStockM)}**`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (!(await safeDeferReply(interaction, {
            flags: MessageFlags.Ephemeral
        }))) return;

        const orderId = `M${Date.now()}${Math.random()
            .toString(36)
            .slice(2, 7)
            .toUpperCase()}`;

        const memo = `KSMP ${ign}`;

        const qrUrl =
            `https://img.vietqr.io/image/` +
            `${BANK_CONFIG.BANK_ID}-${BANK_CONFIG.ACCOUNT_NO}-compact2.png` +
            `?amount=${vndAmount}` +
            `&addInfo=${encodeURIComponent(memo)}` +
            `&accountName=${encodeURIComponent(BANK_CONFIG.ACCOUNT_NAME)}`;

        const orders = getMoneyOrders();

        orders[orderId] = {
            id: orderId,
            type: 'bank',
            userId: interaction.user.id,
            username: interaction.user.username,
            ign,
            vndAmount,
            amountM: moneyReceivedM,
            status: 'pending',
            createdAt: Date.now()
        };

        saveMoneyOrders(orders);

        try {
            const ticketChannel = await interaction.guild.channels.create({
                name: `ticket-bank-${ign.toLowerCase().replace(/[^a-z0-9-_]/gi, '').slice(0, 70)}`,
                type: ChannelType.GuildText,

                permissionOverwrites: [
                    {
                        id: interaction.guild.id,
                        deny: [PermissionsBitField.Flags.ViewChannel]
                    },
                    {
                        id: interaction.user.id,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.AttachFiles
                        ]
                    },
                    ...adminOverwrite(interaction.guild.id)
                ]
            });

            await ticketChannel.setTopic(`moneyOrder:${orderId}`);

            const qrEmbed = new EmbedBuilder()
                .setTitle('💳 THÔNG TIN CHUYỂN KHOẢN BANK')
                .setColor('#3498db')
                .setDescription(
                    `Chào <@${interaction.user.id}>!\n` +
                    `Vui lòng chuyển khoản đúng thông tin bên dưới.\n\n` +
                    `📸 **SAU KHI CHUYỂN TIỀN, GỬI ẢNH BILL VÀO KÊNH NÀY.**`
                )
                .addFields(
                    {
                        name: '👤 Ingame',
                        value: `\`${ign}\``,
                        inline: true
                    },
                    {
                        name: '💰 Money nhận',
                        value: `\`${moneyReceivedM.toLocaleString('vi-VN')}M$\``,
                        inline: true
                    },
                    {
                        name: '💵 Số tiền',
                        value: `\`${vndAmount.toLocaleString('vi-VN')} VNĐ\``,
                        inline: true
                    },
                    {
                        name: '🏦 Ngân hàng',
                        value: `\`MBBANK\` - STK: \`${BANK_CONFIG.ACCOUNT_NO}\``
                    },
                    {
                        name: '👤 Chủ tài khoản',
                        value: `\`${BANK_CONFIG.ACCOUNT_NAME}\``
                    },
                    {
                        name: '📌 Nội dung CK',
                        value: `\`\`\`${memo}\`\`\``
                    }
                )
                .setImage(qrUrl)
                .setFooter({
                    text: `Mã đơn: ${orderId} • Admin kiểm tra bill trước khi duyệt`
                })
                .setTimestamp();

            const adminRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`money_approve_${orderId}`)
                    .setLabel('Duyệt Đơn')
                    .setEmoji('✅')
                    .setStyle(ButtonStyle.Success),

                new ButtonBuilder()
                    .setCustomId(`money_reject_${orderId}`)
                    .setLabel('Từ Chối')
                    .setEmoji('❌')
                    .setStyle(ButtonStyle.Danger),

                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Đóng Ticket')
                    .setEmoji('🔒')
                    .setStyle(ButtonStyle.Secondary)
            );

            await ticketChannel.send({
                content: `<@${interaction.user.id}>`,
                embeds: [qrEmbed],
                components: [adminRow]
            });

            orders[orderId].ticketChannelId = ticketChannel.id;
            orders[orderId].ticketUrl = `https://discord.com/channels/${interaction.guild.id}/${ticketChannel.id}`;
            saveMoneyOrders(orders);

            let adminNotified = false;
            if (process.env.LOG_CHANNEL_ID) {
                try {
                    const logChannel = await client.channels.fetch(process.env.LOG_CHANNEL_ID);
                    if (logChannel?.isTextBased()) {
                        await logChannel.send({
                            content: process.env.ADMIN_DISCORD_ID
                                ? `🚨 <@${process.env.ADMIN_DISCORD_ID}> **CÓ TICKET MONEY MỚI!**`
                                : '🚨 **CÓ TICKET MONEY MỚI!**',
                            embeds: [qrEmbed]
                        });
                        adminNotified = true;
                    }
                } catch (err) {
                    console.error('❌ Không gửi được log ticket bank:', err?.message || err);
                }
            }

            if (!adminNotified && process.env.ADMIN_DISCORD_ID) {
                try {
                    const adminUser = await client.users.fetch(process.env.ADMIN_DISCORD_ID);
                    await adminUser.send({
                        content: '🚨 **CÓ TICKET MONEY MỚI!**',
                        embeds: [qrEmbed]
                    });
                } catch (err) {
                    console.error('❌ Không gửi được DM Admin:', err?.message || err);
                }
            }

            return safeEditReply(interaction, {
                content:
                    `✅ **ĐÃ TẠO TICKET NẠP BANK!**\n` +
                    `👉 ${ticketChannel}\n` +
                    `🆔 Mã đơn: \`${orderId}\`\n` +
                    `📸 Gửi ảnh Bill vào ticket.`
            });
        } catch (err) {
            delete orders[orderId];
            saveMoneyOrders(orders);

            return safeEditReply(interaction, {
                content:
                    `❌ Không thể tạo Ticket: \`${err.message}\`\n` +
                    `Kiểm tra quyền **Manage Channels** của Bot.`
            });
        }
    }

    if (interaction.customId === 'modal_card') {
        const ign = interaction.fields
            .getTextInputValue('card_ign')
            .trim();

        const type = interaction.fields
            .getTextInputValue('card_type')
            .trim();

        const val = interaction.fields
            .getTextInputValue('card_val')
            .trim();

        const code = interaction.fields
            .getTextInputValue('card_code')
            .trim();

        const seri = interaction.fields
            .getTextInputValue('card_seri')
            .trim();

        const cardValueVnd = Math.floor(parseCardValue(val));

        if (cardValueVnd < 1000) {
            return safeReply(interaction, {
                content: '❌ Mệnh giá thẻ không hợp lệ.',
                flags: MessageFlags.Ephemeral
            });
        }

        const netVnd = Math.floor(
            cardValueVnd * (1 - CARD_DISCOUNT)
        );

        const moneyReceivedM =
            Math.floor(netVnd / RATE);

        if (moneyReceivedM <= 0) {
            return safeReply(interaction, {
                content: '❌ Mệnh giá thẻ quá thấp để quy đổi thành Money.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (moneyReceivedM > currentStockM) {
            return safeReply(interaction, {
                content:
                    `❌ Kho không đủ!\n` +
                    `Thẻ quy đổi: **${moneyReceivedM.toLocaleString('vi-VN')}M$**\n` +
                    `Kho còn: **${formatStock(currentStockM)}**`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (!(await safeDeferReply(interaction, {
            flags: MessageFlags.Ephemeral
        }))) return;

        const orderId = `C${Date.now()}${Math.random()
            .toString(36)
            .slice(2, 7)
            .toUpperCase()}`;

        const orders = getMoneyOrders();

        orders[orderId] = {
            id: orderId,
            type: 'card',
            userId: interaction.user.id,
            username: interaction.user.username,
            ign,
            cardType: type,
            cardValueVnd,
            netVnd,
            amountM: moneyReceivedM,
            cardCode: code,
            cardSeri: seri,
            status: 'pending',
            createdAt: Date.now()
        };

        saveMoneyOrders(orders);

        try {
            const ticketChannel = await interaction.guild.channels.create({
                name: `ticket-card-${ign.toLowerCase().replace(/[^a-z0-9-_]/gi, '').slice(0, 70)}`,
                type: ChannelType.GuildText,

                permissionOverwrites: [
                    {
                        id: interaction.guild.id,
                        deny: [PermissionsBitField.Flags.ViewChannel]
                    },
                    {
                        id: interaction.user.id,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.AttachFiles
                        ]
                    },
                    ...adminOverwrite(interaction.guild.id)
                ]
            });

            await ticketChannel.setTopic(`moneyOrder:${orderId}`);

            const cardEmbed = new EmbedBuilder()
                .setTitle('🎟️ THÔNG TIN ĐƠN NẠP THẺ CÀO')
                .setColor('#f1c40f')
                .setDescription(
                    `Chào <@${interaction.user.id}>!\n` +
                    `Đơn nạp thẻ đã được ghi nhận.\n` +
                    `⏳ **Admin sẽ kiểm tra thẻ trước khi duyệt.**`
                )
                .addFields(
                    {
                        name: '👤 Ingame',
                        value: `\`${ign}\``,
                        inline: true
                    },
                    {
                        name: '💳 Loại thẻ',
                        value: `\`${type}\``,
                        inline: true
                    },
                    {
                        name: '💵 Mệnh giá',
                        value: `\`${cardValueVnd.toLocaleString('vi-VN')} VNĐ\``,
                        inline: true
                    },
                    {
                        name: '💰 Money quy đổi',
                        value: `\`${moneyReceivedM.toLocaleString('vi-VN')}M$\``,
                        inline: true
                    },
                    {
                        name: '🔑 Mã thẻ',
                        value: `\`\`\`${code}\`\`\``
                    },
                    {
                        name: '🔢 Seri',
                        value: `\`\`\`${seri}\`\`\``
                    }
                )
                .setFooter({
                    text: `Mã đơn: ${orderId}`
                })
                .setTimestamp();

            const adminRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`money_approve_${orderId}`)
                    .setLabel('Duyệt Thẻ')
                    .setEmoji('✅')
                    .setStyle(ButtonStyle.Success),

                new ButtonBuilder()
                    .setCustomId(`money_reject_${orderId}`)
                    .setLabel('Từ Chối Thẻ')
                    .setEmoji('❌')
                    .setStyle(ButtonStyle.Danger),

                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Đóng Ticket')
                    .setEmoji('🔒')
                    .setStyle(ButtonStyle.Secondary)
            );

            await ticketChannel.send({
                content: `<@${interaction.user.id}>`,
                embeds: [cardEmbed],
                components: [adminRow]
            });

            orders[orderId].ticketChannelId = ticketChannel.id;
            orders[orderId].ticketUrl = `https://discord.com/channels/${interaction.guild.id}/${ticketChannel.id}`;
            saveMoneyOrders(orders);

            let adminNotified = false;
            if (process.env.LOG_CHANNEL_ID) {
                try {
                    const logChannel =
                        await client.channels.fetch(process.env.LOG_CHANNEL_ID);

                    if (logChannel?.isTextBased()) {
                        await logChannel.send({
                            content:
                                (process.env.ADMIN_DISCORD_ID
                                    ? `🚨 <@${process.env.ADMIN_DISCORD_ID}> **CÓ TICKET THẺ MỚI!**`
                                    : '🚨 **CÓ TICKET THẺ MỚI!**'),
                            embeds: [cardEmbed]
                        });
                        adminNotified = true;
                    }
                } catch (err) {
                    console.error('❌ Không gửi được log ticket card:', err?.message || err);
                }
            }

            if (!adminNotified && process.env.ADMIN_DISCORD_ID) {
                try {
                    const adminUser = await client.users.fetch(process.env.ADMIN_DISCORD_ID);
                    await adminUser.send({
                        content: '🚨 **CÓ TICKET THẺ MỚI!**',
                        embeds: [cardEmbed]
                    });
                } catch (err) {
                    console.error('❌ Không gửi được DM Admin:', err?.message || err);
                }
            }

            return safeEditReply(interaction, {
                content:
                    `✅ **ĐÃ TẠO TICKET NẠP THẺ!**\n` +
                    `👉 ${ticketChannel}\n` +
                    `🆔 Mã đơn: \`${orderId}\``
            });
        } catch (err) {
            delete orders[orderId];
            saveMoneyOrders(orders);

            return safeEditReply(interaction, {
                content:
                    `❌ Không thể tạo Ticket: \`${err.message}\``
            });
        }
    }

    if (interaction.customId === 'modal_calc') {
        const rawInput =
            interaction.fields.getTextInputValue('calc_money');

        const moneyM = parseMoneyToM(rawInput);

        if (moneyM <= 0) {
            return safeReply(interaction, {
                content: '❌ Số Money không hợp lệ.',
                flags: MessageFlags.Ephemeral
            });
        }

        const priceBankVnd =
            Math.round(moneyM * RATE);

        const requiredCardVnd =
            Math.round(priceBankVnd / (1 - CARD_DISCOUNT));

        const warning =
            moneyM > currentStockM
                ? `\n⚠️ Số Money này vượt Stock hiện tại: **${formatStock(currentStockM)}**`
                : '';

        return safeReply(interaction, {
            content:
                `🧮 **BẢNG TÍNH GIÁ MONEY**\n` +
                `• Mua: \`${rawInput}\` → **${moneyM.toLocaleString('vi-VN')}M$**\n` +
                `💵 Bank: **${priceBankVnd.toLocaleString('vi-VN')} VNĐ**\n` +
                `🎟️ Thẻ cào: **${requiredCardVnd.toLocaleString('vi-VN')} VNĐ**` +
                warning,
            flags: MessageFlags.Ephemeral
        });
    }
}

// ============================================================
// 13. ACCOUNT DATA
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
        .setColor(
            acc.status === 'available'
                ? '#2ecc71'
                : acc.status === 'pending'
                    ? '#f1c40f'
                    : '#e74c3c'
        )
        .setAuthor({ name: 'AUTO BUY' })
        .setTitle(`🎮 ${acc.username}`)
        .setDescription(
            `🏷️ **Giá Bank:** ${acc.priceBank.toLocaleString('vi-VN')} VNĐ\n` +
            `🎟️ **Giá Thẻ:** ${acc.priceCard.toLocaleString('vi-VN')} VNĐ\n` +
            `✅ **Trạng thái:** ${
                acc.status === 'available'
                    ? '🟢 Có Sẵn'
                    : acc.status === 'pending'
                        ? '🟡 Đang Có Người Mua'
                        : '🔴 Đã Bán'
            }`
        )
        .addFields(
            {
                name: '🏷️ Username',
                value: `\`${acc.username}\``
            },
            {
                name: '👕 Cape Số Lượng',
                value: `\`${acc.capeCount}\``,
                inline: true
            },
            {
                name: '✨ Cape Chi Tiết',
                value: `\`${acc.capeList || 'Không'}\``,
                inline: true
            },
            {
                name: '⭐ Rank',
                value: `\`${acc.rank}\``
            }
        );

    if (acc.imageUrl) {
        embed.setImage(acc.imageUrl);
    }

    return embed;
}

async function updateAccListingMessage(acc) {
    if (!acc?.channelId || !acc?.messageId) {
        console.log(`⚠️ Không có channelId/messageId để cập nhật listing: ${acc?.username || acc?.id}`);
        return false;
    }

    try {
        const channel = await client.channels.fetch(String(acc.channelId));

        if (!channel || !channel.isTextBased()) {
            console.error(`❌ Không truy cập được channel listing của acc ${acc.username}`);
            return false;
        }

        const message = await channel.messages.fetch(String(acc.messageId));

        const soldRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`sold_${acc.id}`)
                .setLabel('🔴 Đã Bán')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(true)
        );

        await message.edit({
            embeds: [createAccEmbed(acc)],
            components: [soldRow]
        });

        console.log(`✅ Listing ${acc.username} đã chuyển sang ĐÃ BÁN.`);
        return true;
    } catch (err) {
        console.error(
            `❌ Không cập nhật được listing ${acc.username}:`,
            err?.message || err
        );
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
            new ButtonBuilder()
                .setCustomId(`buy_single_${acc.id}`)
                .setLabel('Mua Ngay')
                .setEmoji('🛒')
                .setStyle(ButtonStyle.Success)
        );

        await message.edit({
            embeds: [createAccEmbed(acc)],
            components: [buyRow]
        });

        console.log(`✅ Listing ${acc.username} đã trở lại CÓ SẴN.`);
        return true;
    } catch (err) {
        console.error(
            `❌ Không cập nhật được listing available ${acc.username}:`,
            err?.message || err
        );
        return false;
    }
}

// ============================================================
// 14. ACCOUNT COMMANDS
// ============================================================

async function handleAccCommand(interaction) {
    if (!isAdminUser(interaction)) {
        return safeReply(interaction, {
            content: '❌ Bạn không có quyền dùng lệnh này!',
            flags: MessageFlags.Ephemeral
        });
    }

    if (interaction.commandName === 'setstockacc') {
        if (!(await safeDeferReply(interaction, {
            flags: MessageFlags.Ephemeral
        }))) return;

        const rawData =
            interaction.options.getString('danh_sach');

        const lines = rawData
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);

        const stock = getAccStock();

        let count = 0;

        for (const line of lines) {
            const parts = line
                .split('|')
                .map(p => p.trim());

            if (parts.length >= 2) {
                stock.push({
                    id:
                        `stock_${Date.now()}_` +
                        Math.random().toString(36).slice(2, 8),

                    name: parts[0] || 'Chưa đặt tên',
                    email: parts[1] || 'Không có email',
                    recoveryCode: parts[2] || 'Không có'
                });

                count++;
            }
        }

        saveAccStock(stock);

        return safeEditReply(interaction, {
            content:
                `✅ Đã thêm **${count} acc** vào kho!\n` +
                `📦 Tổng kho: **${stock.length} acc**`
        });
    }

    if (interaction.commandName === 'acc') {
        if (!(await safeDeferReply(interaction, {
            flags: MessageFlags.Ephemeral
        }))) return;

        const stock = getAccStock();

        if (stock.length === 0) {
            return safeEditReply(interaction, {
                content:
                    '❌ Kho tài khoản đang trống! Dùng `/setstockacc` để thêm.'
            });
        }

        const options = stock.slice(0, 25).map(item => {
            const safeName =
                String(item.name || 'Không có tên').slice(0, 100);

            const safeEmail =
                String(item.email || 'Không có email').slice(0, 90);

            return new StringSelectMenuOptionBuilder()
                .setLabel(safeName)
                .setDescription(`Email: ${safeEmail}`)
                .setValue(String(item.id));
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_stock_acc_manual')
            .setPlaceholder('📦 Chọn 1 tài khoản để lấy...')
            .addOptions(options);

        return safeEditReply(interaction, {
            content:
                `📦 **Kho tài khoản: ${stock.length} acc**\n` +
                `Chọn tài khoản bên dưới:`,
            components: [
                new ActionRowBuilder().addComponents(selectMenu)
            ]
        });
    }

    if (interaction.commandName === 'deleteacc') {
        if (!(await safeDeferReply(interaction, {
            flags: MessageFlags.Ephemeral
        }))) return;

        const stock = getAccStock();

        if (stock.length === 0) {
            return safeEditReply(interaction, {
                content: '❌ Kho tài khoản đang trống!'
            });
        }

        const options = stock.slice(0, 25).map(item => {
            const safeName =
                String(item.name || 'Không tên').slice(0, 100);

            const safeEmail =
                String(item.email || 'Không email').slice(0, 90);

            return new StringSelectMenuOptionBuilder()
                .setLabel(safeName)
                .setDescription(`Email: ${safeEmail}`)
                .setValue(String(item.id));
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_delete_acc_menu')
            .setPlaceholder('🗑️ Chọn tài khoản muốn xóa...')
            .addOptions(options);

        return safeEditReply(interaction, {
            content:
                `🗑️ **Kho hiện có ${stock.length} acc**\n` +
                `Chọn tài khoản muốn xóa:`,
            components: [
                new ActionRowBuilder().addComponents(selectMenu)
            ]
        });
    }

    if (interaction.commandName === 'thongtin') {
        if (!(await safeDeferReply(interaction, {
            flags: MessageFlags.Ephemeral
        }))) return;

        const username =
            interaction.options.getString('username').trim();

        const priceBank =
            interaction.options.getInteger('price_bank');

        const priceCard =
            interaction.options.getInteger('price_card');

        const capeCount =
            interaction.options.getInteger('cape_count');

        const capeList =
            interaction.options.getString('cape_list').trim();

        const rank =
            interaction.options.getString('rank');

        const imageUrl =
            interaction.options.getString('image_url') || null;

        const accs = getDetailedAccs();

        const newAcc = {
            id: `acc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            username,
            priceBank,
            priceCard,
            capeCount,
            capeList,
            rank,
            imageUrl,
            status: 'available',
            channelId: interaction.channel.id,
            messageId: null,
            pendingTicketId: null,
            pendingBuyerId: null
        };

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`buy_single_${newAcc.id}`)
                .setLabel('Mua Ngay')
                .setEmoji('🛒')
                .setStyle(ButtonStyle.Success)
        );

        const msg = await interaction.channel.send({
            embeds: [createAccEmbed(newAcc)],
            components: [row]
        });

        newAcc.messageId = msg.id;

        accs.push(newAcc);
        saveDetailedAccs(accs);

        return safeEditReply(interaction, {
            content:
                `✅ Đã đăng bán Acc \`${username}\` thành công!`
        });
    }

    if (interaction.commandName === 'price') {
        if (!(await safeDeferReply(interaction, {
            flags: MessageFlags.Ephemeral
        }))) return;

        const usernameRaw = interaction.options.getString('username');

        // Tương thích với command /price cũ (type + amount) nếu Discord
        // đang còn cache phiên bản command Spawner trước đó.
        if (!usernameRaw) {
            const legacyType = interaction.options.getString('type');
            const legacyAmount = interaction.options.getInteger('amount');

            if (legacyType && Number.isInteger(legacyAmount)) {
                const legacySpawner = spawnerConfig[legacyType];

                if (!legacySpawner) {
                    return safeEditReply(interaction, {
                        content: '❌ Loại spawner không tồn tại!'
                    });
                }

                if (legacyAmount <= 0) {
                    return safeEditReply(interaction, {
                        content: '❌ Giá Spawner phải lớn hơn 0 VNĐ!'
                    });
                }

                const oldPrice = legacySpawner.price;
                legacySpawner.price = legacyAmount;

                return safeEditReply(interaction, {
                    content:
                        `✅ Đã cập nhật giá **${legacySpawner.name}** từ ` +
                        `**${oldPrice.toLocaleString('vi-VN')} VNĐ** ➡️ ` +
                        `**${legacyAmount.toLocaleString('vi-VN')} VNĐ**!\n` +
                        `*Gõ lại /shop để tạo bảng giá mới.*`
                });
            }

            return safeEditReply(interaction, {
                content: '❌ Thiếu Username. Để chỉnh giá Spawner, hãy dùng lệnh **/spawnerprice**.'
            });
        }

        const username = usernameRaw.trim();

        if (!username) {
            return safeEditReply(interaction, {
                content: '❌ Username không được để trống!'
            });
        }

        const newBank =
            interaction.options.getInteger('price_bank');

        const newCard =
            interaction.options.getInteger('price_card');

        const accs = getDetailedAccs();

        const target = accs.find(
            a => a.username.toLowerCase() === username.toLowerCase()
        );

        if (!target) {
            return safeEditReply(interaction, {
                content: `❌ Không tìm thấy Acc: \`${username}\``
            });
        }

        target.priceBank = newBank;
        target.priceCard = newCard;

        saveDetailedAccs(accs);

        try {
            const ch = await client.channels.fetch(target.channelId);
            const msg = await ch.messages.fetch(target.messageId);

            await msg.edit({
                embeds: [createAccEmbed(target)]
            });
        } catch (err) {}

        return safeEditReply(interaction, {
            content:
                `✅ Đã cập nhật giá cho Acc \`${username}\`!`
        });
    }

    if (interaction.commandName === 'cape') {
        if (!(await safeDeferReply(interaction, {
            flags: MessageFlags.Ephemeral
        }))) return;

        const username =
            interaction.options.getString('username').trim();

        const count =
            interaction.options.getInteger('cape_count');

        const list =
            interaction.options.getString('cape_list').trim();

        const accs = getDetailedAccs();

        const target = accs.find(
            a => a.username.toLowerCase() === username.toLowerCase()
        );

        if (!target) {
            return safeEditReply(interaction, {
                content: `❌ Không tìm thấy Acc: \`${username}\``
            });
        }

        target.capeCount = count;
        target.capeList = list;

        saveDetailedAccs(accs);

        try {
            const ch = await client.channels.fetch(target.channelId);
            const msg = await ch.messages.fetch(target.messageId);

            await msg.edit({
                embeds: [createAccEmbed(target)]
            });
        } catch (err) {}

        return safeEditReply(interaction, {
            content:
                `✅ Đã cập nhật Cape cho Acc \`${username}\`: ` +
                `**${count} Cape (${list})**!`
        });
    }
}

// ============================================================
// 15. ACCOUNT SELECT MENUS
// ============================================================

async function handleAccSelectMenu(interaction) {
    if (interaction.customId === 'select_delete_acc_menu') {
        if (!isAdminUser(interaction)) {
            return safeReply(interaction, {
                content: '❌ Bạn không có quyền!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!(await safeDeferUpdate(interaction))) return;

        const selectedId = interaction.values[0];
        const stock = getAccStock();

        const target = stock.find(
            a => String(a.id) === String(selectedId)
        );

        if (!target) {
            return safeEditReply(interaction, {
                content: '❌ Tài khoản này không còn trong kho!',
                components: []
            });
        }

        const confirmRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`confirm_delete_${target.id}`)
                .setLabel('Xác Nhận Xóa')
                .setEmoji('🗑️')
                .setStyle(ButtonStyle.Danger),

            new ButtonBuilder()
                .setCustomId('cancel_delete')
                .setLabel('Hủy Bỏ')
                .setEmoji('❌')
                .setStyle(ButtonStyle.Secondary)
        );

        return safeEditReply(interaction, {
            content:
                `⚠️ **Xác nhận xóa tài khoản?**\n` +
                `• Tên: \`${target.name}\`\n` +
                `• Email: \`${target.email}\``,
            components: [confirmRow]
        });
    }

    if (interaction.customId === 'select_stock_acc_manual') {
        if (!isAdminUser(interaction)) {
            return safeReply(interaction, {
                content: '❌ Bạn không có quyền!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!(await safeDeferUpdate(interaction))) return;

        const selectedId = interaction.values[0];
        const stock = getAccStock();

        const index = stock.findIndex(
            a => String(a.id) === String(selectedId)
        );

        if (index === -1) {
            return safeEditReply(interaction, {
                content: '❌ Tài khoản không còn trong kho!',
                components: []
            });
        }

        const [foundAcc] = stock.splice(index, 1);

        saveAccStock(stock);

        const embed = new EmbedBuilder()
            .setTitle(`🔑 THÔNG TIN ACC: ${foundAcc.name}`)
            .setColor('#3498db')
            .addFields(
                {
                    name: '🏷️ Tên / Ghi chú',
                    value: `\`${foundAcc.name || 'Không có'}\``
                },
                {
                    name: '📧 Email',
                    value: `\`\`\`${foundAcc.email || 'Không có'}\`\`\``
                },
                {
                    name: '🔑 Recovery Code',
                    value:
                        `\`\`\`${foundAcc.recoveryCode || 'Không có'}\`\`\``
                }
            )
            .setFooter({
                text: '⚠️ Tài khoản đã được rút khỏi kho!'
            });

        return safeEditReply(interaction, {
            content:
                `✅ Đã rút thành công: \`${foundAcc.name}\``,
            embeds: [embed],
            components: []
        });
    }

    if (interaction.customId.startsWith('select_deliver_acc_')) {
        if (!isAdminUser(interaction)) {
            return safeReply(interaction, {
                content: '❌ Chỉ Admin mới có quyền chọn!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!(await safeDeferUpdate(interaction))) return;

        const targetMessageId =
            interaction.customId.replace('select_deliver_acc_', '');

        const selectedId = interaction.values[0];

        const stock = getAccStock();

        const index = stock.findIndex(
            a => String(a.id) === String(selectedId)
        );

        if (index === -1) {
            return safeEditReply(interaction, {
                content:
                    '❌ Tài khoản đã bị lấy hoặc không tồn tại!',
                components: []
            });
        }

        const topic = interaction.channel.topic || '';

        if (!topic.startsWith('accOrder:')) {
            return safeEditReply(interaction, {
                content: '❌ Không xác định được đơn hàng Account của Ticket này.',
                components: []
            });
        }

        const accId = topic.replace('accOrder:', '');

        const accs = getDetailedAccs();

        const target = accs.find(
            a => a.id === accId
        );

        if (!target) {
            return safeEditReply(interaction, {
                content: '❌ Không tìm thấy sản phẩm Account!',
                components: []
            });
        }

        if (target.status !== 'pending') {
            return safeEditReply(interaction, {
                content:
                    `⚠️ Đơn này không còn ở trạng thái chờ. ` +
                    `Hiện tại: \`${target.status}\``,
                components: []
            });
        }

        const [deliveredAcc] = stock.splice(index, 1);

        saveAccStock(stock);

        target.status = 'sold';
        target.pendingTicketId = null;
        target.pendingBuyerId = null;
        target.soldAt = Date.now();

        saveDetailedAccs(accs);

        await updateAccListingMessage(target);

        const closeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Đóng Ticket')
                .setEmoji('🔒')
                .setStyle(ButtonStyle.Danger)
        );

        const deliverEmbed = new EmbedBuilder()
            .setTitle('🎉 THANH TOÁN THÀNH CÔNG!')
            .setColor('#2ecc71')
            .setDescription(
                'Đơn hàng đã được Admin duyệt. ' +
                'Thông tin tài khoản:'
            )
            .addFields(
                {
                    name: '🎮 Tên / Ghi chú',
                    value: `\`${deliveredAcc.name || 'Acc'}\``
                },
                {
                    name: '📧 Email',
                    value:
                        `\`\`\`${deliveredAcc.email || 'Không có'}\`\`\``
                },
                {
                    name: '🔑 Recovery Code',
                    value:
                        `\`\`\`${deliveredAcc.recoveryCode || 'Không có'}\`\`\``
                }
            )
            .setFooter({
                text:
                    `Còn lại ${stock.length} acc trong kho.`
            });

        await interaction.channel.send({
            embeds: [deliverEmbed],
            components: [closeRow]
        });

        try {
            const billMsg =
                await interaction.channel.messages.fetch(targetMessageId);

            const disabledRow =
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('approved')
                        .setLabel('Đã Duyệt & Gửi Acc')
                        .setStyle(ButtonStyle.Success)
                        .setDisabled(true)
                );

            await billMsg.edit({
                components: [disabledRow]
            });
        } catch (err) {}

        return safeEditReply(interaction, {
            content:
                `✅ Đã gửi acc \`${deliveredAcc.name || 'Acc'}\` cho khách!`,
            components: []
        });
    }
}

// ============================================================
// 16. ACCOUNT BUTTONS
// ============================================================

async function handleAccButton(interaction) {
    const id = interaction.customId;

    if (id.startsWith('confirm_delete_')) {
        if (!isAdminUser(interaction)) {
            return safeReply(interaction, {
                content: '❌ Bạn không có quyền!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!(await safeDeferUpdate(interaction))) return;

        const targetId =
            id.replace('confirm_delete_', '');

        let stock = getAccStock();

        const initialLength = stock.length;

        stock = stock.filter(
            a => String(a.id) !== String(targetId)
        );

        if (stock.length === initialLength) {
            return safeEditReply(interaction, {
                content:
                    '❌ Tài khoản đã bị xóa hoặc không tồn tại!',
                components: []
            });
        }

        saveAccStock(stock);

        return safeEditReply(interaction, {
            content:
                `✅ Đã xóa tài khoản!\n` +
                `📦 Kho còn: **${stock.length} acc**`,
            components: []
        });
    }

    if (id === 'cancel_delete') {
        if (!(await safeDeferUpdate(interaction))) return;

        return safeEditReply(interaction, {
            content: '❌ Đã hủy thao tác xóa.',
            components: []
        });
    }

    if (id.startsWith('buy_single_')) {
        if (!isWithinWorkingHours()) {
            const startHour = moneyConfig.workingHours?.start ?? 10;
            const endHour = moneyConfig.workingHours?.end ?? 22;
            return safeReply(interaction, {
                content: `🛑 **Shop hiện đã đóng cửa!**\n⏰ Giờ hoạt động của Bot: **${startHour}h00 - ${endHour}h00**. Vui lòng quay lại sau!`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (!(await safeDeferReply(interaction, {
            flags: MessageFlags.Ephemeral
        }))) return;

        const accId =
            id.replace('buy_single_', '');

        const accs = getDetailedAccs();

        const target =
            accs.find(a => a.id === accId);

        if (!target || target.status !== 'available') {
            return safeEditReply(interaction, {
                content:
                    '❌ Sản phẩm hiện không có sẵn hoặc đang được người khác mua.'
            });
        }

        const guild = interaction.guild;

        const channelName =
            `ticket-${interaction.user.username}`
                .toLowerCase()
                .replace(/[^a-z0-9-_]/g, '')
                .slice(0, 70);

        try {
            const ticketChannel =
                await guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,

                    permissionOverwrites: [
                        {
                            id: guild.id,
                            deny: [
                                PermissionsBitField.Flags.ViewChannel
                            ]
                        },
                        {
                            id: interaction.user.id,
                            allow: [
                                PermissionsBitField.Flags.ViewChannel,
                                PermissionsBitField.Flags.SendMessages,
                                PermissionsBitField.Flags.AttachFiles
                            ]
                        },
                        ...adminOverwrite(guild.id)
                    ]
                });

            await ticketChannel.setTopic(
                `accOrder:${target.id}`
            );

            target.status = 'pending';
            target.pendingTicketId = ticketChannel.id;
            target.pendingBuyerId = interaction.user.id;

            saveDetailedAccs(accs);

            const addInfoEncoded =
                encodeURIComponent(
                    `THANH TOAN DON HANG ${target.username}`
                );

            const accountNameEncoded =
                encodeURIComponent(
                    BANK_CONFIG.ACCOUNT_NAME
                );

            const qrUrl =
                `https://img.vietqr.io/image/` +
                `${BANK_CONFIG.BANK_ID}-${BANK_CONFIG.ACCOUNT_NO}-compact2.png` +
                `?amount=${target.priceBank}` +
                `&addInfo=${addInfoEncoded}` +
                `&accountName=${accountNameEncoded}`;

            const payEmbed =
                new EmbedBuilder()
                    .setTitle(
                        `💳 THANH TOÁN: ${target.username}`
                    )
                    .setColor('#2ecc71')
                    .setDescription(
                        'Vui lòng chuyển khoản đúng số tiền bên dưới.'
                    )
                    .addFields(
                        {
                            name: '🏦 Ngân Hàng',
                            value: `\`${BANK_CONFIG.BANK_ID}\``,
                            inline: true
                        },
                        {
                            name: '🔢 Số Tài Khoản',
                            value: `\`${BANK_CONFIG.ACCOUNT_NO}\``,
                            inline: true
                        },
                        {
                            name: '👤 Chủ Tài Khoản',
                            value: `\`${BANK_CONFIG.ACCOUNT_NAME}\``,
                            inline: true
                        },
                        {
                            name: '💵 Giá Bank',
                            value:
                                `\`${target.priceBank.toLocaleString('vi-VN')} VNĐ\``,
                            inline: true
                        },
                        {
                            name: '📲 Giá Thẻ Cào',
                            value:
                                `\`${target.priceCard.toLocaleString('vi-VN')} VNĐ\``,
                            inline: true
                        }
                    )
                    .setImage(qrUrl)
                    .setFooter({
                        text:
                            'Gửi ảnh Bill chuyển khoản vào kênh này sau khi thanh toán!'
                    });

            await ticketChannel.send({
                content: `<@${interaction.user.id}>`,
                embeds: [payEmbed]
            });

            return safeEditReply(interaction, {
                content:
                    `✅ **Đã tạo Ticket mua Acc!**\n` +
                    `👉 ${ticketChannel}`
            });
        } catch (err) {
            target.status = 'available';
            target.pendingTicketId = null;
            target.pendingBuyerId = null;
            saveDetailedAccs(accs);

            return safeEditReply(interaction, {
                content:
                    `❌ Lỗi khi tạo Ticket: \`${err.message}\``
            });
        }
    }

    if (id === 'approve_bill') {
        if (!isAdminUser(interaction)) {
            return safeReply(interaction, {
                content:
                    '❌ Chỉ Admin mới có quyền duyệt đơn!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!(await safeDeferReply(interaction, {
            flags: MessageFlags.Ephemeral
        }))) return;

        const topic =
            interaction.channel.topic || '';

        if (!topic.startsWith('accOrder:')) {
            return safeEditReply(interaction, {
                content:
                    '❌ Ticket này không phải Ticket mua Account.'
            });
        }

        const accId =
            topic.replace('accOrder:', '');

        const accs =
            getDetailedAccs();

        const target =
            accs.find(a => a.id === accId);

        if (!target) {
            return safeEditReply(interaction, {
                content:
                    '❌ Không tìm thấy sản phẩm Account.'
            });
        }

        if (target.status !== 'pending') {
            return safeEditReply(interaction, {
                content:
                    `⚠️ Sản phẩm không còn chờ duyệt. ` +
                    `Trạng thái: \`${target.status}\``
            });
        }

        const stock =
            getAccStock();

        if (stock.length === 0) {
            return safeEditReply(interaction, {
                content:
                    '❌ Kho Account đang trống! Dùng `/setstockacc` để thêm acc.'
            });
        }

        const options =
            stock.slice(0, 25).map(item => {
                const safeName =
                    String(item.name || 'Không tên')
                        .slice(0, 100);

                const safeEmail =
                    String(item.email || 'Không email')
                        .slice(0, 90);

                return new StringSelectMenuOptionBuilder()
                    .setLabel(safeName)
                    .setDescription(`Email: ${safeEmail}`)
                    .setValue(String(item.id));
            });

        const selectMenu =
            new StringSelectMenuBuilder()
                .setCustomId(
                    `select_deliver_acc_${interaction.message.id}`
                )
                .setPlaceholder(
                    '📦 Chọn tài khoản trong kho để gửi...'
                )
                .addOptions(options);

        return safeEditReply(interaction, {
            content:
                `📋 Kho hiện có **${stock.length} acc**.\n` +
                `Chọn 1 acc để gửi cho khách:`,
            components: [
                new ActionRowBuilder().addComponents(selectMenu)
            ]
        });
    }

    if (id === 'reject_bill') {
        if (!isAdminUser(interaction)) {
            return safeReply(interaction, {
                content:
                    '❌ Chỉ Admin mới có quyền từ chối!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!(await safeDeferUpdate(interaction))) return;

        const resetRow =
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('approve_bill')
                    .setLabel('Duyệt - Chọn Acc')
                    .setEmoji('✅')
                    .setStyle(ButtonStyle.Success),

                new ButtonBuilder()
                    .setCustomId('reject_bill')
                    .setLabel('Từ Chối')
                    .setEmoji('❌')
                    .setStyle(ButtonStyle.Danger)
            );

        await interaction.message.edit({
            components: [resetRow]
        });

        return interaction.channel.send(
            '⚠️ **Bill chưa hợp lệ hoặc giao dịch chưa hoàn tất.**\n' +
            'Vui lòng gửi lại bill chính xác để Admin kiểm tra.'
        );
    }
}

// ============================================================
// 17. CLOSE TICKET
// ============================================================

async function handleCloseTicket(interaction) {
    if (!isAdminUser(interaction)) {
        return safeReply(interaction, {
            content:
                '❌ Chỉ Admin mới có quyền đóng Ticket!',
            flags: MessageFlags.Ephemeral
        });
    }

    const topic =
        interaction.channel?.topic || '';

    if (topic.startsWith('accOrder:')) {
        const accId =
            topic.replace('accOrder:', '');

        const accs =
            getDetailedAccs();

        const target =
            accs.find(a => a.id === accId);

        if (target && target.status === 'pending') {
            target.status = 'available';
            target.pendingTicketId = null;
            target.pendingBuyerId = null;

            saveDetailedAccs(accs);

            await updateAccListingAvailable(target);
        }
    }

    await safeReply(interaction, {
        content:
            '🔒 **Kênh Ticket sẽ tự động xóa sau 5 giây...**'
    });

    setTimeout(() => {
        interaction.channel.delete().catch(() => {});
    }, 5000);
}


// ============================================================
// 17A. SPAWNER HANDLERS
// ============================================================

async function handleSpawnerCommand(interaction) {
    if (interaction.commandName === 'shop') {
        return safeReply(interaction, {
            embeds: [createShopEmbed()],
            components: [createShopButtons()]
        });
    }

    if (interaction.commandName === 'spawnerprice') {
        if (!isAdminUser(interaction)) {
            return safeReply(interaction, {
                content: '❌ Bạn không có quyền sử dụng lệnh này!',
                flags: MessageFlags.Ephemeral
            });
        }

        const type = interaction.options.getString('type');
        const newPrice = interaction.options.getInteger('amount');
        const spawner = spawnerConfig[type];

        if (!spawner) {
            return safeReply(interaction, {
                content: '❌ Loại spawner không tồn tại!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!Number.isInteger(newPrice) || newPrice <= 0) {
            return safeReply(interaction, {
                content: '❌ Giá Spawner phải là số nguyên lớn hơn 0 VNĐ!',
                flags: MessageFlags.Ephemeral
            });
        }

        const oldPrice = spawner.price;
        spawner.price = newPrice;

        return safeReply(interaction, {
            content:
                `✅ Đã cập nhật giá **${spawner.name}** từ ` +
                `**${oldPrice.toLocaleString('vi-VN')} VNĐ** ➡️ ` +
                `**${newPrice.toLocaleString('vi-VN')} VNĐ**!\n` +
                `*Gõ lại /shop để tạo bảng giá mới.*`,
            flags: MessageFlags.Ephemeral
        });
    }


    if (interaction.commandName === 'spawnerstock') {
        if (!isAdminUser(interaction)) {
            return safeReply(interaction, {
                content: '❌ Bạn không có quyền sử dụng lệnh này!',
                flags: MessageFlags.Ephemeral
            });
        }

        const type = interaction.options.getString('type');
        const newStock = interaction.options.getInteger('amount');
        const spawner = spawnerConfig[type];

        if (!spawner) {
            return safeReply(interaction, {
                content: '❌ Loại spawner không tồn tại!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!Number.isInteger(newStock) || newStock < 0) {
            return safeReply(interaction, {
                content: '❌ Số lượng Spawner phải là số nguyên từ 0 trở lên!',
                flags: MessageFlags.Ephemeral
            });
        }

        const oldStock = spawner.stock;
        spawner.stock = newStock;

        return safeReply(interaction, {
            content:
                `✅ Đã cập nhật kho **${spawner.name}** từ ` +
                `**${oldStock.toLocaleString('vi-VN')}** cái ➡️ ` +
                `**${newStock.toLocaleString('vi-VN')}** cái!\n` +
                `*Gõ lại /shop để tạo bảng kho mới.*`,
            flags: MessageFlags.Ephemeral
        });
    }
}

async function handleSpawnerButton(interaction) {
    const id = interaction.customId;

    // [1] Khách bấm mua -> chọn phương thức
    if (id.startsWith('spawner_buy_')) {
        const key = id.replace('spawner_buy_', '');
        const spawner = spawnerConfig[key];

        if (!spawner || spawner.stock <= 0) {
            return safeReply(interaction, {
                content: '❌ Sản phẩm này đã hết hàng!',
                flags: MessageFlags.Ephemeral
            });
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`spawner_method_bank_${key}`)
                .setLabel('Thanh toán Ngân Hàng')
                .setEmoji('🏦')
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId(`spawner_method_card_${key}`)
                .setLabel('Thanh toán Thẻ Cào (-20% Phí gạch thẻ)')
                .setEmoji('💳')
                .setStyle(ButtonStyle.Danger)
        );

        return safeReply(interaction, {
            content:
                `**Vui lòng chọn phương thức thanh toán cho ${spawner.name}:**\n` +
                `*(Lưu ý: Nạp bằng thẻ cào điện thoại bị trừ 20% phí gạch thẻ)*`,
            components: [row],
            flags: MessageFlags.Ephemeral
        });
    }

    // [2] Chọn phương thức
    if (
        id.startsWith('spawner_method_bank_') ||
        id.startsWith('spawner_method_card_')
    ) {
        const isBank = id.startsWith('spawner_method_bank_');
        const key = id.replace(
            isBank
                ? 'spawner_method_bank_'
                : 'spawner_method_card_',
            ''
        );

        const spawner = spawnerConfig[key];

        if (!spawner) {
            return safeReply(interaction, {
                content: '❌ Loại spawner không tồn tại!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (isBank) {
            const modal = new ModalBuilder()
                .setCustomId(`spawner_modal_bank_${key}`)
                .setTitle(
                    `🏦 Mua ${spawner.name.split(' ')[0]} (CK)`
                );

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('spawner_ign')
                        .setLabel('Tên trong game (IGN):')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('spawner_qty')
                        .setLabel(`Số lượng (Còn: ${spawner.stock}):`)
                        .setStyle(TextInputStyle.Short)
                        .setValue('1')
                        .setRequired(true)
                )
            );

            try {
                return await interaction.showModal(modal);
            } catch (err) {
                console.error('Lỗi show modal spawner bank:', err.message);
                return;
            }
        }

        const modal = new ModalBuilder()
            .setCustomId(`spawner_modal_card_${key}`)
            .setTitle(
                `💳 Nạp Thẻ Mua ${spawner.name.split(' ')[0]}`
            );

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('spawner_ign')
                    .setLabel('Tên trong game (IGN):')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('spawner_card_net')
                    .setLabel('Nhà mạng:')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder(
                        'Ví dụ: Viettel, Vinaphone, Mobifone...'
                    )
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('spawner_card_val')
                    .setLabel('Mệnh giá thẻ (VNĐ):')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Ví dụ: 100000 hoặc 100k')
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('spawner_pin')
                    .setLabel('Mã thẻ (PIN):')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Nhập chính xác mã PIN')
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('spawner_serial')
                    .setLabel('Số Seri (Serial):')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Nhập chính xác số Seri')
                    .setRequired(true)
            )
        );

        try {
            return await interaction.showModal(modal);
        } catch (err) {
            console.error('Lỗi show modal spawner card:', err.message);
            return;
        }
    }

    // [4] Admin xác nhận
    if (id.startsWith('spawner_confirm_')) {
        if (!isAdminUser(interaction)) {
            return safeReply(interaction, {
                content: '❌ Chỉ Admin mới dùng được nút này!',
                flags: MessageFlags.Ephemeral
            });
        }

        const parts = id.split('_');
        const key = parts[2];
        const requestedQuantity = parts[3];
        const spawner = spawnerConfig[key];

        if (!spawner) {
            return safeReply(interaction, {
                content: '❌ Lỗi hệ thống: không tìm thấy spawner.',
                flags: MessageFlags.Ephemeral
            });
        }

        const modal = new ModalBuilder()
            .setCustomId(`spawner_modal_deduct_${key}`)
            .setTitle('Xác nhận hoàn tất giao dịch');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('spawner_quantity_input')
                    .setLabel('Số lượng spawner thực tế giao:')
                    .setStyle(TextInputStyle.Short)
                    .setValue(requestedQuantity)
                    .setRequired(true)
            )
        );

        try {
            return await interaction.showModal(modal);
        } catch (err) {
            console.error('Lỗi show modal trừ kho spawner:', err.message);
            return;
        }
    }

    return null;
}

async function handleSpawnerModal(interaction) {
    const id = interaction.customId;

    // [3] Form -> tạo ticket
    if (
        id.startsWith('spawner_modal_bank_') ||
        id.startsWith('spawner_modal_card_')
    ) {
        const isBank = id.startsWith('spawner_modal_bank_');
        const key = id.replace(
            isBank
                ? 'spawner_modal_bank_'
                : 'spawner_modal_card_',
            ''
        );

        const spawner = spawnerConfig[key];

        if (!spawner) {
            return safeReply(interaction, {
                content: '❌ Lỗi hệ thống: không tìm thấy spawner.',
                flags: MessageFlags.Ephemeral
            });
        }

        let ign = '';
        let quantity = 1;
        let cardValue = 0;
        let effectiveValue = 0;
        let cardNet = '';
        let pin = '';
        let serial = '';

        if (isBank) {
            ign = interaction.fields
                .getTextInputValue('spawner_ign')
                .trim();

            quantity = parseInt(
                interaction.fields.getTextInputValue('spawner_qty'),
                10
            );

            if (Number.isNaN(quantity) || quantity <= 0) {
                return safeReply(interaction, {
                    content: '❌ Số lượng không hợp lệ!',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (quantity > spawner.stock) {
                return safeReply(interaction, {
                    content:
                        `❌ Kho chỉ còn \`${spawner.stock}\` cái!`,
                    flags: MessageFlags.Ephemeral
                });
            }
        } else {
            ign = interaction.fields
                .getTextInputValue('spawner_ign')
                .trim();

            cardNet = interaction.fields
                .getTextInputValue('spawner_card_net')
                .trim();

            const rawVal = interaction.fields
                .getTextInputValue('spawner_card_val')
                .toLowerCase()
                .trim();

            pin = interaction.fields
                .getTextInputValue('spawner_pin')
                .trim();

            serial = interaction.fields
                .getTextInputValue('spawner_serial')
                .trim();

            let multiplier = 1;
            let cleanVal = rawVal;

            if (rawVal.endsWith('k')) {
                multiplier = 1000;
                cleanVal = rawVal.slice(0, -1);
            }

            cardValue =
                parseInt(
                    cleanVal.replace(/[^0-9]/g, ''),
                    10
                ) * multiplier;

            if (!Number.isFinite(cardValue) || cardValue <= 0) {
                return safeReply(interaction, {
                    content:
                        '❌ Mệnh giá thẻ nhập vào không hợp lệ!',
                    flags: MessageFlags.Ephemeral
                });
            }

            effectiveValue = Math.floor(
                cardValue * (1 - CARD_DISCOUNT)
            );

            quantity = Math.floor(
                effectiveValue / spawner.price
            );

            if (quantity < 1) {
                return safeReply(interaction, {
                    content:
                        `❌ Thẻ mệnh giá **${cardValue.toLocaleString('vi-VN')} VNĐ** ` +
                        `(Sau khi trừ ${CARD_DISCOUNT * 100}% phí còn ` +
                        `**${effectiveValue.toLocaleString('vi-VN')} VNĐ**) ` +
                        `không đủ để mua 1 **${spawner.name}** ` +
                        `(Giá: **${spawner.price.toLocaleString('vi-VN')} VNĐ**)!`,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (quantity > spawner.stock) {
                quantity = spawner.stock;
            }

            if (quantity <= 0) {
                return safeReply(interaction, {
                    content:
                        '❌ Sản phẩm hiện đã hết hàng.',
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        if (!(await safeDeferReply(interaction, {
            flags: MessageFlags.Ephemeral
        }))) return;

        try {
            const permissionOverwrites = [
                {
                    id: interaction.guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel]
                },
                {
                    id: client.user.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ManageChannels,
                        PermissionsBitField.Flags.EmbedLinks,
                        PermissionsBitField.Flags.AttachFiles,
                        PermissionsBitField.Flags.ReadMessageHistory
                    ]
                },
                {
                    id: interaction.user.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.AttachFiles,
                        PermissionsBitField.Flags.ReadMessageHistory
                    ]
                }
            ];

            if (
                serverConfig.adminRoleId !==
                "ID_ROLE_ADMIN_CUA_BAN"
            ) {
                permissionOverwrites.push({
                    id: serverConfig.adminRoleId,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.ManageChannels
                    ]
                });
            } else {
                permissionOverwrites.push(
                    ...adminOverwrite(interaction.guild.id)
                );
            }

            const safeIgn =
                ign
                    .toLowerCase()
                    .replace(/[^a-z0-9-_]/gi, '')
                    .slice(0, 45) ||
                `user-${interaction.user.id}`;

            const ticketChannel =
                await interaction.guild.channels.create({
                    name:
                        `don-${spawner.name.split(' ')[0]}-${safeIgn}`
                            .slice(0, 90),
                    type: ChannelType.GuildText,
                    parent:
                        serverConfig.ticketCategoryId !==
                        "ID_CATEGORY_TICKET_CUA_BAN"
                            ? serverConfig.ticketCategoryId
                            : null,
                    permissionOverwrites
                });

            await ticketChannel.setTopic(
                `spawnerOrder:${key}:${interaction.user.id}`
            );

            let adminStatusText =
                "🟢 **Admin đang có mặt**, vui lòng chờ phản hồi!";

            try {
                if (
                    serverConfig.adminRoleId !==
                    "ID_ROLE_ADMIN_CUA_BAN"
                ) {
                    const adminRole =
                        interaction.guild.roles.cache.get(
                            serverConfig.adminRoleId
                        );

                    if (adminRole) {
                        await interaction.guild.members.fetch();

                        const onlineAdmins =
                            adminRole.members.filter(
                                member =>
                                    member.presence &&
                                    ['online', 'idle', 'dnd'].includes(
                                        member.presence.status
                                    )
                            );

                        if (onlineAdmins.size === 0) {
                            adminStatusText =
                                "🟡 **Hiện tại Admin đang vắng mặt.** Bạn vui lòng kiên nhẫn chờ chút nhé!";
                        }
                    }
                }
            } catch (err) {
                console.error(
                    'Không kiểm tra được trạng thái Admin:',
                    err.message
                );
            }

            const ticketEmbed =
                new EmbedBuilder().setTimestamp();

            const ticketButtons =
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(
                            `spawner_confirm_${key}_${quantity}`
                        )
                        .setLabel(
                            '✅ Admin Xác nhận & Trừ kho'
                        )
                        .setStyle(ButtonStyle.Success),

                    new ButtonBuilder()
                        .setCustomId('close_ticket')
                        .setLabel('🔒 Đóng Ticket')
                        .setStyle(ButtonStyle.Danger)
                );

            if (isBank) {
                const totalPrice =
                    spawner.price * quantity;

                const randomCode =
                    Math.floor(
                        1000 + Math.random() * 9000
                    );

                const safeMemoIgn =
                    ign
                        .replace(/[^a-zA-Z0-9]/g, '')
                        .toUpperCase();

                const memoContent =
                    `TT ${randomCode} ${safeMemoIgn}`;

                const qrImageUrl =
                    `https://img.vietqr.io/image/` +
                    `${serverConfig.bank.shortName}-${serverConfig.bank.accountNo}-compact2.png` +
                    `?amount=${totalPrice}` +
                    `&addInfo=${encodeURIComponent(memoContent)}` +
                    `&accountName=${encodeURIComponent(serverConfig.bank.accountName)}`;

                ticketEmbed
                    .setColor('#0099ff')
                    .setTitle(
                        `🏦 ĐƠN HÀNG CHUYỂN KHOẢN: ${spawner.name.toUpperCase()}`
                    )
                    .setDescription(
                        `Chào <@${interaction.user.id}>, dưới đây là thông tin đơn của bạn:\n` +
                        `• 👤 **IGN:** \`${ign}\`\n` +
                        `• 📦 **Số lượng:** \`${quantity}\` cái\n` +
                        `• 💰 **Tổng thanh toán:** **${totalPrice.toLocaleString('vi-VN')} VNĐ**\n\n` +
                        `⚠️ **ĐỢI ADMIN REP TRONG KÊNH NÀY RỒI MỚI CHUYỂN KHOẢN NHÉ!**\n` +
                        `${adminStatusText}\n\n` +
                        `───────────────────────────────────\n` +
                        `🏦 **THÔNG TIN CHUYỂN KHOẢN:**\n` +
                        `• Ngân hàng: **${serverConfig.bank.shortName}**\n` +
                        `• Số tài khoản: \`${serverConfig.bank.accountNo}\`\n` +
                        `• Chủ tài khoản: **${serverConfig.bank.accountName}**\n` +
                        `• Nội dung CK: \`${memoContent}\` *(Vui lòng ghi y hệt chữ này)*\n\n` +
                        `*(Sau khi CK xong, hãy gửi ảnh bill vào đây!)*`
                    )
                    .setImage(qrImageUrl);
            } else {
                ticketEmbed
                    .setColor('#E67E22')
                    .setTitle(
                        `💳 ĐƠN HÀNG THẺ CÀO: ${spawner.name.toUpperCase()}`
                    )
                    .setDescription(
                        `Chào <@${interaction.user.id}>, thông tin nạp thẻ của bạn đã được ghi nhận.\n` +
                        `• 👤 **IGN:** \`${ign}\`\n` +
                        `• 💵 **Mệnh giá thẻ nạp:** **${cardValue.toLocaleString('vi-VN')} VNĐ**\n` +
                        `• 📉 **Thực nhận (Sau -${CARD_DISCOUNT * 100}% phí):** **${effectiveValue.toLocaleString('vi-VN')} VNĐ**\n` +
                        `• 🎯 **Số ${spawner.name} nhận được:** \`${quantity}\` **cái** ` +
                        `*(Giá: ${spawner.price.toLocaleString('vi-VN')} VNĐ/cái)*\n\n` +
                        `${adminStatusText}\n\n` +
                        `───────────────────────────────────\n` +
                        `🧾 **THÔNG TIN THẺ NẠP:**\n` +
                        `• 🌐 **Nhà mạng:** \`${cardNet}\`\n` +
                        `• 🔑 **Mã PIN:** \`${pin}\`\n` +
                        `• 🔢 **Số SERI:** \`${serial}\`\n\n` +
                        `*Admin sẽ tiến hành nạp thẻ và giao sản phẩm cho bạn ngay khi kiểm tra xong!*`
                    );
            }

            const hasValidAdminRole =
                serverConfig.adminRoleId &&
                serverConfig.adminRoleId !==
                    "ID_ROLE_ADMIN_CUA_BAN";

            const adminMention =
                hasValidAdminRole
                    ? `<@&${serverConfig.adminRoleId}>`
                    : "@Admin";

            await ticketChannel.send({
                content:
                    `🔔 Khách: <@${interaction.user.id}> | ` +
                    `Admin: ${adminMention}`,
                embeds: [ticketEmbed],
                components: [ticketButtons],
                allowedMentions: {
                    roles: hasValidAdminRole
                        ? [serverConfig.adminRoleId]
                        : []
                }
            });

            return safeEditReply(interaction, {
                content:
                    `✅ Vui lòng vào kênh <#${ticketChannel.id}> để hoàn tất giao dịch!`
            });
        } catch (error) {
            console.error(
                'Lỗi tạo Ticket Spawner:',
                error
            );

            return safeEditReply(interaction, {
                content:
                    '❌ Lỗi tạo kênh Ticket Spawner.'
            });
        }
    }

    // [5] Hoàn tất và trừ kho
    if (id.startsWith('spawner_modal_deduct_')) {
        if (!isAdminUser(interaction)) {
            return safeReply(interaction, {
                content:
                    '❌ Chỉ Admin mới được xác nhận giao dịch!',
                flags: MessageFlags.Ephemeral
            });
        }

        const key = id.replace(
            'spawner_modal_deduct_',
            ''
        );

        const spawner =
            spawnerConfig[key];

        const quantity =
            parseInt(
                interaction.fields.getTextInputValue(
                    'spawner_quantity_input'
                ),
                10
            );

        if (!spawner) {
            return safeReply(interaction, {
                content: '❌ Lỗi hệ thống!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (
            !Number.isInteger(quantity) ||
            quantity <= 0
        ) {
            return safeReply(interaction, {
                content:
                    '❌ Số lượng giao thực tế không hợp lệ!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (quantity > spawner.stock) {
            return safeReply(interaction, {
                content:
                    `❌ Kho chỉ còn **${spawner.stock}** cái!`,
                flags: MessageFlags.Ephemeral
            });
        }

        spawner.stock -= quantity;

        const legitChannel =
            serverConfig.legitChannelId !==
            "ID_KENH_LEGIT_CUA_BAN"
                ? `<#${serverConfig.legitChannelId}>`
                : '**kênh legit**';

        return safeReply(interaction, {
            content:
                `🎉 **GIAO DỊCH SPAWNER HOÀN TẤT!**\n\n` +
                `👑 Admin <@${interaction.user.id}> đã giao thành công ` +
                `**\`${quantity}\`x ${spawner.name}**.\n` +
                `📦 Kho hiện tại còn: \`${spawner.stock}\` cái.\n\n` +
                `❤️ Cảm ơn bạn! Đừng quên ghé ${legitChannel} ` +
                `để gửi một đánh giá **+1 Legit** ủng hộ shop nhé! 🔥`
        });
    }

    return null;
}

// ============================================================
// 18. SLASH COMMANDS
// ============================================================

const MONEY_COMMAND_NAMES = [
    'setup',
    'setstock',
    'rate',
    'time'
];

const SPAWNER_COMMAND_NAMES = [
    'shop',
    'spawnerprice',
    'spawnerstock'
];

const ACC_COMMAND_NAMES = [
    'setstockacc',
    'acc',
    'deleteacc',
    'thongtin',
    'price',
    'cape'
];

const commands = [
    // SPAWNER
    new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Mở bảng cửa hàng Spawner'),

    new SlashCommandBuilder()
        .setName('spawnerprice')
        .setDescription('Thay đổi giá Spawner (Dành cho Admin)')
        .addStringOption(option =>
            option
                .setName('type')
                .setDescription('Loại spawner')
                .setRequired(true)
                .addChoices(
                    {
                        name: 'Skeleton Spawner',
                        value: 'ske'
                    },
                    {
                        name: 'Blaze Spawner',
                        value: 'blaze'
                    },
                    {
                        name: 'Creeper Spawner',
                        value: 'creeper'
                    },
                    {
                        name: 'Iron Golem Spawner',
                        value: 'golem'
                    }
                )
        )
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('Giá tiền mới (VNĐ)')
                .setMinValue(1)
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('spawnerstock')
        .setDescription('Thay đổi số lượng tồn kho Spawner (Dành cho Admin)')
        .addStringOption(option =>
            option
                .setName('type')
                .setDescription('Loại spawner')
                .setRequired(true)
                .addChoices(
                    { name: 'Skeleton Spawner', value: 'ske' },
                    { name: 'Blaze Spawner', value: 'blaze' },
                    { name: 'Creeper Spawner', value: 'creeper' },
                    { name: 'Iron Golem Spawner', value: 'golem' }
                )
        )
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('Số lượng tồn kho mới')
                .setMinValue(0)
                .setRequired(true)
        ),

    // MONEY
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription(
            'Thiết lập Bảng AutoBuy Money cố định vào kênh này'
        ),

    new SlashCommandBuilder()
        .setName('setstock')
        .setDescription(
            'Cập nhật số lượng kho Money'
        )
        .addStringOption(opt =>
            opt
                .setName('amount')
                .setDescription(
                    'Ví dụ: 10b, 500m, 5000m'
                )
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('rate')
        .setDescription('Đổi tỷ giá Money (VNĐ / 1M$)')
        .addIntegerOption(opt =>
            opt
                .setName('value')
                .setDescription('Rate mới, ví dụ: 130')
                .setMinValue(1)
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('time')
        .setDescription('Cài đặt giờ hoạt động của Bot (Giờ GMT+7)')
        .addIntegerOption(opt =>
            opt
                .setName('start')
                .setDescription('Giờ bắt đầu (0-23), ví dụ: 10')
                .setMinValue(0)
                .setMaxValue(23)
                .setRequired(true)
        )
        .addIntegerOption(opt =>
            opt
                .setName('end')
                .setDescription('Giờ kết thúc (0-23), ví dụ: 22')
                .setMinValue(0)
                .setMaxValue(23)
                .setRequired(true)
        ),

    // ACCOUNT
    new SlashCommandBuilder()
        .setName('setstockacc')
        .setDescription(
            'Nạp danh sách tài khoản vào kho'
        )
        .addStringOption(o =>
            o
                .setName('danh_sach')
                .setDescription(
                    'Tên Acc | Email | Recovery Code. Mỗi acc một dòng.'
                )
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('acc')
        .setDescription(
            'Xem danh sách và lấy tài khoản ra khỏi kho'
        ),

    new SlashCommandBuilder()
        .setName('deleteacc')
        .setDescription(
            'Xóa tài khoản khỏi kho accounts.json'
        ),

    new SlashCommandBuilder()
        .setName('thongtin')
        .setDescription(
            'Đăng tin bán Acc Minecraft'
        )
        .addStringOption(o =>
            o
                .setName('username')
                .setDescription('Tên Username Minecraft')
                .setRequired(true)
        )
        .addIntegerOption(o =>
            o
                .setName('price_bank')
                .setDescription('Giá Bank VNĐ')
                .setRequired(true)
        )
        .addIntegerOption(o =>
            o
                .setName('price_card')
                .setDescription('Giá Thẻ Cào VNĐ')
                .setRequired(true)
        )
        .addIntegerOption(o =>
            o
                .setName('cape_count')
                .setDescription('Số lượng Cape')
                .setRequired(true)
        )
        .addStringOption(o =>
            o
                .setName('cape_list')
                .setDescription('Danh sách Cape')
                .setRequired(true)
        )
        .addStringOption(o =>
            o
                .setName('rank')
                .setDescription('Rank Ingame')
                .setRequired(true)
        )
        .addStringOption(o =>
            o
                .setName('image_url')
                .setDescription('Link ảnh banner')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('price')
        .setDescription(
            'Cập nhật giá Acc'
        )
        .addStringOption(o =>
            o
                .setName('username')
                .setDescription('Tên Username Minecraft')
                .setRequired(true)
        )
        .addIntegerOption(o =>
            o
                .setName('price_bank')
                .setDescription('Giá Bank mới')
                .setRequired(true)
        )
        .addIntegerOption(o =>
            o
                .setName('price_card')
                .setDescription('Giá Card mới')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('cape')
        .setDescription(
            'Cập nhật Cape cho Acc'
        )
        .addStringOption(o =>
            o
                .setName('username')
                .setDescription('Tên Username Minecraft')
                .setRequired(true)
        )
        .addIntegerOption(o =>
            o
                .setName('cape_count')
                .setDescription('Số lượng Cape mới')
                .setRequired(true)
        )
        .addStringOption(o =>
            o
                .setName('cape_list')
                .setDescription('Danh sách Cape mới')
                .setRequired(true)
        )
];

// ============================================================
// 19. REGISTER COMMANDS
// ============================================================

async function registerSlashCommands() {
    const token =
        process.env.DISCORD_TOKEN ||
        process.env.TOKEN;

    const clientId =
        process.env.CLIENT_ID ||
        process.env.APPLICATION_ID;

    if (!token || !clientId) {
        console.error(
            '❌ Thiếu DISCORD_TOKEN hoặc CLIENT_ID trong .env'
        );
        return;
    }

    const rest =
        new REST({ version: '10' })
            .setToken(token);

    try {
        if (process.env.GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(
                    clientId,
                    process.env.GUILD_ID
                ),
                { body: commands.map(c => c.toJSON()) }
            );
        } else {
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: commands.map(c => c.toJSON()) }
            );
        }

        console.log(`✅ Đã đăng ký ${commands.length} Slash Commands thành công!`);
    } catch (error) {
        console.error(
            '❌ Lỗi đăng ký command:',
            error
        );
    }
}

// ============================================================
// 20. MESSAGE CREATE
// ============================================================

client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;

    try {
        const contentLower =
            message.content.toLowerCase();

        if (
            contentLower.includes('sell') ||
            contentLower.includes('stock')
        ) {
            const stockText =
                formatStock(currentStockM);

            const autoBuyChannelText =
                moneyConfig.channelId
                    ? ` tại <#${moneyConfig.channelId}>`
                    : '';

            const replyEmbed =
                new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle(
                        '📦 THÔNG TIN KHO MONEY KINGSMP'
                    )
                    .setDescription(
                        `📦 **Stock:** \`${stockText}\`\n` +
                        `💸 **Tỷ giá:** \`${RATE} VNĐ = 1M$\`\n` +
                        `🎟️ **Thẻ cào:** -20%\n\n` +
                        `👉 Mua trực tiếp${autoBuyChannelText}!`
                    )
                    .setTimestamp();

            await message.channel.send({
                embeds: [replyEmbed]
            });
        }

        // Spawner ticket: khách gửi bill -> nhắc Admin
        if (
            message.channel.type === ChannelType.GuildText &&
            message.channel.name?.startsWith('don-') &&
            message.attachments.size > 0
        ) {
            const hasValidAdminRole =
                serverConfig.adminRoleId &&
                serverConfig.adminRoleId !==
                    "ID_ROLE_ADMIN_CUA_BAN";

            const adminMention =
                hasValidAdminRole
                    ? `<@&${serverConfig.adminRoleId}>`
                    : '@Admin';

            await message.channel.send({
                content:
                    `🔔 ${adminMention} ơi! Khách hàng <@${message.author.id}> ` +
                    `vừa gửi ảnh bill thanh toán Spawner. Nhờ Admin kiểm tra và giao hàng nhé! 📦`,
                allowedMentions: {
                    roles: hasValidAdminRole
                        ? [serverConfig.adminRoleId]
                        : []
                }
            });
        }

        if (
            message.channel.type === ChannelType.GuildText &&
            message.channel.name?.startsWith('ticket-') &&
            message.channel.topic?.startsWith('accOrder:')
        ) {
            const hasImage =
                message.attachments.some(
                    att =>
                        att.contentType &&
                        att.contentType.startsWith('image/')
                );

            if (!hasImage) return;

            const row =
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('approve_bill')
                        .setLabel('Duyệt - Chọn Acc')
                        .setEmoji('✅')
                        .setStyle(ButtonStyle.Success),

                    new ButtonBuilder()
                        .setCustomId('reject_bill')
                        .setLabel('Từ Chối')
                        .setEmoji('❌')
                        .setStyle(ButtonStyle.Danger)
                );

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        '🧾 PHÁT HIỆN BILL CHUYỂN KHOẢN'
                    )
                    .setColor('#f1c40f')
                    .setDescription(
                        `Khách hàng <@${message.author.id}> ` +
                        `đã gửi bill.\n` +
                        `Admin kiểm tra và duyệt bên dưới.`
                    )
                    .setFooter({
                        text:
                            'Chỉ Admin mới có quyền duyệt!'
                    });

            await message.channel.send({
                embeds: [embed],
                components: [row]
            });
        }
    } catch (err) {
        console.error(
            'Lỗi MessageCreate:',
            err.message
        );
    }
});

// ============================================================
// 21. INTERACTION CREATE
// ============================================================

client.on(Events.InteractionCreate, async interaction => {
    try {
        if (!claimInteraction(interaction)) {
            console.log(
                `⚠️ Bỏ qua interaction trùng: ${interaction.id}`
            );
            return;
        }

        if (interaction.isChatInputCommand()) {
            if (
                SPAWNER_COMMAND_NAMES.includes(
                    interaction.commandName
                )
            ) {
                return await handleSpawnerCommand(interaction);
            }

            if (
                MONEY_COMMAND_NAMES.includes(
                    interaction.commandName
                )
            ) {
                return await handleMoneyCommand(interaction);
            }

            if (
                ACC_COMMAND_NAMES.includes(
                    interaction.commandName
                )
            ) {
                return await handleAccCommand(interaction);
            }

            return;
        }

        if (interaction.isButton()) {
            const id = interaction.customId;

            if (id === 'close_ticket') {
                return await handleCloseTicket(interaction);
            }

            if (
                id.startsWith('spawner_buy_') ||
                id.startsWith('spawner_method_bank_') ||
                id.startsWith('spawner_method_card_') ||
                id.startsWith('spawner_confirm_')
            ) {
                return await handleSpawnerButton(interaction);
            }

            if (
                id.startsWith('money_approve_') ||
                id.startsWith('money_reject_') ||
                [
                    'buy_bank',
                    'buy_card',
                    'calc_price',
                    'guide'
                ].includes(id)
            ) {
                return await handleMoneyButton(interaction);
            }

            if (
                id.startsWith('buy_single_') ||
                id.startsWith('confirm_delete_') ||
                id === 'cancel_delete' ||
                id === 'approve_bill' ||
                id === 'reject_bill'
            ) {
                return await handleAccButton(interaction);
            }

            return;
        }

        if (interaction.isStringSelectMenu()) {
            const id = interaction.customId;

            if (
                id === 'select_stock_acc_manual' ||
                id === 'select_delete_acc_menu' ||
                id.startsWith('select_deliver_acc_')
            ) {
                return await handleAccSelectMenu(interaction);
            }

            return;
        }

        if (interaction.isModalSubmit()) {
            if (
                interaction.customId.startsWith('spawner_modal_bank_') ||
                interaction.customId.startsWith('spawner_modal_card_') ||
                interaction.customId.startsWith('spawner_modal_deduct_')
            ) {
                return await handleSpawnerModal(interaction);
            }

            if (
                [
                    'modal_bank',
                    'modal_card',
                    'modal_calc'
                ].includes(interaction.customId)
            ) {
                return await handleMoneyModal(interaction);
            }

            return;
        }
    } catch (err) {
        console.error(
            '❌ Lỗi Xử Lý Interaction:',
            err
        );

        try {
            if (
                !interaction.replied &&
                !interaction.deferred
            ) {
                await interaction.reply({
                    content:
                        '❌ Có lỗi xảy ra khi xử lý thao tác.',
                    flags: MessageFlags.Ephemeral
                });
            }
        } catch (replyErr) {
            if (replyErr?.code !== 40060) {
                console.error(
                    '❌ Không thể gửi lỗi:',
                    replyErr.message
                );
            }
        }
    }
});

// ============================================================
// 22. READY
// ============================================================

client.once(Events.ClientReady, async c => {
    console.log(
        `🤖 Bot đã online thành công: ${c.user.tag}`
    );

    ensureJsonFile(STOCK_FILE, { stockM: 5000 });
    ensureJsonFile(CONFIG_FILE, {});
    ensureJsonFile(ACC_STOCK_FILE, []);
    ensureJsonFile(ACC_DETAIL_FILE, []);
    ensureJsonFile(MONEY_ORDERS_FILE, {});

    console.log(`📦 [STARTUP] Money stock: ${currentStockM}M$`);
    console.log(`🧩 [STARTUP] Panel config: channel=${moneyConfig?.channelId || 'none'} message=${moneyConfig?.messageId || 'none'}`);
    await registerSlashCommands();
    await updateAutoBuyPanel();
});

// ============================================================
// 23. ERROR HANDLING
// ============================================================

process.on('unhandledRejection', err => {
    console.error(
        '⚠️ [Unhandled Rejection]:',
        err
    );
});

process.on('uncaughtException', err => {
    console.error(
        '⚠️ [Uncaught Exception]:',
        err
    );
});

// ============================================================
// 24. LOGIN
// ============================================================

const botToken =
    process.env.DISCORD_TOKEN ||
    process.env.TOKEN;

console.log('🔒 Interaction handler: SINGLE LISTENER MODE');
console.log(`🌐 Runtime: ${process.env.RENDER ? 'Render' : 'Local/Other'}`);

if (!botToken) {
    console.error(
        '❌ Không tìm thấy DISCORD_TOKEN/TOKEN trong .env!'
    );
} else {
    client.login(botToken).catch(err => {
        console.error(
            '❌ Login Discord thất bại:',
            err.message
        );
    });
}
