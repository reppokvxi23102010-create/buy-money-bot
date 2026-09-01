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
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    MessageFlags,
    PermissionsBitField,
    ChannelType,
    Events
} = require('discord.js');

// ============================================================
// 1. BASIC CONFIG
// ============================================================

const PORT = process.env.PORT || 10000;

process.env.ADMIN_ROLE_ID = (process.env.ADMIN_ROLE_ID || '1516082552530800875').trim();
process.env.SELLER_ROLE_ID = (process.env.SELLER_ROLE_ID || '1531205202265247794').trim();
process.env.BUILDER_ROLE_ID = (process.env.BUILDER_ROLE_ID || '1531202502681301094').trim();

const ADMIN_DISCORD_ID = String(process.env.ADMIN_DISCORD_ID || '').trim();

const BANK_CONFIG = {
    BANK_ID: process.env.BANK_ID || 'MB',
    ACCOUNT_NO: process.env.ACCOUNT_NO || '0357597469',
    ACCOUNT_NAME: process.env.ACCOUNT_NAME || 'TRAN HUU HAI SON'
};

const CONFIG_FILE = path.join(__dirname, 'config.json');
const ACC_STOCK_FILE = path.join(__dirname, 'accounts.json');
const ACC_DETAIL_FILE = path.join(__dirname, 'accounts_detail.json');

const TICKET_CONFIG_KEY = 'ticketPanel';

// Seller IDs used by the ticket menu.
// These are kept as simple fixed Seller accounts so the recruitment/shop system is gone.
const ITEM_SELLERS = [
    { id: '1513494095559921775', label: 'T1', emoji: '1️⃣' },
    { id: '1542430933724962817', label: 'T2', emoji: '2️⃣' },
    { id: '1198608624080142517', label: 'T3', emoji: '3️⃣' },
    { id: '908316104391266325', label: 'T4', emoji: '4️⃣' }
];

// ============================================================
// 2. WEB SERVER (KEEP RENDER ALIVE)
// ============================================================

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Discord Ticket + Account Bot đang hoạt động!');
}).listen(PORT, () => {
    console.log(`[HTTP] Server listening on ${PORT}`);
});

// ============================================================
// 3. DISCORD CLIENT
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
// 4. JSON HELPERS
// ============================================================

function ensureJsonFile(file, defaultValue) {
    try {
        if (!fs.existsSync(file)) {
            fs.writeFileSync(file, JSON.stringify(defaultValue, null, 2), 'utf8');
        }
    } catch (err) {
        console.error(`Không thể tạo ${file}:`, err.message);
    }
}

function readJson(file, fallback) {
    try {
        ensureJsonFile(file, fallback);
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        console.error(`Không thể đọc ${file}:`, err.message);
        return fallback;
    }
}

function writeJson(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error(`Không thể ghi ${file}:`, err.message);
        return false;
    }
}

function loadConfig() {
    return readJson(CONFIG_FILE, {});
}

function saveConfig(data) {
    writeJson(CONFIG_FILE, data);
}

// ============================================================
// 5. INTERACTION SAFETY
// ============================================================

const seenInteractions = new Set();

function claimInteraction(interaction) {
    if (seenInteractions.has(interaction.id)) return false;

    seenInteractions.add(interaction.id);
    setTimeout(() => seenInteractions.delete(interaction.id), 10 * 60 * 1000);

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
        console.error('safeReply:', err.message);
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
        console.error('safeDeferReply:', err.message);
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
        console.error('safeDeferUpdate:', err.message);
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
        console.error('safeEditReply:', err.message);
        return null;
    }
}

// ============================================================
// 6. PERMISSIONS
// ============================================================

function isAdminUser(interaction) {
    const isAdminId =
        Boolean(ADMIN_DISCORD_ID) &&
        interaction.user?.id === ADMIN_DISCORD_ID;

    const hasAdminPerm =
        interaction.memberPermissions?.has(
            PermissionsBitField.Flags.Administrator
        );

    const roleId = String(process.env.ADMIN_ROLE_ID || '').trim();
    const hasAdminRole =
        Boolean(roleId) &&
        interaction.member?.roles?.cache?.has(roleId);

    return Boolean(isAdminId || hasAdminPerm || hasAdminRole);
}

function adminOverwrite() {
    const roleId = String(process.env.ADMIN_ROLE_ID || '').trim();

    if (roleId) {
        return [{
            id: roleId,
            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.AttachFiles,
                PermissionsBitField.Flags.ManageChannels
            ]
        }];
    }

    if (ADMIN_DISCORD_ID) {
        return [{
            id: ADMIN_DISCORD_ID,
            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.AttachFiles,
                PermissionsBitField.Flags.ManageChannels
            ]
        }];
    }

    return [];
}

function getTicketAdminRoleId() {
    return String(process.env.ADMIN_ROLE_ID || '').trim();
}

function getTicketAdminMention() {
    const roleId = getTicketAdminRoleId();
    return roleId ? `<@&${roleId}>` : 'Admin';
}

function getSellerInfo(sellerId) {
    return ITEM_SELLERS.find(s => s.id === String(sellerId)) || null;
}

async function isSellerOnline(guild, sellerId) {
    try {
        const member = await guild.members.fetch(String(sellerId));
        return Boolean(member?.presence?.status && member.presence.status !== 'offline');
    } catch {
        return false;
    }
}

async function getSellerDisplayName(guild, sellerId) {
    try {
        const member = await guild.members.fetch(String(sellerId));
        return member?.displayName || member?.user?.globalName || member?.user?.username || `Seller ${sellerId.slice(-4)}`;
    } catch {
        return `Seller ${String(sellerId).slice(-4)}`;
    }
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
                .setLabel(String(name).slice(0, 100))
                .setDescription((online ? '🟢 ONLINE' : '🔴 OFFLINE').slice(0, 100))
                .setEmoji(seller.emoji)
                .setValue(String(seller.id))
        );
    }

    return new ActionRowBuilder().addComponents(menu);
}

// ============================================================
// 7. GENERAL TICKET SYSTEM
// ============================================================

function loadTicketPanelConfig() {
    const config = loadConfig();
    return config?.[TICKET_CONFIG_KEY] || {};
}

function saveTicketPanelConfig(data) {
    const config = loadConfig();
    config[TICKET_CONFIG_KEY] = data || {};
    saveConfig(config);
}

function buildTicketPanel() {
    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🎫 HỖ TRỢ & GIAO DỊCH')
        .setDescription(
            'Bấm **Mở Menu Ticket** để chọn nhu cầu.\n\n' +
            '🛒 **Mua vật phẩm KingSMP / DonutSMP** → Chọn Seller\n' +
            '🏗️ **Builder / Dịch vụ xây dựng** → Ping Builder\n' +
            '🛠️ **Hỗ trợ / Khác** → Ping Admin\n' +
            '💎 **Thu mua Account Minecraft Premium** → Ping Admin\n' +
            '🛒 **Mua Account Minecraft** → Mở từ nút Mua Ngay ở bài đăng Account'
        )
        .setFooter({ text: 'Chọn đúng mục để được hỗ trợ nhanh.' })
        .setTimestamp();

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_open_menu')
                    .setLabel('Mở Menu Ticket')
                    .setEmoji('🎫')
                    .setStyle(ButtonStyle.Primary)
            )
        ]
    };
}

function buildTicketTypeMenu() {
    const menu = new StringSelectMenuBuilder()
        .setCustomId('ticket_type_select')
        .setPlaceholder('🎫 Chọn loại Ticket...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Mua vật phẩm KingSMP / DonutSMP')
                .setDescription('Tạo ticket và chọn Seller')
                .setEmoji('🛒')
                .setValue('buy_items'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Builder / Dịch vụ xây dựng')
                .setDescription('Tạo ticket và ping Builder')
                .setEmoji('🏗️')
                .setValue('builder'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Hỗ trợ / Khác')
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
            description: 'Seller sẽ vào ticket để hỗ trợ giao dịch.',
            roleId: String(process.env.SELLER_ROLE_ID || '').trim(),
            ping: String(process.env.SELLER_ROLE_ID || '').trim()
                ? `<@&${String(process.env.SELLER_ROLE_ID).trim()}>`
                : 'Seller'
        },
        builder: {
            prefix: 'builder',
            title: '🏗️ BUILDER / DỊCH VỤ XÂY DỰNG',
            description: 'Builder sẽ vào ticket để trao đổi yêu cầu và giá.',
            roleId: String(process.env.BUILDER_ROLE_ID || '').trim(),
            ping: String(process.env.BUILDER_ROLE_ID || '').trim()
                ? `<@&${String(process.env.BUILDER_ROLE_ID).trim()}>`
                : 'Builder'
        },
        support: {
            prefix: 'support',
            title: '🛠️ HỖ TRỢ / KHÁC',
            description: 'Admin sẽ tiếp nhận yêu cầu của bạn.',
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

async function createGeneralTicket(interaction, type, sellerId = null) {
    const info = ticketTypeInfo(type);

    if (!info || !interaction.guild) {
        return safeReply(interaction, {
            content: '❌ Không xác định được loại Ticket.',
            flags: MessageFlags.Ephemeral
        });
    }

    if (!(await safeDeferUpdate(interaction))) return;

    const baseName = `${info.prefix}-${interaction.user.username}`
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '')
        .slice(0, 60) || `${info.prefix}-ticket`;

    try {
        const rawOverwrites = [
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
            ...ticketRoleOverwrite(info.roleId),
            ...adminOverwrite()
        ];

        const seen = new Set();
        const permissionOverwrites = rawOverwrites.filter(x => {
            const id = String(x.id || '');
            if (!id || seen.has(id)) return false;
            seen.add(id);
            return true;
        });

        const ticketChannel = await interaction.guild.channels.create({
            name: `ticket-${baseName}`,
            type: ChannelType.GuildText,
            topic: `generalTicket:${type}:${interaction.user.id}${sellerId ? `:${sellerId}` : ''}`,
            permissionOverwrites
        });

        const seller = sellerId ? getSellerInfo(sellerId) : null;
        const responsiblePing = seller ? `<@${seller.id}>` : info.ping;
        const sellerDisplayName = seller ? await getSellerDisplayName(interaction.guild, seller.id) : '';
        const sellerOnline = seller ? await isSellerOnline(interaction.guild, seller.id) : false;

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(info.title)
            .setDescription(
                `Xin chào <@${interaction.user.id}>!\n\n` +
                `${info.description}\n\n` +
                `📌 **Người phụ trách:** ${responsiblePing}\n` +
                (seller
                    ? `🏷️ **Seller:** ${sellerDisplayName}\n📡 **Trạng thái:** ${sellerOnline ? 'ONLINE' : 'OFFLINE'}\n`
                    : '') +
                '🔒 Khi xong giao dịch, Admin có thể đóng ticket.'
            )
            .setFooter({ text: `Ticket của ${interaction.user.tag}` })
            .setTimestamp();

        const closeRow = new ActionRowBuilder().addComponents(
            ...(seller
                ? [
                    new ButtonBuilder()
                        .setCustomId('ticket_change_seller')
                        .setLabel('Chuyển Seller')
                        .setEmoji('🔄')
                        .setStyle(ButtonStyle.Primary)
                ]
                : []),
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Đóng Ticket')
                .setEmoji('🔒')
                .setStyle(ButtonStyle.Danger)
        );

        const allowedUsers = [interaction.user.id];
        if (seller) allowedUsers.push(seller.id);

        await ticketChannel.send({
            content: seller
                ? `<@${interaction.user.id}> <@${seller.id}>`
                : `<@${interaction.user.id}> ${info.ping}`,
            embeds: [embed],
            components: [closeRow],
            allowedMentions: {
                users: allowedUsers,
                roles: info.roleId ? [info.roleId] : []
            }
        });

        return safeEditReply(interaction, {
            content: `✅ **Đã tạo Ticket!**\n👉 ${ticketChannel}`
        });
    } catch (err) {
        return safeEditReply(interaction, {
            content: `❌ Không thể tạo Ticket: \`${err.message}\``
        });
    }
}

async function switchTicketSeller(interaction, sellerId) {
    const channel = interaction.channel;
    const guild = interaction.guild;

    if (!channel || !guild) {
        return safeReply(interaction, {
            content: '❌ Không tìm thấy ticket.',
            flags: MessageFlags.Ephemeral
        });
    }

    const match = String(channel.topic || '').match(/^generalTicket:buy_items:(\d+)(?::(\d+))?$/);

    if (!match) {
        return safeReply(interaction, {
            content: '❌ Ticket này không hỗ trợ chuyển Seller.',
            flags: MessageFlags.Ephemeral
        });
    }

    const customerId = match[1];
    const oldSellerId = match[2] || null;

    if (interaction.user.id !== customerId && !isAdminUser(interaction)) {
        return safeReply(interaction, {
            content: '❌ Chỉ khách trong ticket hoặc Admin mới được đổi Seller.',
            flags: MessageFlags.Ephemeral
        });
    }

    const newSeller = getSellerInfo(sellerId);
    if (!newSeller) {
        return safeReply(interaction, {
            content: '❌ Seller không hợp lệ.',
            flags: MessageFlags.Ephemeral
        });
    }

    if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;

    try {
        if (oldSellerId) {
            await channel.permissionOverwrites.delete(oldSellerId).catch(() => {});
        }

        await channel.permissionOverwrites.edit(newSeller.id, {
            ViewChannel: true,
            SendMessages: true,
            AttachFiles: true
        });

        await channel.setTopic(`generalTicket:buy_items:${customerId}:${newSeller.id}`);

        const displayName = await getSellerDisplayName(guild, newSeller.id);
        const online = await isSellerOnline(guild, newSeller.id);

        await channel.send({
            content: `<@${customerId}> <@${newSeller.id}>`,
            embeds: [
                new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle('🔄 ĐÃ CHUYỂN SELLER')
                    .setDescription(
                        `👤 Seller mới: **${displayName}**\n` +
                        `📡 Trạng thái: **${online ? 'ONLINE' : 'OFFLINE'}**`
                    )
                    .setTimestamp()
            ],
            allowedMentions: { users: [customerId, newSeller.id] }
        });

        return safeEditReply(interaction, {
            content: `✅ Đã chuyển ticket sang **${displayName}**.`
        });
    } catch (err) {
        return safeEditReply(interaction, {
            content: `❌ Không thể chuyển Seller: \`${err.message}\``
        });
    }
}

// ============================================================
// 8. ACCOUNT DATA
// ============================================================

function getAccStock() {
    return readJson(ACC_STOCK_FILE, []);
}

function saveAccStock(stock) {
    writeJson(ACC_STOCK_FILE, stock);
}

function getDetailedAccs() {
    return readJson(ACC_DETAIL_FILE, []);
}

function saveDetailedAccs(accs) {
    writeJson(ACC_DETAIL_FILE, accs);
}

function createAccEmbed(acc) {
    const statusText =
        acc.status === 'available'
            ? '🟢 Có Sẵn'
            : acc.status === 'pending'
                ? '🟡 Đang Có Người Mua'
                : '🔴 Đã Bán';

    const embed = new EmbedBuilder()
        .setColor(
            acc.status === 'available'
                ? '#2ecc71'
                : acc.status === 'pending'
                    ? '#f1c40f'
                    : '#e74c3c'
        )
        .setTitle(`🎮 ${acc.username}`)
        .setDescription(
            `🏦 **Giá Bank:** ${Number(acc.priceBank || 0).toLocaleString('vi-VN')} VNĐ\n` +
            `🎟️ **Giá Thẻ:** ${Number(acc.priceCard || 0).toLocaleString('vi-VN')} VNĐ\n` +
            `✅ **Trạng thái:** ${statusText}`
        )
        .addFields(
            {
                name: '🏷️ Username',
                value: `\`${acc.username || 'Không có'}\``,
                inline: true
            },
            {
                name: '👕 Cape',
                value: `\`${acc.capeCount ?? 0}\``,
                inline: true
            },
            {
                name: '✨ Cape Chi Tiết',
                value: `\`${acc.capeList || 'Không'}\``,
                inline: true
            },
            {
                name: '⭐ Rank',
                value: `\`${acc.rank || 'Không'}\``,
                inline: true
            }
        )
        .setTimestamp();

    if (acc.imageUrl) embed.setImage(acc.imageUrl);

    return embed;
}

async function editListing(acc, mode = 'buy') {
    if (!acc?.channelId || !acc?.messageId) return false;

    try {
        const channel = await client.channels.fetch(String(acc.channelId));
        if (!channel?.isTextBased()) return false;

        const message = await channel.messages.fetch(String(acc.messageId));

        let row;

        if (mode === 'sold') {
            row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`sold_${acc.id}`)
                    .setLabel('🔴 Đã Bán')
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(true)
            );
        } else if (mode === 'pending') {
            row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`pending_${acc.id}`)
                    .setLabel('🟡 Đang Có Người Mua')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true)
            );
        } else {
            row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`buy_single_${acc.id}`)
                    .setLabel('Mua Ngay')
                    .setEmoji('🛒')
                    .setStyle(ButtonStyle.Success)
            );
        }

        await message.edit({
            embeds: [createAccEmbed(acc)],
            components: [row]
        });

        return true;
    } catch (err) {
        console.error(`editListing ${acc.username}:`, err.message);
        return false;
    }
}

// ============================================================
// 9. ACCOUNT ADMIN COMMANDS
// ============================================================

async function handleAccCommand(interaction) {
    if (!isAdminUser(interaction)) {
        return safeReply(interaction, {
            content: '❌ Bạn không có quyền dùng lệnh này!',
            flags: MessageFlags.Ephemeral
        });
    }

    if (interaction.commandName === 'setstockacc') {
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;

        const rawData = interaction.options.getString('danh_sach', true);
        const lines = rawData.split('\n').map(x => x.trim()).filter(Boolean);

        const stock = getAccStock();
        let count = 0;

        for (const line of lines) {
            const parts = line.split('|').map(x => x.trim());

            if (parts.length >= 2) {
                stock.push({
                    id: `stock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    name: parts[0] || 'Chưa đặt tên',
                    email: parts[1] || 'Không có email',
                    recoveryCode: parts[2] || 'Không có'
                });
                count++;
            }
        }

        saveAccStock(stock);

        return safeEditReply(interaction, {
            content: `✅ Đã thêm **${count} acc** vào kho!\n📦 Tổng kho: **${stock.length} acc**`
        });
    }

    if (interaction.commandName === 'acc') {
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;

        const stock = getAccStock();

        if (!stock.length) {
            return safeEditReply(interaction, {
                content: '❌ Kho tài khoản đang trống! Dùng `/setstockacc` để thêm.'
            });
        }

        const menu = new StringSelectMenuBuilder()
            .setCustomId('select_stock_acc_manual')
            .setPlaceholder('📦 Chọn 1 tài khoản để lấy...')
            .addOptions(
                stock.slice(0, 25).map(item =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(String(item.name || 'Không có tên').slice(0, 100))
                        .setDescription(`Email: ${String(item.email || 'Không email').slice(0, 90)}`)
                        .setValue(String(item.id))
                )
            );

        return safeEditReply(interaction, {
            content: `📦 **Kho tài khoản: ${stock.length} acc**\nChọn tài khoản bên dưới:`,
            components: [new ActionRowBuilder().addComponents(menu)]
        });
    }

    if (interaction.commandName === 'deleteacc') {
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;

        const stock = getAccStock();

        if (!stock.length) {
            return safeEditReply(interaction, {
                content: '❌ Kho tài khoản đang trống!'
            });
        }

        const menu = new StringSelectMenuBuilder()
            .setCustomId('select_delete_acc_menu')
            .setPlaceholder('🗑️ Chọn tài khoản muốn xóa...')
            .addOptions(
                stock.slice(0, 25).map(item =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(String(item.name || 'Không tên').slice(0, 100))
                        .setDescription(`Email: ${String(item.email || 'Không email').slice(0, 90)}`)
                        .setValue(String(item.id))
                )
            );

        return safeEditReply(interaction, {
            content: `🗑️ **Kho hiện có ${stock.length} acc**\nChọn tài khoản muốn xóa:`,
            components: [new ActionRowBuilder().addComponents(menu)]
        });
    }

    if (interaction.commandName === 'thongtin') {
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;

        const username = interaction.options.getString('username', true).trim();
        const priceBank = interaction.options.getInteger('price_bank', true);
        const priceCard = interaction.options.getInteger('price_card', true);
        const capeCount = interaction.options.getInteger('cape_count', true);
        const capeList = interaction.options.getString('cape_list', true).trim();
        const rank = interaction.options.getString('rank', true);
        const imageUrl = interaction.options.getString('image_url')?.trim() || null;

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
            pendingBuyerId: null,
            paymentMethod: null
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
            content: `✅ Đã đăng bán Acc \`${username}\` thành công!`
        });
    }

    if (interaction.commandName === 'price') {
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;

        const username = interaction.options.getString('username', true).trim();
        const newBank = interaction.options.getInteger('price_bank', true);
        const newCard = interaction.options.getInteger('price_card', true);

        const accs = getDetailedAccs();
        const target = accs.find(a => a.username?.toLowerCase() === username.toLowerCase());

        if (!target) {
            return safeEditReply(interaction, {
                content: `❌ Không tìm thấy Acc: \`${username}\``
            });
        }

        target.priceBank = newBank;
        target.priceCard = newCard;
        saveDetailedAccs(accs);
        await editListing(target, target.status === 'available' ? 'buy' : target.status);

        return safeEditReply(interaction, {
            content: `✅ Đã cập nhật giá cho Acc \`${username}\`!`
        });
    }

    if (interaction.commandName === 'cape') {
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;

        const username = interaction.options.getString('username', true).trim();
        const count = interaction.options.getInteger('cape_count', true);
        const list = interaction.options.getString('cape_list', true).trim();

        const accs = getDetailedAccs();
        const target = accs.find(a => a.username?.toLowerCase() === username.toLowerCase());

        if (!target) {
            return safeEditReply(interaction, {
                content: `❌ Không tìm thấy Acc: \`${username}\``
            });
        }

        target.capeCount = count;
        target.capeList = list;

        saveDetailedAccs(accs);
        await editListing(target, target.status === 'available' ? 'buy' : target.status);

        return safeEditReply(interaction, {
            content: `✅ Đã cập nhật Cape cho Acc \`${username}\`: **${count} Cape (${list})**`
        });
    }
}

// ============================================================
// 10. ACCOUNT PURCHASE FLOW
// ============================================================

async function createAccountPurchaseTicket(interaction, accId, paymentMethod) {
    if (!interaction.guild) {
        return safeReply(interaction, {
            content: '❌ Không có Server Discord.',
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

    const channelName = `ticket-acc-${paymentMethod}-${interaction.user.username}`
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '')
        .slice(0, 70) || `ticket-acc-${paymentMethod}`;

    try {
        const ticketChannel = await interaction.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            topic: `accOrder:${target.id}`,
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
                ...adminOverwrite()
            ]
        });

        target.status = 'pending';
        target.pendingTicketId = ticketChannel.id;
        target.pendingBuyerId = interaction.user.id;
        target.paymentMethod = paymentMethod;
        saveDetailedAccs(accs);
        await editListing(target, 'pending');

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
                `?amount=${encodeURIComponent(target.priceBank)}` +
                `&addInfo=${encodeURIComponent(memo)}` +
                `&accountName=${encodeURIComponent(BANK_CONFIG.ACCOUNT_NAME)}`;

            payEmbed = new EmbedBuilder()
                .setTitle(`🏦 THANH TOÁN BANK: ${target.username}`)
                .setColor('#2ecc71')
                .setDescription(
                    `Chào <@${interaction.user.id}>!\n` +
                    'Vui lòng chuyển khoản đúng số tiền và gửi ảnh bill vào ticket.'
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
                        name: '🎮 Account',
                        value: `\`${target.username}\``,
                        inline: true
                    },
                    {
                        name: '💵 Giá Bank',
                        value: `\`${Number(target.priceBank).toLocaleString('vi-VN')} VNĐ\``,
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
                        value: `\`${Number(target.priceCard).toLocaleString('vi-VN')} VNĐ\``,
                        inline: true
                    },
                    {
                        name: '📌 Cần gửi',
                        value: 'Loại thẻ + Mã thẻ + Seri'
                    }
                )
                .setFooter({ text: 'Admin sẽ kiểm tra thông tin trước khi duyệt.' });
        }

        await ticketChannel.send({
            content: `<@${interaction.user.id}> ${getTicketAdminMention()}`,
            embeds: [payEmbed],
            components: [adminRow],
            allowedMentions: {
                users: [interaction.user.id],
                roles: getTicketAdminRoleId() ? [getTicketAdminRoleId()] : []
            }
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
        await editListing(target, 'buy');

        return safeEditReply(interaction, {
            content: `❌ Lỗi khi tạo Ticket: \`${err.message}\``,
            components: []
        });
    }
}

async function handleAccSelectMenu(interaction) {
    const id = interaction.customId;

    if (id.startsWith('account_payment_')) {
        const accId = id.replace('account_payment_', '');
        const paymentMethod = interaction.values[0];

        if (!['bank', 'card'].includes(paymentMethod)) {
            return safeReply(interaction, {
                content: '❌ Phương thức thanh toán không hợp lệ.',
                flags: MessageFlags.Ephemeral
            });
        }

        return createAccountPurchaseTicket(interaction, accId, paymentMethod);
    }

    if (id === 'select_stock_acc_manual') {
        if (!isAdminUser(interaction)) {
            return safeReply(interaction, {
                content: '❌ Bạn không có quyền!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!(await safeDeferUpdate(interaction))) return;

        const selectedId = interaction.values[0];
        const stock = getAccStock();
        const index = stock.findIndex(a => String(a.id) === String(selectedId));

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
                    value: `\`\`\`${foundAcc.recoveryCode || 'Không có'}\`\`\``
                }
            )
            .setFooter({ text: '⚠️ Tài khoản đã được rút khỏi kho.' });

        return safeEditReply(interaction, {
            content: `✅ Đã rút thành công: \`${foundAcc.name}\``,
            embeds: [embed],
            components: []
        });
    }

    if (id === 'select_delete_acc_menu') {
        if (!isAdminUser(interaction)) {
            return safeReply(interaction, {
                content: '❌ Bạn không có quyền!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!(await safeDeferUpdate(interaction))) return;

        const selectedId = interaction.values[0];
        const stock = getAccStock();
        const target = stock.find(a => String(a.id) === String(selectedId));

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

    if (id.startsWith('select_deliver_acc_')) {
        if (!isAdminUser(interaction)) {
            return safeReply(interaction, {
                content: '❌ Chỉ Admin mới có quyền chọn!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!(await safeDeferUpdate(interaction))) return;

        const selectedId = interaction.values[0];
        const stock = getAccStock();
        const index = stock.findIndex(a => String(a.id) === String(selectedId));

        if (index === -1) {
            return safeEditReply(interaction, {
                content: '❌ Tài khoản đã bị lấy hoặc không tồn tại!',
                components: []
            });
        }

        const topic = String(interaction.channel?.topic || '');
        if (!topic.startsWith('accOrder:')) {
            return safeEditReply(interaction, {
                content: '❌ Không xác định được đơn hàng Account của Ticket này.',
                components: []
            });
        }

        const accId = topic.replace('accOrder:', '');
        const accs = getDetailedAccs();
        const target = accs.find(a => a.id === accId);

        if (!target) {
            return safeEditReply(interaction, {
                content: '❌ Không tìm thấy sản phẩm Account!',
                components: []
            });
        }

        if (target.status !== 'pending') {
            return safeEditReply(interaction, {
                content: `⚠️ Đơn này không còn chờ duyệt. Trạng thái: \`${target.status}\``,
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
        await editListing(target, 'sold');

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
            .setDescription('Đơn hàng đã được Admin duyệt. Thông tin tài khoản:')
            .addFields(
                {
                    name: '🎮 Tên / Ghi chú',
                    value: `\`${deliveredAcc.name || 'Acc'}\``
                },
                {
                    name: '📧 Email',
                    value: `\`\`\`${deliveredAcc.email || 'Không có'}\`\`\``
                },
                {
                    name: '🔑 Recovery Code',
                    value: `\`\`\`${deliveredAcc.recoveryCode || 'Không có'}\`\`\``
                }
            )
            .setFooter({ text: `Còn lại ${stock.length} acc trong kho.` });

        await interaction.channel.send({
            embeds: [deliverEmbed],
            components: [closeRow]
        });

        try {
            const billMsg = await interaction.channel.messages.fetch(
                interaction.customId.replace('select_deliver_acc_', '')
            );

            await billMsg.edit({
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('approved')
                            .setLabel('Đã Duyệt & Gửi Acc')
                            .setStyle(ButtonStyle.Success)
                            .setDisabled(true)
                    )
                ]
            });
        } catch {}

        return safeEditReply(interaction, {
            content: `✅ Đã gửi acc \`${deliveredAcc.name || 'Acc'}\` cho khách!`,
            components: []
        });
    }
}

// ============================================================
// 11. ACCOUNT BUTTONS
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

        const targetId = id.replace('confirm_delete_', '');
        const stock = getAccStock();
        const initial = stock.length;
        const next = stock.filter(a => String(a.id) !== String(targetId));

        if (next.length === initial) {
            return safeEditReply(interaction, {
                content: '❌ Tài khoản đã bị xóa hoặc không tồn tại!',
                components: []
            });
        }

        saveAccStock(next);

        return safeEditReply(interaction, {
            content: `✅ Đã xóa tài khoản!\n📦 Kho còn: **${next.length} acc**`,
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
                    .setLabel(`Ngân hàng — ${Number(target.priceBank).toLocaleString('vi-VN')} VNĐ`)
                    .setDescription('Thanh toán bằng chuyển khoản ngân hàng')
                    .setEmoji('🏦')
                    .setValue('bank'),
                new StringSelectMenuOptionBuilder()
                    .setLabel(`Thẻ cào — ${Number(target.priceCard).toLocaleString('vi-VN')} VNĐ`)
                    .setDescription('Thanh toán bằng thẻ cào')
                    .setEmoji('🎟️')
                    .setValue('card')
            );

        return safeReply(interaction, {
            content:
                `🛒 **MUA ACCOUNT: ${target.username}**\n` +
                `🏦 Bank: **${Number(target.priceBank).toLocaleString('vi-VN')} VNĐ**\n` +
                `🎟️ Card: **${Number(target.priceCard).toLocaleString('vi-VN')} VNĐ**\n\n` +
                'Vui lòng chọn phương thức thanh toán:',
            components: [new ActionRowBuilder().addComponents(paymentMenu)],
            flags: MessageFlags.Ephemeral
        });
    }

    if (id === 'approve_bill') {
        if (!isAdminUser(interaction)) {
            return safeReply(interaction, {
                content: '❌ Chỉ Admin mới có quyền duyệt đơn!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;

        const topic = String(interaction.channel?.topic || '');
        if (!topic.startsWith('accOrder:')) {
            return safeEditReply(interaction, {
                content: '❌ Ticket này không phải Ticket mua Account.'
            });
        }

        const accId = topic.replace('accOrder:', '');
        const accs = getDetailedAccs();
        const target = accs.find(a => a.id === accId);

        if (!target) {
            return safeEditReply(interaction, {
                content: '❌ Không tìm thấy sản phẩm Account.'
            });
        }

        if (target.status !== 'pending') {
            return safeEditReply(interaction, {
                content: `⚠️ Sản phẩm không còn chờ duyệt. Trạng thái: \`${target.status}\``
            });
        }

        const stock = getAccStock();

        if (!stock.length) {
            return safeEditReply(interaction, {
                content: '❌ Kho Account đang trống! Dùng `/setstockacc` để thêm acc.'
            });
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`select_deliver_acc_${interaction.message.id}`)
            .setPlaceholder('📦 Chọn tài khoản trong kho để gửi...')
            .addOptions(
                stock.slice(0, 25).map(item =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(String(item.name || 'Không tên').slice(0, 100))
                        .setDescription(`Email: ${String(item.email || 'Không email').slice(0, 90)}`)
                        .setValue(String(item.id))
                )
            );

        return safeEditReply(interaction, {
            content: `📋 Kho hiện có **${stock.length} acc**.\nChọn 1 acc để gửi cho khách:`,
            components: [new ActionRowBuilder().addComponents(selectMenu)]
        });
    }

    if (id === 'reject_bill') {
        if (!isAdminUser(interaction)) {
            return safeReply(interaction, {
                content: '❌ Chỉ Admin mới có quyền từ chối!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!(await safeDeferUpdate(interaction))) return;

        const resetRow = new ActionRowBuilder().addComponents(
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

        await interaction.message.edit({ components: [resetRow] });

        return interaction.channel.send(
            '⚠️ **Bill chưa hợp lệ hoặc giao dịch chưa hoàn tất.**\n' +
            'Vui lòng gửi lại bill chính xác để Admin kiểm tra.'
        );
    }
}

// ============================================================
// 12. CLOSE TICKET
// ============================================================

async function handleCloseTicket(interaction) {
    if (!isAdminUser(interaction)) {
        return safeReply(interaction, {
            content: '❌ Chỉ Admin mới có quyền đóng Ticket!',
            flags: MessageFlags.Ephemeral
        });
    }

    const topic = String(interaction.channel?.topic || '');

    if (topic.startsWith('accOrder:')) {
        const accId = topic.replace('accOrder:', '');
        const accs = getDetailedAccs();
        const target = accs.find(a => a.id === accId);

        if (target && target.status === 'pending') {
            target.status = 'available';
            target.pendingTicketId = null;
            target.pendingBuyerId = null;
            target.paymentMethod = null;

            saveDetailedAccs(accs);
            await editListing(target, 'buy');
        }
    }

    await safeReply(interaction, {
        content: '🔒 **Kênh Ticket sẽ tự động xóa sau 5 giây...**'
    });

    setTimeout(() => {
        interaction.channel?.delete().catch(() => {});
    }, 5000);
}

// ============================================================
// 13. SLASH COMMANDS
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
        const config = loadTicketPanelConfig();
        let panelMessage = null;

        if (config.channelId === interaction.channelId && config.messageId) {
            try {
                panelMessage = await interaction.channel.messages.fetch(String(config.messageId));
                await panelMessage.edit(buildTicketPanel());
            } catch {}
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

    new SlashCommandBuilder()
        .setName('setstockacc')
        .setDescription('Nạp danh sách tài khoản vào kho')
        .addStringOption(o =>
            o.setName('danh_sach')
                .setDescription('Tên Acc | Email | Recovery Code. Mỗi acc một dòng.')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('acc')
        .setDescription('Xem danh sách và lấy tài khoản ra khỏi kho'),

    new SlashCommandBuilder()
        .setName('deleteacc')
        .setDescription('Xóa tài khoản khỏi kho accounts.json'),

    new SlashCommandBuilder()
        .setName('thongtin')
        .setDescription('Đăng tin bán Acc Minecraft')
        .addStringOption(o =>
            o.setName('username')
                .setDescription('Tên Username Minecraft')
                .setRequired(true)
        )
        .addIntegerOption(o =>
            o.setName('price_bank')
                .setDescription('Giá Bank VNĐ')
                .setMinValue(1)
                .setRequired(true)
        )
        .addIntegerOption(o =>
            o.setName('price_card')
                .setDescription('Giá Thẻ Cào VNĐ')
                .setMinValue(1)
                .setRequired(true)
        )
        .addIntegerOption(o =>
            o.setName('cape_count')
                .setDescription('Số lượng Cape')
                .setMinValue(0)
                .setRequired(true)
        )
        .addStringOption(o =>
            o.setName('cape_list')
                .setDescription('Danh sách Cape')
                .setRequired(true)
        )
        .addStringOption(o =>
            o.setName('rank')
                .setDescription('Rank Ingame')
                .setRequired(true)
        )
        .addStringOption(o =>
            o.setName('image_url')
                .setDescription('Link ảnh banner')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('price')
        .setDescription('Cập nhật giá Acc')
        .addStringOption(o =>
            o.setName('username')
                .setDescription('Tên Username Minecraft')
                .setRequired(true)
        )
        .addIntegerOption(o =>
            o.setName('price_bank')
                .setDescription('Giá Bank mới')
                .setMinValue(1)
                .setRequired(true)
        )
        .addIntegerOption(o =>
            o.setName('price_card')
                .setDescription('Giá Card mới')
                .setMinValue(1)
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('cape')
        .setDescription('Cập nhật Cape cho Acc')
        .addStringOption(o =>
            o.setName('username')
                .setDescription('Tên Username Minecraft')
                .setRequired(true)
        )
        .addIntegerOption(o =>
            o.setName('cape_count')
                .setDescription('Số lượng Cape mới')
                .setMinValue(0)
                .setRequired(true)
        )
        .addStringOption(o =>
            o.setName('cape_list')
                .setDescription('Danh sách Cape mới')
                .setRequired(true)
        )
];

// ============================================================
// 14. REGISTER COMMANDS
// ============================================================

async function registerSlashCommands() {
    const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
    const clientId = process.env.CLIENT_ID || process.env.APPLICATION_ID;

    if (!token || !clientId) {
        console.error('❌ Thiếu DISCORD_TOKEN/TOKEN hoặc CLIENT_ID/APPLICATION_ID.');
        return;
    }

    const rest = new REST({ version: '10' }).setToken(token);

    try {
        if (process.env.GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(clientId, process.env.GUILD_ID),
                { body: commands.map(c => c.toJSON()) }
            );
        } else {
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: commands.map(c => c.toJSON()) }
            );
        }

        console.log(`✅ Đã đăng ký ${commands.length} slash commands.`);
    } catch (err) {
        console.error('❌ Lỗi đăng ký command:', err);
    }
}

// ============================================================
// 15. MESSAGE CREATE
// ============================================================

// Auto-detect image/bill in Account purchase tickets.
client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;

    try {
        const channel = message.channel;

        if (
            channel?.type === ChannelType.GuildText &&
            String(channel.name || '').startsWith('ticket-acc-') &&
            String(channel.topic || '').startsWith('accOrder:')
        ) {
            const hasImage = message.attachments.some(
                att => String(att.contentType || '').startsWith('image/')
            );

            if (!hasImage) return;

            const row = new ActionRowBuilder().addComponents(
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

            const embed = new EmbedBuilder()
                .setTitle('🧾 PHÁT HIỆN BILL / ẢNH THANH TOÁN')
                .setColor('#f1c40f')
                .setDescription(
                    `Khách hàng <@${message.author.id}> đã gửi ảnh.\n` +
                    'Admin kiểm tra và duyệt bên dưới.'
                )
                .setFooter({ text: 'Chỉ Admin mới có quyền duyệt.' });

            await channel.send({
                embeds: [embed],
                components: [row]
            });
        }
    } catch (err) {
        console.error('MessageCreate:', err.message);
    }
});

// ============================================================
// 16. INTERACTION CREATE
// ============================================================

client.on(Events.InteractionCreate, async interaction => {
    try {
        if (!claimInteraction(interaction)) return;

        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'ticket') {
                return handleTicketCommand(interaction);
            }

            if (ACC_COMMAND_NAMES.includes(interaction.commandName)) {
                return handleAccCommand(interaction);
            }

            return;
        }

        if (interaction.isButton()) {
            const id = interaction.customId;

            if (id === 'close_ticket') {
                return handleCloseTicket(interaction);
            }

            if (id === 'ticket_open_menu') {
                return safeReply(interaction, {
                    content: '🎫 **Chọn loại Ticket bạn cần:**',
                    components: [buildTicketTypeMenu()],
                    flags: MessageFlags.Ephemeral
                });
            }

            if (id === 'ticket_change_seller') {
                return safeReply(interaction, {
                    content: '🔄 **Chọn Seller bạn muốn chuyển sang:**',
                    components: [await buildSellerSelectMenu(interaction.guild)],
                    flags: MessageFlags.Ephemeral
                });
            }

            if (
                id.startsWith('buy_single_') ||
                id.startsWith('confirm_delete_') ||
                id === 'cancel_delete' ||
                id === 'approve_bill' ||
                id === 'reject_bill'
            ) {
                return handleAccButton(interaction);
            }

            return;
        }

        if (interaction.isStringSelectMenu()) {
            const id = interaction.customId;

            if (id === 'ticket_type_select') {
                const type = interaction.values[0];

                if (type === 'buy_items') {
                    return safeReply(interaction, {
                        content: '🛒 **Chọn Seller bạn yêu thích:**',
                        components: [await buildSellerSelectMenu(interaction.guild)],
                        flags: MessageFlags.Ephemeral
                    });
                }

                return createGeneralTicket(interaction, type);
            }

            if (id === 'ticket_seller_select') {
                const sellerId = interaction.values[0];

                const topic = String(interaction.channel?.topic || '');
                if (topic.startsWith('generalTicket:buy_items:')) {
                    return switchTicketSeller(interaction, sellerId);
                }

                return createGeneralTicket(interaction, 'buy_items', sellerId);
            }

            if (
                id.startsWith('account_payment_') ||
                id === 'select_stock_acc_manual' ||
                id === 'select_delete_acc_menu' ||
                id.startsWith('select_deliver_acc_')
            ) {
                return handleAccSelectMenu(interaction);
            }

            return;
        }
    } catch (err) {
        console.error('❌ InteractionCreate:', err);

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: '❌ Có lỗi xảy ra khi xử lý thao tác.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    }
});

// ============================================================
// 17. READY / LOGIN
// ============================================================

client.once(Events.ClientReady, async c => {
    console.log(`🤖 Bot đã online: ${c.user.tag}`);

    ensureJsonFile(CONFIG_FILE, {});
    ensureJsonFile(ACC_STOCK_FILE, []);
    ensureJsonFile(ACC_DETAIL_FILE, []);

    await registerSlashCommands();
});

process.on('unhandledRejection', err => {
    console.error('⚠️ Unhandled Rejection:', err);
});

process.on('uncaughtException', err => {
    console.error('⚠️ Uncaught Exception:', err);
});

const botToken = process.env.DISCORD_TOKEN || process.env.TOKEN;

if (!botToken) {
    console.error('❌ Không tìm thấy DISCORD_TOKEN/TOKEN trong .env!');
} else {
    client.login(botToken).catch(err => {
        console.error('❌ Login Discord thất bại:', err.message);
    });
}
