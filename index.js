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

// Ticket staff IDs (fallbacks so the bot works even when .env is missing them).
process.env.SELLER_ROLE_ID = (process.env.SELLER_ROLE_ID || '1531205202265247794').trim();
process.env.BUILDER_ROLE_ID = (process.env.BUILDER_ROLE_ID || '1531202502681301094').trim();
// ID vai trò dùng để ping Admin trong hệ thống Ticket.
process.env.ADMIN_ROLE_ID = (process.env.ADMIN_ROLE_ID || '1516082552530800875').trim();
// ID Admin dùng riêng để kiểm tra trạng thái online khi khách mua Money.
const MONEY_ADMIN_CHECK_ID = '1458470035763888250';

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

const STOCK_FILE = path.join(__dirname, 'stock.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Cấu hình quyền Admin cho Money + Account (không còn Spawner)
const serverConfig = {
    adminRoleId: process.env.ADMIN_ROLE_ID || "ID_ROLE_ADMIN_CUA_BAN"
};

const ACC_STOCK_FILE = path.join(__dirname, 'accounts.json');
const ACC_DETAIL_FILE = path.join(__dirname, 'accounts_detail.json');

const MONEY_ORDERS_FILE = path.join(__dirname, 'money_orders.json');
const THU_MONEY_CONFIG_KEY = 'thuMoneyPanel';
const THU_MONEY_TICKET_PREFIX = 'ticket-thumoney-';
const TICKET_CONFIG_KEY = 'ticketPanel';

const ITEM_SELLERS = [
    { id: '1513494095559921775', label: 'T1', emoji: '1️⃣' },
    { id: '1542430933724962817', label: 'T2', emoji: '2️⃣' },
    { id: '1198608624080142517', label: 'T3', emoji: '3️⃣' },
    { id: '908316104391266325', label: 'T4', emoji: '4️⃣' }
];

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

    const hasTicketAdminRole =
        process.env.ADMIN_ROLE_ID &&
        interaction.member?.roles?.cache?.has(process.env.ADMIN_ROLE_ID);

    return Boolean(isAdminId || hasAdminPerm || hasAdminRole || hasTicketAdminRole);
}

function adminOverwrite(guildId) {
    const adminRoleId = (process.env.ADMIN_ROLE_ID || '').trim();
    if (adminRoleId) {
        return [{
            id: adminRoleId,
        allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.AttachFiles,
            PermissionsBitField.Flags.ManageChannels
        ]
        }];
    }

    // Fallback cũ nếu server vẫn cấu hình ADMIN_DISCORD_ID là user ID.
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


async function checkMoneyAdminOnline(guild) {
    try {
        if (!guild) return false;

        const member = await guild.members.fetch(MONEY_ADMIN_CHECK_ID);
        const status = member?.presence?.status;

        return Boolean(status && status !== 'offline');
    } catch (err) {
        console.error('❌ Không thể kiểm tra trạng thái Admin Money:', err?.message || err);
        return false;
    }
}

function getTicketRoleId(type) {
    const envMap = {
        seller: 'SELLER_ROLE_ID',
        builder: 'BUILDER_ROLE_ID'
    };

    const envKey = envMap[type];
    return envKey ? (process.env[envKey] || '').trim() : '';
}

function getTicketAdminRoleId() {
    return (process.env.ADMIN_ROLE_ID || '').trim();
}

function getTicketAdminMention() {
    const roleId = getTicketAdminRoleId();
    return roleId ? `<@&${roleId}>` : 'Admin';
}

function ticketRoleOverwrite(roleId) {
    if (!roleId) return [];

    return [{
        id: roleId,
        allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.AttachFiles
        ]
    }];
}

function loadTicketPanelConfig() {
    const config = readJson(CONFIG_FILE, {});
    return config?.[TICKET_CONFIG_KEY] || {};
}

function saveTicketPanelConfig(data) {
    const config = readJson(CONFIG_FILE, {});
    config[TICKET_CONFIG_KEY] = data || {};
    saveMoneyConfig(config);
}

function buildTicketPanel() {
    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🎫 HỖ TRỢ & DỊCH VỤ')
        .setDescription(
            'Bấm nút **Mở Menu Ticket** bên dưới để chọn đúng nhu cầu của bạn.\n\n' +
            '🛒 **Mua vật phẩm KingSMP / DonutSMP** → Chọn Seller (bot kiểm tra Online/Offline)\n' +
            '🏗️ **Builder xây Farm / Stash** → Ping Builder\n' +
            '🛠️ **Hỗ trợ Partner / Khác** → Ping Admin\n' +
            '💎 **Thu mua Account Minecraft Premium** → Ping Admin'
        )
        .setFooter({ text: 'Vui lòng chọn đúng mục để được hỗ trợ nhanh nhất.' })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ticket_open_menu')
            .setLabel('Mở Menu Ticket')
            .setEmoji('🎫')
            .setStyle(ButtonStyle.Primary)
    );

    return { embeds: [embed], components: [row] };
}

function buildTicketTypeMenu() {
    const menu = new StringSelectMenuBuilder()
        .setCustomId('ticket_type_select')
        .setPlaceholder('🎫 Chọn loại Ticket cần tạo...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Mua vật phẩm KingSMP / DonutSMP')
                .setDescription('Tạo ticket và ping Seller')
                .setEmoji('🛒')
                .setValue('buy_items'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Builder xây Farm / Stash')
                .setDescription('Tạo ticket và ping Builder')
                .setEmoji('🏗️')
                .setValue('builder'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Hỗ trợ Partner / Khác')
                .setDescription('Tạo ticket và ping Admin')
                .setEmoji('🛠️')
                .setValue('support'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Thu mua Account Minecraft Premium')
                .setDescription('Tạo ticket và ping Admin')
                .setEmoji('💎')
                .setValue('buy_premium')
        );

    return new ActionRowBuilder().addComponents(menu);
}

function ticketTypeInfo(type) {
    const map = {
        buy_items: {
            prefix: 'buy',
            title: '🛒 MUA VẬT PHẨM KINGSMP / DONUTSMP',
            description: 'Seller sẽ tiếp nhận và hỗ trợ đơn mua vật phẩm của bạn.',
            roleId: getTicketRoleId('seller'),
            ping: getTicketRoleId('seller') ? `<@&${getTicketRoleId('seller')}>` : 'Seller'
        },
        builder: {
            prefix: 'builder',
            title: '🏗️ BUILDER FARM / STASH',
            description: 'Builder sẽ vào ticket để trao đổi yêu cầu xây dựng, giá và thời gian.',
            roleId: getTicketRoleId('builder'),
            ping: getTicketRoleId('builder') ? `<@&${getTicketRoleId('builder')}>` : 'Builder'
        },
        support: {
            prefix: 'support',
            title: '🛠️ HỖ TRỢ PARTNER / KHÁC',
            description: 'Admin sẽ tiếp nhận yêu cầu hỗ trợ của bạn.',
            roleId: getTicketAdminRoleId(),
            ping: getTicketAdminMention()
        },
        buy_premium: {
            prefix: 'premium',
            title: '💎 THU MUA ACCOUNT MINECRAFT PREMIUM',
            description: 'Admin sẽ kiểm tra và báo giá account Premium của bạn.',
            roleId: getTicketAdminRoleId(),
            ping: getTicketAdminMention()
        }
    };

    return map[type] || null;
}

async function createGeneralTicket(interaction, type, sellerId = null) {
    const info = ticketTypeInfo(type);

    if (!info || !interaction.guild) {
        return safeReply(interaction, {
            content: '❌ Không xác định được loại Ticket.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Ack interaction ngay lập tức để Discord không hiện "thinking..." quá lâu.
    if (!(await safeDeferUpdate(interaction))) return;

    const baseName = `${info.prefix}-${interaction.user.username}`
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '')
        .slice(0, 65) || `${info.prefix}-ticket`;

    try {
        // Gán topic ngay lúc create => bỏ 1 request API setTopic riêng, tạo ticket nhanh hơn.
        const ticketTopic = `generalTicket:${type}:${interaction.user.id}${sellerId ? `:${sellerId}` : ''}`;

        const ticketChannel = await interaction.guild.channels.create({
            name: `ticket-${baseName}`,
            type: ChannelType.GuildText,
            topic: ticketTopic,
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
                ...(sellerId ? [{
                    id: sellerId,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.AttachFiles
                    ]
                }] : []),
                ...(sellerId ? await getSellerRoleOverwrite(interaction.guild, sellerId) : []),
                ...ticketRoleOverwrite(info.roleId),
                ...adminOverwrite(interaction.guild.id)
            ]
        });

        const seller = sellerId ? getSellerInfo(sellerId) : null;
        const responsiblePing = seller ? `<@${seller.id}>` : info.ping;
        const sellerDisplayName = seller ? await getSellerDisplayName(interaction.guild, seller.id) : null;
        const sellerOnline = seller ? await isSellerOnline(interaction.guild, seller.id) : false;

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(info.title)
            .setDescription(
                `Xin chào <@${interaction.user.id}>!\n\n` +
                `${info.description}\n\n` +
                `📌 **Người phụ trách:** ${responsiblePing}\n` +
                (seller ? `🏷️ **Seller:** ${sellerDisplayName}\n📡 **Trạng thái Seller:** ${sellerOnline ? 'ONLINE' : 'OFFLINE'}\n` : '') +
                '🔒 Khi hoàn tất, Admin có thể đóng ticket.'
            )
            .setFooter({ text: `Ticket của ${interaction.user.tag}` })
            .setTimestamp();

        const closeRow = new ActionRowBuilder().addComponents(
            ...(sellerId ? [
                new ButtonBuilder()
                    .setCustomId('ticket_change_seller')
                    .setLabel('Chuyển Seller')
                    .setEmoji('🔄')
                    .setStyle(ButtonStyle.Primary)
            ] : []),
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Đóng Ticket')
                .setEmoji('🔒')
                .setStyle(ButtonStyle.Danger)
        );

        // Gửi ticket message và log gần như đồng thời để giảm thời gian chờ.
        const mentionUsers = sellerId ? [interaction.user.id, sellerId] : [interaction.user.id];
        const ticketMessagePromise = ticketChannel.send({
            content: sellerId ? `<@${interaction.user.id}> <@${sellerId}>` : `<@${interaction.user.id}> ${info.ping}`,
            embeds: [embed],
            components: [closeRow],
            allowedMentions: {
                users: mentionUsers,
                roles: info.roleId ? [info.roleId] : []
            }
        });

        const logPromise = (async () => {
            if (!process.env.LOG_CHANNEL_ID) return false;

            try {
                const logChannel = await client.channels.fetch(
                    String(process.env.LOG_CHANNEL_ID)
                );

                if (!logChannel?.isTextBased()) return false;

                const typeLabelMap = {
                    buy_items: '🛒 Mua vật phẩm KINGSMP / DONUTSMP',
                    builder: '🏗️ Builder Farm / Stash',
                    support: '🛠️ Hỗ trợ Partner / Khác',
                    buy_premium: '💎 Thu mua Account Minecraft Premium'
                };

                await logChannel.send({
                    content:
                        `🚨 **TICKET MỚI**\n` +
                        `👤 Khách: <@${interaction.user.id}>\n` +
                        `📂 Loại: **${typeLabelMap[type] || type}**\n` +
                        `📌 Kênh: ${ticketChannel}`,
                    allowedMentions: {
                        users: [interaction.user.id]
                    }
                });

                return true;
            } catch (err) {
                console.error(
                    '❌ Không gửi được log general ticket:',
                    err?.message || err
                );
                return false;
            }
        })();

        await ticketMessagePromise;

        // Không để lỗi log làm chậm phản hồi ticket cho khách.
        logPromise.catch(() => {});

        return safeEditReply(interaction, {
            content:
                `✅ **Đã tạo Ticket!**\n` +
                `👉 ${ticketChannel}\n` +
                (process.env.LOG_CHANNEL_ID
                    ? '🔔 Seller/Admin đã được thông báo.'
                    : '')
        });
    } catch (err) {
        return safeEditReply(interaction, {
            content: `❌ Không thể tạo Ticket: \`${err.message}\``
        });
    }
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

function loadThuMoneyConfig() {
    const config = readJson(CONFIG_FILE, {});
    return config?.[THU_MONEY_CONFIG_KEY] || {};
}

function saveThuMoneyConfig(data) {
    const config = readJson(CONFIG_FILE, {});
    config[THU_MONEY_CONFIG_KEY] = data || {};
    saveMoneyConfig(config);
}

function getVietnamDateKey() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function getThuMoneyRate() {
    const config = loadThuMoneyConfig();
    const dailyRate = Number(config.dailyRates?.[getVietnamDateKey()]);
    if (Number.isFinite(dailyRate) && dailyRate > 0) return dailyRate;
    const fallback = Number(config.rate);
    return Number.isFinite(fallback) && fallback > 0 ? fallback : 100;
}

function isWithinThuMoneyWorkingHours() {
    const config = loadThuMoneyConfig();
    const start = Number.isInteger(config.workingHours?.start) ? config.workingHours.start : 10;
    const end = Number.isInteger(config.workingHours?.end) ? config.workingHours.end : 22;
    const hour = Number(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', hour12: false
    }).format(new Date()));
    return start <= end ? (hour >= start && hour < end) : (hour >= start || hour < end);
}

function getSellerInfo(sellerId) {
    return ITEM_SELLERS.find(s => s.id === sellerId) || null;
}

async function getSellerMember(guild, sellerId) {
    try {
        if (!guild || !sellerId) return null;
        return await guild.members.fetch(sellerId);
    } catch (err) {
        return guild?.members?.cache?.get(sellerId) || null;
    }
}

async function getSellerDisplayName(guild, sellerId) {
    // Ưu tiên tên hiển thị trên server. Nếu member chưa fetch được,
    // fallback sang User API để vẫn lấy đúng tên Discord thay vì hiện ID.
    const member = await getSellerMember(guild, sellerId);
    if (member?.displayName) return member.displayName;
    if (member?.user?.globalName) return member.user.globalName;
    if (member?.user?.username) return member.user.username;

    try {
        const user = await client.users.fetch(sellerId);
        return user?.globalName || user?.username || `Seller ${sellerId.slice(-4)}`;
    } catch (err) {
        return `Seller ${sellerId.slice(-4)}`;
    }
}

async function getSellerRoleId(guild, sellerId) {
    const member = await getSellerMember(guild, sellerId);
    const role = member?.roles?.highest;
    if (!role || role.id === guild?.id || role.managed) return null;
    return role.id;
}

async function getSellerRoleOverwrite(guild, sellerId) {
    const roleId = await getSellerRoleId(guild, sellerId);
    if (!roleId) return [];
    return [{
        id: roleId,
        allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.AttachFiles
        ]
    }];
}

async function isSellerOnline(guild, sellerId) {
    const member = await getSellerMember(guild, sellerId);
    return Boolean(member?.presence?.status && member.presence.status !== 'offline');
}

async function buildSellerSelectMenu(guild) {
    const menu = new StringSelectMenuBuilder()
        .setCustomId('ticket_seller_select')
        .setPlaceholder('🛒 Chọn Seller bạn yêu thích...');

    for (const seller of ITEM_SELLERS) {
        const [name, online] = await Promise.all([
            getSellerDisplayName(guild, seller.id),
            isSellerOnline(guild, seller.id)
        ]);

        menu.addOptions(
            new StringSelectMenuOptionBuilder()
                // Dòng trên: tên Seller
                .setLabel(`${name}`.slice(0, 100))
                // Dòng dưới: chỉ trạng thái, không hiện ID cho đỡ rối
                .setDescription(online ? '🟢 ONLINE' : '🔴 OFFLINE')
                .setEmoji(seller.emoji)
                .setValue(seller.id)
        );
    }

    return new ActionRowBuilder().addComponents(menu);
}

async function switchTicketSeller(interaction, sellerId) {
    if (!interaction.channel || !interaction.guild) {
        return safeReply(interaction, { content: '❌ Không tìm thấy ticket.', flags: MessageFlags.Ephemeral });
    }

    const topic = String(interaction.channel.topic || '');
    const match = topic.match(/^generalTicket:buy_items:(\d+)(?::(\d+))?$/);
    if (!match) {
        return safeReply(interaction, { content: '❌ Ticket này không hỗ trợ chuyển Seller.', flags: MessageFlags.Ephemeral });
    }

    const customerId = match[1];
    const oldSellerId = match[2] || null;
    if (interaction.user.id !== customerId && !isAdminUser(interaction)) {
        return safeReply(interaction, { content: '❌ Chỉ khách trong ticket hoặc Admin mới được đổi Seller.', flags: MessageFlags.Ephemeral });
    }

    const newSeller = getSellerInfo(sellerId);
    if (!newSeller) {
        return safeReply(interaction, { content: '❌ Seller không hợp lệ.', flags: MessageFlags.Ephemeral });
    }

    if (oldSellerId === sellerId) {
        return safeReply(interaction, { content: 'ℹ️ Ticket đang phụ trách bởi Seller này rồi.', flags: MessageFlags.Ephemeral });
    }

    if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;

    try {
        // Gỡ quyền Seller cũ và role cũ.
        if (oldSellerId) {
            await interaction.channel.permissionOverwrites.delete(oldSellerId).catch(() => {});
            const oldRoleId = await getSellerRoleId(interaction.guild, oldSellerId);
            if (oldRoleId) {
                await interaction.channel.permissionOverwrites.delete(oldRoleId).catch(() => {});
            }
        }

        // Cấp quyền Seller mới + role của Seller mới.
        await interaction.channel.permissionOverwrites.edit(newSeller.id, {
            ViewChannel: true,
            SendMessages: true,
            AttachFiles: true
        });

        const newRoleId = await getSellerRoleId(interaction.guild, newSeller.id);
        if (newRoleId) {
            await interaction.channel.permissionOverwrites.edit(newRoleId, {
                ViewChannel: true,
                SendMessages: true,
                AttachFiles: true
            });
        }

        await interaction.channel.setTopic(`generalTicket:buy_items:${customerId}:${newSeller.id}`);

        const displayName = await getSellerDisplayName(interaction.guild, newSeller.id);
        const online = await isSellerOnline(interaction.guild, newSeller.id);
        const message = await interaction.channel.send({
            content: `<@${customerId}> <@${newSeller.id}>`,
            embeds: [new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('🔄 ĐÃ CHUYỂN SELLER')
                .setDescription(
                    `👤 Seller mới: **${displayName}**\n` +
                    `📡 Trạng thái: **${online ? 'ONLINE' : 'OFFLINE'}**\n\n` +
                    `Khách có thể tiếp tục giao dịch với Seller này.`
                )
                .setTimestamp()],
            allowedMentions: { users: [customerId, newSeller.id] }
        });

        return safeEditReply(interaction, {
            content: `✅ Đã chuyển ticket sang **${displayName}**${online ? ' • 🟢 ONLINE' : ' • 🔴 OFFLINE'}.`
        });
    } catch (err) {
        return safeEditReply(interaction, { content: `❌ Không thể chuyển Seller: \`${err.message}\`` });
    }
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


function buildThuMoneyPanel() {
    const config = loadThuMoneyConfig();
    const rate = getThuMoneyRate();
    const start = config.workingHours?.start ?? 10;
    const end = config.workingHours?.end ?? 22;
    const open = isWithinThuMoneyWorkingHours();

    const embed = new EmbedBuilder()
        .setColor(open ? '#2ecc71' : '#e74c3c')
        .setTitle('💰 THU MONEY KINGSMP')
        .setDescription(
            `📅 **Giá hôm nay (${getVietnamDateKey()})**\n` +
            `💵 **${rate.toLocaleString('vi-VN')} VNĐ = 1M$**\n\n` +
            `📊 **Trạng thái:** ${open ? '🟢 ĐANG NHẬN' : '🔴 ĐANG OFF'}\n` +
            `⏰ **Giờ làm việc:** \`${start}h00 - ${end}h00\`\n\n` +
            `Bấm nút bên dưới để tạo ticket thu Money.\n` +
            `🔒 Ticket chỉ hiển thị với **khách + Admin**.`
        )
        .setFooter({ text: 'Giá theo ngày • /rate type:thu để đổi giá hôm nay' })
        .setTimestamp();

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('thu_money_create')
                    .setLabel('Thu Money')
                    .setEmoji('💰')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(!open)
            )
        ]
    };
}

async function updateThuMoneyPanel() {
    const config = loadThuMoneyConfig();
    if (!config.channelId) return;
    try {
        const channel = await client.channels.fetch(String(config.channelId));
        if (!channel?.isTextBased()) return;
        if (config.messageId) {
            try {
                const message = await channel.messages.fetch(String(config.messageId));
                await message.edit(buildThuMoneyPanel());
                return;
            } catch (_) {}
        }
        const newMessage = await channel.send(buildThuMoneyPanel());
        saveThuMoneyConfig({ ...config, channelId: channel.id, messageId: newMessage.id });
    } catch (err) {
        console.error('❌ Lỗi cập nhật bảng Thu Money:', err?.message || err);
    }
}

async function handleThuMoneyCommand(interaction) {
    if (!isAdminUser(interaction)) {
        return safeReply(interaction, { content: '❌ Bạn không có quyền dùng lệnh này!', flags: MessageFlags.Ephemeral });
    }
    if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;
    try {
        const config = loadThuMoneyConfig();
        if (interaction.commandName === 'thumoney') {
            saveThuMoneyConfig({ ...config, channelId: interaction.channelId });
            await updateThuMoneyPanel();
            return safeEditReply(interaction, { content: '✅ Đã tạo/cập nhật **Bảng Thu Money KingSMP cố định** trong kênh này.' });
        }
        if (interaction.commandName === 'thu-time') {
            const start = interaction.options.getInteger('start');
            const end = interaction.options.getInteger('end');
            saveThuMoneyConfig({ ...config, workingHours: { start, end } });
            await updateThuMoneyPanel();
            return safeEditReply(interaction, { content: `✅ Giờ làm việc Thu Money: **${start}h00 - ${end}h00**` });
        }
    } catch (err) {
        return safeEditReply(interaction, { content: `❌ Lỗi Thu Money: \`${err.message}\`` });
    }
}

async function createThuMoneyTicket(interaction) {
    if (!interaction.guild) return;
    const config = loadThuMoneyConfig();
    const rate = getThuMoneyRate();
    const start = config.workingHours?.start ?? 10;
    const end = config.workingHours?.end ?? 22;
    if (!isWithinThuMoneyWorkingHours()) {
        return safeReply(interaction, {
            content: `🌙 **Thu Money hiện đang OFF**\n⏰ Giờ làm việc: **${start}h00 - ${end}h00**`,
            flags: MessageFlags.Ephemeral
        });
    }
    if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;
    const safeUser = interaction.user.username.toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 55) || 'user';
    try {
        const channel = await interaction.guild.channels.create({
            name: `${THU_MONEY_TICKET_PREFIX}${safeUser}`,
            type: ChannelType.GuildText,
            topic: `thuMoney:${interaction.user.id}:${getVietnamDateKey()}`,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] },
                ...adminOverwrite(interaction.guild.id)
            ]
        });
        const embed = new EmbedBuilder()
            .setColor('#2ecc71')
            .setTitle('💰 TICKET THU MONEY KINGSMP')
            .setDescription(
                `<@${interaction.user.id}> hãy gửi thông tin Money cần bán cho Admin.\n\n` +
                `💵 **Giá hôm nay:** ${rate.toLocaleString('vi-VN')} VNĐ = 1M$\n` +
                `📅 **Ngày:** ${getVietnamDateKey()}\n` +
                `🔒 Kênh này chỉ có **khách + Admin** nhìn thấy.`
            )
            .setTimestamp();
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger)
        );
        const adminRoleId = getTicketAdminRoleId();
        await channel.send({
            content: `<@${interaction.user.id}> ${getTicketAdminMention()}`,
            embeds: [embed], components: [row],
            allowedMentions: { users: [interaction.user.id], roles: adminRoleId ? [adminRoleId] : [] }
        });
        const admin = await interaction.guild.members.fetch('1458470035763888250').catch(() => null);
        const adminOnline = Boolean(admin?.presence?.status && admin.presence.status !== 'offline');
        await channel.send({ content: adminOnline ? '✅ **Admin đang online** — giao dịch sẽ được hỗ trợ sớm.' : '🌙 **Admin hiện đang offline** — hãy để lại thông tin, Admin sẽ xử lý khi online.' });
        return safeEditReply(interaction, { content: `✅ **Đã tạo Ticket Thu Money!**\n👉 ${channel}` });
    } catch (err) {
        return safeEditReply(interaction, { content: `❌ Không thể tạo Ticket Thu Money: \`${err.message}\`` });
    }
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
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;
        try {
            const newRate = interaction.options.getInteger('value');
            const type = interaction.options.getString('type') || 'buy';
            if (!Number.isInteger(newRate) || newRate <= 0) {
                return safeEditReply(interaction, { content: '❌ Rate không hợp lệ.' });
            }
            if (type === 'thu') {
                const thuConfig = loadThuMoneyConfig();
                const dailyRates = { ...(thuConfig.dailyRates || {}), [getVietnamDateKey()]: newRate };
                saveThuMoneyConfig({ ...thuConfig, rate: newRate, dailyRates });
                await updateThuMoneyPanel();
                return safeEditReply(interaction, {
                    content: `✅ Đã đổi **giá Thu Money hôm nay** thành **${newRate.toLocaleString('vi-VN')}đ / 1M$**\n📅 Ngày: **${getVietnamDateKey()}**`
                });
            }
            RATE = newRate;
            moneyConfig.rate = RATE;
            saveMoneyConfig(moneyConfig);
            await updateAutoBuyPanel();
            return safeEditReply(interaction, { content: `✅ Đã đổi Rate Buy Money thành **${RATE}đ / 1M$**` });
        } catch (err) {
            return safeEditReply(interaction, { content: `❌ Không thể đổi Rate: \`${err.message}\`` });
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

            const adminOnlineAfterCreate = await checkMoneyAdminOnline(interaction.guild);
            await ticketChannel.send({
                content: adminOnlineAfterCreate
                    ? '✅ **Admin đang online** — giao dịch của bạn đã được mở và sẽ được hỗ trợ sớm nhất.'
                    : '🌙 **Ticket đã được tạo thành công.** Hiện Admin phụ trách Money đang offline. Bạn cứ để lại thông tin/bill trong ticket, Admin sẽ tiếp nhận ngay khi trực tuyến. Cảm ơn bạn đã kiên nhẫn và tin tưởng shop 🤝'
            });

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

            const adminOnlineAfterCreate = await checkMoneyAdminOnline(interaction.guild);
            await ticketChannel.send({
                content: adminOnlineAfterCreate
                    ? '✅ **Admin đang online** — giao dịch của bạn đã được mở và sẽ được hỗ trợ sớm nhất.'
                    : '🌙 **Ticket đã được tạo thành công.** Hiện Admin phụ trách Money đang offline. Bạn cứ để lại thông tin/thẻ trong ticket, Admin sẽ tiếp nhận ngay khi trực tuyến. Cảm ơn bạn đã kiên nhẫn và tin tưởng shop 🤝'
            });

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

        const username = interaction.options.getString('username').trim();

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

async function createAccountPurchaseTicket(interaction, accId, paymentMethod) {
    if (!isWithinWorkingHours()) {
        const startHour = moneyConfig.workingHours?.start ?? 10;
        const endHour = moneyConfig.workingHours?.end ?? 22;
        return safeReply(interaction, {
            content: `🛑 **Shop hiện đã đóng cửa!**\n⏰ Giờ hoạt động của Bot: **${startHour}h00 - ${endHour}h00**.`,
            flags: MessageFlags.Ephemeral
        });
    }

    if (!(await safeDeferUpdate(interaction))) return;

    const accs = getDetailedAccs();
    const target = accs.find(a => a.id === accId);

    if (!target || target.status !== 'available') {
        return safeEditReply(interaction, {
            content: '❌ Sản phẩm hiện không có sẵn hoặc đang được người khác mua.',
            components: []
        });
    }

    const guild = interaction.guild;
    const channelName = `ticket-acc-${paymentMethod}-${interaction.user.username}`
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '')
        .slice(0, 70);

    try {
        const ticketChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                {
                    id: guild.id,
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
                ...adminOverwrite(guild.id)
            ]
        });

        await ticketChannel.setTopic(`accOrder:${target.id}`);

        target.status = 'pending';
        target.pendingTicketId = ticketChannel.id;
        target.pendingBuyerId = interaction.user.id;
        target.paymentMethod = paymentMethod;
        saveDetailedAccs(accs);

        const adminRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('approve_bill')
                .setLabel('Duyệt - Chọn Acc')
                .setEmoji('✅')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('reject_bill')
                .setLabel('Từ Chối')
                .setEmoji('❌')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Đóng Ticket')
                .setEmoji('🔒')
                .setStyle(ButtonStyle.Secondary)
        );

        let payEmbed;

        if (paymentMethod === 'bank') {
            const memo = `THANH TOAN DON HANG ${target.username}`;
            const qrUrl =
                `https://img.vietqr.io/image/` +
                `${BANK_CONFIG.BANK_ID}-${BANK_CONFIG.ACCOUNT_NO}-compact2.png` +
                `?amount=${target.priceBank}` +
                `&addInfo=${encodeURIComponent(memo)}` +
                `&accountName=${encodeURIComponent(BANK_CONFIG.ACCOUNT_NAME)}`;

            payEmbed = new EmbedBuilder()
                .setTitle(`🏦 THANH TOÁN BANK: ${target.username}`)
                .setColor('#2ecc71')
                .setDescription(
                    `Chào <@${interaction.user.id}>!\n` +
                    'Vui lòng chuyển khoản đúng số tiền bên dưới và gửi ảnh bill vào ticket. '
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
                        value: `\`${target.priceBank.toLocaleString('vi-VN')} VNĐ\``,
                        inline: true
                    },
                    {
                        name: '📌 Nội dung CK',
                        value: `\`\`\`${memo}\`\`\``
                    }
                )
                .setImage(qrUrl)
                .setFooter({ text: 'Gửi ảnh bill sau khi chuyển khoản.' });
        } else {
            payEmbed = new EmbedBuilder()
                .setTitle(`🎟️ THANH TOÁN THẺ: ${target.username}`)
                .setColor('#f1c40f')
                .setDescription(
                    `Chào <@${interaction.user.id}>!\n` +
                    'Vui lòng gửi **ảnh thẻ hoặc thông tin thẻ** vào ticket để Admin kiểm tra.'
                )
                .addFields(
                    {
                        name: '🎮 Account',
                        value: `\`${target.username}\``,
                        inline: true
                    },
                    {
                        name: '🎟️ Giá Thẻ',
                        value: `\`${target.priceCard.toLocaleString('vi-VN')} VNĐ\``,
                        inline: true
                    },
                    {
                        name: '📌 Cần gửi',
                        value: 'Loại thẻ + Mã thẻ + Seri',
                    }
                )
                .setFooter({ text: 'Admin sẽ kiểm tra thẻ trước khi duyệt.' });
        }

        await ticketChannel.send({
            content: `<@${interaction.user.id}>`,
            embeds: [payEmbed],
            components: [adminRow]
        });

        return safeEditReply(interaction, {
            content:
                `✅ **Đã tạo Ticket mua Acc bằng ${paymentMethod === 'bank' ? 'Bank' : 'Card'}!**\n` +
                `👉 ${ticketChannel}`,
            components: []
        });
    } catch (err) {
        target.status = 'available';
        target.pendingTicketId = null;
        target.pendingBuyerId = null;
        target.paymentMethod = null;
        saveDetailedAccs(accs);

        return safeEditReply(interaction, {
            content: `❌ Lỗi khi tạo Ticket: \`${err.message}\``,
            components: []
        });
    }
}

async function handleAccSelectMenu(interaction) {
    if (interaction.customId.startsWith('account_payment_')) {
        const accId = interaction.customId.replace('account_payment_', '');
        const paymentMethod = interaction.values[0];
        if (!['bank', 'card'].includes(paymentMethod)) {
            return safeReply(interaction, {
                content: '❌ Phương thức thanh toán không hợp lệ.',
                flags: MessageFlags.Ephemeral
            });
        }
        return createAccountPurchaseTicket(interaction, accId, paymentMethod);
    }

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

        const accId = id.replace('buy_single_', '');
        const accs = getDetailedAccs();
        const target = accs.find(a => a.id === accId);

        if (!target || target.status !== 'available') {
            return safeReply(interaction, {
                content: '❌ Sản phẩm hiện không có sẵn hoặc đang được người khác mua.',
                flags: MessageFlags.Ephemeral
            });
        }

        const paymentMenu = new StringSelectMenuBuilder()
            .setCustomId(`account_payment_${target.id}`)
            .setPlaceholder('💳 Chọn phương thức thanh toán...')
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel(`Ngân hàng — ${target.priceBank.toLocaleString('vi-VN')} VNĐ`)
                    .setDescription('Thanh toán bằng chuyển khoản ngân hàng')
                    .setEmoji('🏦')
                    .setValue('bank'),
                new StringSelectMenuOptionBuilder()
                    .setLabel(`Thẻ cào — ${target.priceCard.toLocaleString('vi-VN')} VNĐ`)
                    .setDescription('Thanh toán bằng thẻ cào')
                    .setEmoji('🎟️')
                    .setValue('card')
            );

        return safeReply(interaction, {
            content:
                `🛒 **MUA ACCOUNT: ${target.username}**\n` +
                `🏦 Bank: **${target.priceBank.toLocaleString('vi-VN')} VNĐ**\n` +
                `🎟️ Card: **${target.priceCard.toLocaleString('vi-VN')} VNĐ**\n\n` +
                'Vui lòng chọn phương thức thanh toán bên dưới:',
            components: [new ActionRowBuilder().addComponents(paymentMenu)],
            flags: MessageFlags.Ephemeral
        });
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
// 18. SLASH COMMANDS
// ============================================================

async function handleTicketCommand(interaction) {
    if (!isAdminUser(interaction)) {
        return safeReply(interaction, {
            content: '❌ Bạn không có quyền dùng lệnh này!',
            flags: MessageFlags.Ephemeral
        });
    }

    if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;

    try {
        const panelConfig = loadTicketPanelConfig();
        let panelMessage = null;

        if (
            panelConfig.channelId === interaction.channelId &&
            panelConfig.messageId
        ) {
            try {
                panelMessage = await interaction.channel.messages.fetch(
                    String(panelConfig.messageId)
                );
                await panelMessage.edit(buildTicketPanel());
            } catch (err) {
                panelMessage = null;
            }
        }

        if (!panelMessage) {
            panelMessage = await interaction.channel.send(buildTicketPanel());
        }

        saveTicketPanelConfig({
            channelId: interaction.channelId,
            messageId: panelMessage.id
        });

        return safeEditReply(interaction, {
            content: `✅ Đã thiết lập **Bảng Ticket cố định** tại <#${interaction.channelId}>.`
        });
    } catch (err) {
        return safeEditReply(interaction, {
            content: `❌ Không thể setup Ticket: \`${err.message}\``
        });
    }
}

const MONEY_COMMAND_NAMES = [
    'setup', 'setstock', 'rate', 'time'
];

const THU_MONEY_COMMAND_NAMES = [
    'thumoney', 'thu-time'
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
    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Thiết lập bảng Ticket cố định'),

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
        .setDescription('Đổi tỷ giá Buy Money hoặc Thu Money')
        .addIntegerOption(opt =>
            opt
                .setName('value')
                .setDescription('Rate mới, ví dụ: 130')
                .setMinValue(1)
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt
                .setName('type')
                .setDescription('Chọn loại giá muốn đổi')
                .addChoices(
                    { name: 'Buy Money (mặc định)', value: 'buy' },
                    { name: 'Thu Money hôm nay', value: 'thu' }
                )
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('thumoney')
        .setDescription('Tạo bảng Thu Money KingSMP cố định'),

    new SlashCommandBuilder()
        .setName('thu-time')
        .setDescription('Cài đặt giờ làm việc riêng cho Thu Money')
        .addIntegerOption(opt =>
            opt.setName('start').setDescription('Giờ bắt đầu (0-23)').setMinValue(0).setMaxValue(23).setRequired(true)
        )
        .addIntegerOption(opt =>
            opt.setName('end').setDescription('Giờ kết thúc (0-23)').setMinValue(0).setMaxValue(23).setRequired(true)
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
            if (interaction.commandName === 'ticket') {
                return await handleTicketCommand(interaction);
            }

            if (MONEY_COMMAND_NAMES.includes(interaction.commandName)) {
                return await handleMoneyCommand(interaction);
            }

            if (THU_MONEY_COMMAND_NAMES.includes(interaction.commandName)) {
                return await handleThuMoneyCommand(interaction);
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

            if (id === 'ticket_change_seller') {
                return safeReply(interaction, {
                    content: '🔄 **Chọn Seller bạn yêu thích để chuyển sang:**',
                    components: [await buildSellerSelectMenu(interaction.guild)],
                    flags: MessageFlags.Ephemeral
                });
            }

            if (id === 'ticket_open_menu') {
                return safeReply(interaction, {
                    content: '🎫 **Chọn loại Ticket bạn cần:**',
                    components: [buildTicketTypeMenu()],
                    flags: MessageFlags.Ephemeral
                });
            }

            if (id === 'thu_money_create') {
                return await createThuMoneyTicket(interaction);
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

            if (id === 'ticket_type_select') {
                const type = interaction.values[0];
                if (type === 'buy_items') {
                    return safeReply(interaction, {
                        content: '🛒 **Chọn Seller bạn yêu thích:**\n\nTên Seller ở trên, trạng thái Online/Offline ở dưới.',
                        components: [await buildSellerSelectMenu(interaction.guild)],
                        flags: MessageFlags.Ephemeral
                    });
                }
                return await createGeneralTicket(interaction, type);
            }

            if (id === 'ticket_seller_select') {
                const sellerId = interaction.values[0];
                const seller = getSellerInfo(sellerId);
                if (!seller) return safeReply(interaction, { content: '❌ Seller không hợp lệ.', flags: MessageFlags.Ephemeral });

                const topic = String(interaction.channel?.topic || '');
                if (topic.startsWith('generalTicket:buy_items:')) {
                    return await switchTicketSeller(interaction, sellerId);
                }

                return await createGeneralTicket(interaction, 'buy_items', sellerId);
            }

            if (
                id.startsWith('account_payment_') ||
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
    await updateThuMoneyPanel();
    setInterval(() => updateThuMoneyPanel(), 60 * 1000);
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
