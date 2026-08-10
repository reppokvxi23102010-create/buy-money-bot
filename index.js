const http = require('http');
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.write('Bot is online!');
  res.end();
}).listen(process.env.PORT || 10000);
require('dotenv').config();
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
    MessageFlags,
    PermissionsBitField,
    ChannelType
} = require('discord.js');

// ==================== 1. KHỞI TẠO WEB SERVER (RENDER PORT BINDING) ====================
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.send('👑 KingSMP AutoBuy Bot đang hoạt động 24/7!');
});

app.listen(PORT, () => {
    console.log(`[HTTP Server] Web service listening on port ${PORT}`);
});

// ==================== 2. KHỞI TẠO DISCORD CLIENT ====================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ==================== CẤU HÌNH HỆ THỐNG ====================
const RATE = 120; // 🟢 TỶ GIÁ: 120 VNĐ = 1M$

const BANK_CONFIG = {
    BANK_ID: 'MB',
    BIN: '970422',
    ACCOUNT_NO: '0357597469',
    ACCOUNT_NAME: 'TRAN HUU HAI SON'
};

const STOCK_FILE = path.join(__dirname, 'stock.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// ==================== HÀM XỬ LÝ DỮ LIỆU ====================
function loadStock() {
    try {
        if (!fs.existsSync(STOCK_FILE)) {
            fs.writeFileSync(STOCK_FILE, JSON.stringify({ stockM: 5000 }, null, 2));
            return 5000;
        }
        const parsed = JSON.parse(fs.readFileSync(STOCK_FILE, 'utf8'));
        return parsed.stockM || 0;
    } catch (err) { return 0; }
}

function saveStock(amountM) {
    try { fs.writeFileSync(STOCK_FILE, JSON.stringify({ stockM: amountM }, null, 2)); } catch (err) {}
}

function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) return {};
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (err) { return {}; }
}

function saveConfig(data) {
    try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2)); } catch (err) {}
}

let currentStockM = loadStock();
let config = loadConfig();

function formatStock(moneyM) {
    if (moneyM <= 0) return '🔴 HẾT HÀNG (0M$)';
    if (moneyM >= 1000) return `${(moneyM / 1000).toFixed(2)}B$ (${moneyM.toLocaleString('vi-VN')}M$)`;
    return `${moneyM.toLocaleString('vi-VN')}M$`;
}

function parseCardValue(inputStr) {
    if (!inputStr) return 0;
    const str = inputStr.toString().trim().toLowerCase().replace(/,/g, '').replace(/\./g, '');
    if (str.includes('k')) {
        const val = parseFloat(str.replace(/[^0-9.]/g, ''));
        return isNaN(val) ? 0 : val * 1000;
    } else {
        const val = parseFloat(str.replace(/[^0-9.]/g, ''));
        return isNaN(val) ? 0 : val;
    }
}

function parseMoneyToM(inputStr) {
    if (!inputStr) return 0;
    const str = inputStr.toString().trim().toLowerCase().replace(/,/g, '');
    if (str.endsWith('b')) return (parseFloat(str) || 0) * 1000;
    if (str.endsWith('m')) return parseFloat(str) || 0;
    if (str.endsWith('k')) return (parseFloat(str) || 0) / 1000;
    const val = parseFloat(str);
    if (isNaN(val)) return 0;
    return val >= 10000 ? val / 1000000 : val;
}

// ==================== EMBED PHÂN LUỒNG ====================
function buildAutoBuyEmbed() {
    const isOutOfStock = currentStockM <= 0;
    const stockText = formatStock(currentStockM);

    const embed = new EmbedBuilder()
        .setColor(isOutOfStock ? '#e74c3c' : '#2ecc71')
        .setTitle('🛒 HỆ THỐNG AUTO BUY MONEY KINGSMP')
        .setDescription(
            `🟢 **Trạng thái:** ${isOutOfStock ? '🔴 **ĐÃ ĐÓNG BOT (HẾT KHO)**' : 'Hoạt động 24/7'}\n` +
            `💸 **Tỷ giá chung:** \`${RATE} VNĐ = 1M$\`\n` +
            '🎟️ **Chiết khấu thẻ cào:** `Trừ 20% mệnh giá thẻ`\n' +
            `📦 **Kho hiện tại (Stock):** \`${stockText}\`\n\n` +
            (isOutOfStock ? '⚠️ **Hiện tại kho đã hết Money. Vui lòng chờ Admin cập nhật thêm Stock!**' : '💰 Chọn phương thức mua bên dưới:')
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
    if (!config.channelId || !config.messageId) return;
    try {
        const channel = await client.channels.fetch(config.channelId);
        if (channel) {
            const message = await channel.messages.fetch(config.messageId);
            if (message) await message.edit(buildAutoBuyEmbed());
        }
    } catch (e) { console.error('Lỗi cập nhật Panel:', e.message); }
}

// ==================== SLASH COMMANDS DEFINITION ====================
const commands = [
    new SlashCommandBuilder().setName('setup').setDescription('Thiết lập Bảng AutoBuy cố định vào kênh này'),
    new SlashCommandBuilder().setName('setstock').setDescription('Cập nhật số lượng kho Money').addStringOption(opt => opt.setName('amount').setDescription('Ví dụ: 10b, 500m...').setRequired(true))
];

// ==================== EVENT: READY ====================
client.once('ready', async (c) => {
    console.log(`🤖 Bot đã online thành công với tên: ${c.user.tag}`);
    
    // Đăng ký Slash Commands sau khi đã sẵn sàng
    const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
    const clientId = process.env.CLIENT_ID || process.env.APPLICATION_ID;

    if (token && clientId) {
        const rest = new REST({ version: '10' }).setToken(token);
        try {
            console.log('🔄 Đang đăng ký Slash Commands...');
            if (process.env.GUILD_ID) {
                await rest.put(Routes.applicationGuildCommands(clientId, process.env.GUILD_ID), { body: commands });
            } else {
                await rest.put(Routes.applicationCommands(clientId), { body: commands });
            }
            console.log('✅ Đã đăng ký Slash Commands thành công!');
        } catch (error) {
            console.error('❌ Lỗi đăng ký Slash Commands:', error);
        }
    } else {
        console.error('⚠️ Thiếu DISCORD_TOKEN hoặc CLIENT_ID trong Environment Variables!');
    }

    await updateAutoBuyPanel();
});

// ==================== SỰ KIỆN MESSAGE CREATE ====================
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const allowedChannelIds = [
        process.env.CHAT_CHUNG_CHANNEL_ID,
        process.env.BLACK_MARKET_CHANNEL_ID
    ].filter(Boolean);

    const allowedChannelNames = ['chat-chung', 'black-market', 'blackmarket'];

    const isAllowedChannel = allowedChannelIds.includes(message.channelId) || 
                             allowedChannelNames.includes(message.channel.name?.toLowerCase());

    if (!isAllowedChannel) return;

    const contentLower = message.content.toLowerCase();
    if (contentLower.includes('sell') || contentLower.includes('stock')) {
        const stockText = formatStock(currentStockM);
        const autoBuyChannelText = config.channelId ? ` tại kênh <#${config.channelId}>` : '';

        const replyEmbed = new EmbedBuilder()
            .setColor('#3498db')
            .setTitle('📦 THÔNG TIN KHO MONEY KINGSMP')
            .setDescription(
                `📦 **Stock hiện tại:** \`${stockText}\`\n` +
                `💸 **Tỷ giá:** \`${RATE} VNĐ = 1M$\` (Thẻ cào trừ 20%)\n\n` +
                `👉 Bạn có thể bấm mua trực tiếp${autoBuyChannelText}!`
            )
            .setTimestamp();

        try {
            await message.channel.send({ embeds: [replyEmbed] });
        } catch (e) {
            console.error('Lỗi gửi tin nhắn tự động từ khóa:', e.message);
        }
    }
});

// ==================== INTERACTION CREATE ====================
client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'setup') {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return await interaction.reply({ content: '❌ Bạn không có quyền Administrator!', flags: MessageFlags.Ephemeral });
                }
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                try {
                    const panel = buildAutoBuyEmbed();
                    const msg = await interaction.channel.send(panel);
                    config.channelId = interaction.channelId;
                    config.messageId = msg.id;
                    saveConfig(config);
                    return await interaction.editReply({ content: '✅ Đã thiết lập Bảng AutoBuy cố định thành công!' });
                } catch (err) {
                    return await interaction.editReply({ content: `❌ Lỗi: \`${err.message}\`` });
                }
            }

            if (interaction.commandName === 'setstock') {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return await interaction.reply({ content: '❌ Bạn không có quyền Administrator!', flags: MessageFlags.Ephemeral });
                }
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                try {
                    const amountInput = interaction.options.getString('amount');
                    currentStockM = parseMoneyToM(amountInput);
                    saveStock(currentStockM);
                    await updateAutoBuyPanel();
                    return await interaction.editReply({ content: `✅ Kho hiện tại: **${formatStock(currentStockM)}**` });
                } catch (err) {
                    return await interaction.editReply({ content: `❌ Thất bại: \`${err.message}\`` });
                }
            }
        }

        if (interaction.isButton()) {
            const isAdminId = process.env.ADMIN_DISCORD_ID && interaction.user.id === process.env.ADMIN_DISCORD_ID;
            const hasAdminPerm = interaction.memberPermissions && interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator);

            if (interaction.customId === 'close_ticket') {
                if (!isAdminId && !hasAdminPerm) {
                    return await interaction.reply({ content: '❌ **Chỉ Admin mới có quyền đóng Ticket này!**', flags: MessageFlags.Ephemeral });
                }
                await interaction.reply('🔒 **Kênh Ticket sẽ tự động xóa sau 5 giây...**');
                setTimeout(() => {
                    interaction.channel.delete().catch(() => {});
                }, 5000);
                return;
            }

            if (interaction.customId.startsWith('app_') || interaction.customId.startsWith('rej_')) {
                if (!isAdminId && !hasAdminPerm) {
                    return await interaction.reply({
                        content: '❌ **Chỉ Admin mới có quyền duyệt hoặc từ chối đơn hàng này!**',
                        flags: MessageFlags.Ephemeral
                    });
                }

                await interaction.deferUpdate();

                const [action, userId, amountStr] = interaction.customId.split('_');
                const amountM = parseInt(amountStr, 10) || 0;
                const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0]);

                if (action === 'app') {
                    if (currentStockM < amountM) {
                        return await interaction.followUp({
                            content: `❌ Kho không đủ! Cần: **${amountM}M$**, Còn: **${formatStock(currentStockM)}**`,
                            flags: MessageFlags.Ephemeral
                        });
                    }

                    currentStockM -= amountM;
                    saveStock(currentStockM);
                    updateAutoBuyPanel().catch(() => {});

                    updatedEmbed.setColor('#2ecc71')
                        .setTitle('✅ ĐƠN ĐÃ ĐƯỢC DUYỆT')
                        .addFields({ name: '📌 Trạng thái', value: `✅ Duyệt bởi <@${interaction.user.id}>\n📉 Đã trừ **${amountM.toLocaleString('vi-VN')}M$**` });

                    const closeRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('done_app').setLabel('Đã Duyệt Đơn').setStyle(ButtonStyle.Success).setDisabled(true),
                        new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
                    );

                    await interaction.editReply({ embeds: [updatedEmbed], components: [closeRow] });

                    try {
                        const user = await interaction.client.users.fetch(userId);
                        if (user) await user.send(`🎉 **Đơn nạp của bạn đã được Admin duyệt thành công!**\n💰 Số Money nhận được: **${amountM.toLocaleString('vi-VN')}M$** Ingame.`);
                    } catch (e) {}

                    if (interaction.channel && (interaction.channel.name.startsWith('ticket-bank-') || interaction.channel.name.startsWith('ticket-card-'))) {
                        const legitChannelId = process.env.LEGIT_CHANNEL_ID || process.env.LOG_CHANNEL_ID;
                        const legitChannelText = legitChannelId ? ` tại <#${legitChannelId}>` : '';

                        await interaction.channel.send(
                            `✨ <@${userId}> **Giao dịch đã hoàn tất!** Vui lòng gửi đánh giá/legit${legitChannelText} để ủng hộ shop nhé.\n` +
                            `🔒 *Sau khi bạn đã gửi legit xong, Admin hoặc bạn có thể bấm nút **"Đóng Ticket"** bên trên để đóng kênh.*`
                        );
                    }
                } else if (action === 'rej') {
                    updatedEmbed.setColor('#e74c3c')
                        .setTitle('❌ ĐƠN TẠM BỊ TỪ CHỐI')
                        .addFields({ name: '📌 Trạng thái', value: `❌ Bị từ chối bởi <@${interaction.user.id}>\n💡 *Vui lòng kiểm tra lại thông tin đơn hàng/thẻ cào.*` });

                    const activeRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`app_${userId}_${amountStr}`).setLabel('Duyệt Lại Đơn (Trừ Stock)').setEmoji('✅').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
                    );

                    await interaction.editReply({ embeds: [updatedEmbed], components: [activeRow] });

                    try {
                        const user = await interaction.client.users.fetch(userId);
                        if (user) await user.send(`❌ **Đơn nạp của bạn đang bị từ chối/thẻ sai.** Vui lòng phản hồi trong Ticket để được Admin hỗ trợ!`);
                    } catch (e) {}

                    if (interaction.channel && (interaction.channel.name.startsWith('ticket-bank-') || interaction.channel.name.startsWith('ticket-card-'))) {
                        await interaction.channel.send('⚠️ **Đơn hàng chưa được duyệt.** Sau khi xử lý xong, Admin bấm **"Duyệt Lại Đơn"** hoặc bấm **"Đóng Ticket"** để xóa kênh.');
                    }
                }
                return;
            }

            if (currentStockM <= 0 && interaction.customId !== 'guide') {
                return await interaction.reply({ content: '🔴 **Hệ thống đang tạm HẾT KHO STOCK.**', flags: MessageFlags.Ephemeral });
            }

            if (interaction.customId === 'buy_bank') {
                const modal = new ModalBuilder().setCustomId('modal_bank').setTitle(`Mua Bằng Ngân Hàng (Rate ${RATE}đ/1M)`);
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bank_name').setLabel('Tên Ingame:').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bank_vnd').setLabel('Số tiền nạp (VNĐ):').setStyle(TextInputStyle.Short).setPlaceholder('Ví dụ: 10k, 20k, 50k...').setRequired(true))
                );
                return await interaction.showModal(modal);
            } else if (interaction.customId === 'buy_card') {
                const modal = new ModalBuilder().setCustomId('modal_card').setTitle(`Nạp Thẻ Cào (CK 20% - Rate ${RATE}đ/1M)`);
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_ign').setLabel('Tên Ingame:').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_type').setLabel('Loại thẻ:').setStyle(TextInputStyle.Short).setPlaceholder('Viettel, Zing...').setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_val').setLabel('Mệnh giá thẻ:').setStyle(TextInputStyle.Short).setPlaceholder('10k, 20k, 50k...').setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_code').setLabel('Mã thẻ (Pin):').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_seri').setLabel('Mã Seri:').setStyle(TextInputStyle.Short).setRequired(true))
                );
                return await interaction.showModal(modal);
            } else if (interaction.customId === 'calc_price') {
                const modal = new ModalBuilder().setCustomId('modal_calc').setTitle('Tính Tiền Money');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('calc_money').setLabel('Nhập số Money (b, m, k):').setStyle(TextInputStyle.Short).setRequired(true)));
                return await interaction.showModal(modal);
            } else if (interaction.customId === 'guide') {
                return await interaction.reply({
                    content: `📖 **Hướng Dẫn Mua Money KINGSMP:**\n• Rate: **${RATE} VNĐ = 1M$**\n• Thẻ cào trừ 20% phí gạch thẻ.\n• Kho hiện tại: \`${formatStock(currentStockM)}\``,
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'modal_bank') {
                const ign = interaction.fields.getTextInputValue('bank_name').trim();
                const rawVnd = interaction.fields.getTextInputValue('bank_vnd');
                const vndAmount = Math.floor(parseCardValue(rawVnd));
                const moneyReceivedM = vndAmount > 0 ? Math.floor(vndAmount / RATE) : 0;

                if (vndAmount < 1000) {
                    return await interaction.reply({ content: '❌ Số tiền không hợp lệ! Vui lòng nhập từ 1.000 VNĐ trở lên.', flags: MessageFlags.Ephemeral });
                }

                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const memo = `KSMP ${ign}`;
                const qrUrl = `https://img.vietqr.io/image/${BANK_CONFIG.BANK_ID}-${BANK_CONFIG.ACCOUNT_NO}-compact2.png?amount=${vndAmount}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(BANK_CONFIG.ACCOUNT_NAME)}`;

                try {
                    const ticketChannel = await interaction.guild.channels.create({
                        name: `ticket-bank-${ign.toLowerCase()}`,
                        type: ChannelType.GuildText,
                        permissionOverwrites: [
                            {
                                id: interaction.guild.id,
                                deny: [PermissionsBitField.Flags.ViewChannel]
                            },
                            {
                                id: interaction.user.id,
                                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles]
                            },
                            ...(process.env.ADMIN_DISCORD_ID ? [{
                                id: process.env.ADMIN_DISCORD_ID,
                                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels]
                            }] : [])
                        ]
                    });

                    const qrEmbed = new EmbedBuilder()
                        .setTitle('💳 THÔNG TIN CHUYỂN KHOẢN BANK')
                        .setColor('#3498db')
                        .setDescription(`Chào <@${interaction.user.id}>, vui lòng quét mã QR bên dưới để chuyển khoản.\n📸 **SAU KHI CHUYỂN TIỀN, VUI LÒNG GỬI ẢNH BILL VÀO KÊNH NÀY!**`)
                        .addFields(
                            { name: '👤 Ingame nhận Money', value: `\`${ign}\``, inline: true },
                            { name: '💰 Money sẽ nhận', value: `\`${moneyReceivedM.toLocaleString('vi-VN')}M$\``, inline: true },
                            { name: '💵 Số tiền cần chuyển', value: `\`${vndAmount.toLocaleString('vi-VN')} VNĐ\``, inline: true },
                            { name: '🏦 Ngân hàng', value: `\`MBBANK\` - STK: \`${BANK_CONFIG.ACCOUNT_NO}\``, inline: false },
                            { name: '👤 Chủ tài khoản', value: `\`${BANK_CONFIG.ACCOUNT_NAME}\``, inline: false },
                            { name: '📌 Nội dung CK (BẮT BUỘC)', value: `\`\`\`${memo}\`\`\``, inline: false }
                        )
                        .setImage(qrUrl)
                        .setFooter({ text: 'Gửi ảnh chụp màn hình chuyển khoản thành công vào đây để Admin duyệt!' })
                        .setTimestamp();

                    const adminRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`app_${interaction.user.id}_${moneyReceivedM}`).setLabel('Duyệt Đơn (Trừ Stock)').setEmoji('✅').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`rej_${interaction.user.id}_${moneyReceivedM}`).setLabel('Từ Chối Đơn').setEmoji('❌').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
                    );

                    await ticketChannel.send({ content: `<@${interaction.user.id}>`, embeds: [qrEmbed], components: [adminRow] });

                    return await interaction.editReply({
                        content: `✅ **ĐÃ TẠO KÊNH NẠP BANK THÀNH CÔNG!**\n👉 Vui lòng vào kênh <#${ticketChannel.id}> để lấy mã QR và **gửi ảnh Bill**!`
                    });

                } catch (e) {
                    console.error('Lỗi tạo kênh Ticket Bank:', e);
                    return await interaction.editReply({
                        content: `❌ Không thể tạo kênh Ticket: \`${e.message}\`. Vui lòng kiểm tra quyền **Manage Channels** của Bot!`
                    });
                }
            } else if (interaction.customId === 'modal_card') {
                const ign = interaction.fields.getTextInputValue('card_ign').trim();
                const type = interaction.fields.getTextInputValue('card_type');
                const val = interaction.fields.getTextInputValue('card_val');
                const code = interaction.fields.getTextInputValue('card_code');
                const seri = interaction.fields.getTextInputValue('card_seri');

                const cardValueVnd = Math.floor(parseCardValue(val));
                const netVnd = Math.floor(cardValueVnd * 0.8);
                const moneyReceivedM = netVnd > 0 ? Math.floor(netVnd / RATE) : 0;

                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                try {
                    const ticketChannel = await interaction.guild.channels.create({
                        name: `ticket-card-${ign.toLowerCase()}`,
                        type: ChannelType.GuildText,
                        permissionOverwrites: [
                            {
                                id: interaction.guild.id,
                                deny: [PermissionsBitField.Flags.ViewChannel]
                            },
                            {
                                id: interaction.user.id,
                                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles]
                            },
                            ...(process.env.ADMIN_DISCORD_ID ? [{
                                id: process.env.ADMIN_DISCORD_ID,
                                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels]
                            }] : [])
                        ]
                    });

                    const cardEmbed = new EmbedBuilder()
                        .setTitle('🎟️ THÔNG TIN ĐƠN NẠP THẺ CÀO')
                        .setColor('#f1c40f')
                        .setDescription(`Chào <@${interaction.user.id}>, đơn nạp thẻ của bạn đã được ghi nhận.\n⏳ **Vui lòng chờ Admin kiểm tra và gạch thẻ!**`)
                        .addFields(
                            { name: '👤 Ingame nhận Money', value: `\`${ign}\``, inline: true },
                            { name: '💳 Loại thẻ', value: `\`${type}\``, inline: true },
                            { name: '💵 Mệnh giá', value: `\`${cardValueVnd.toLocaleString('vi-VN')} VNĐ\``, inline: true },
                            { name: '💰 Money quy đổi', value: `\`${moneyReceivedM.toLocaleString('vi-VN')}M$\``, inline: true },
                            { name: '🔑 Mã thẻ (Pin)', value: `\`\`\`${code}\`\`\``, inline: false },
                            { name: '🔢 Mã Seri', value: `\`\`\`${seri}\`\`\``, inline: false }
                        )
                        .setTimestamp();

                    const adminRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`app_${interaction.user.id}_${moneyReceivedM}`).setLabel('Duyệt Thẻ (Trừ Stock)').setEmoji('✅').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`rej_${interaction.user.id}_${moneyReceivedM}`).setLabel('Từ Chối Thẻ').setEmoji('❌').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
                    );

                    await ticketChannel.send({ content: `<@${interaction.user.id}>`, embeds: [cardEmbed], components: [adminRow] });

                    if (process.env.LOG_CHANNEL_ID) {
                        interaction.client.channels.fetch(process.env.LOG_CHANNEL_ID)
                            .then(ch => ch && ch.send({ content: `🎟️ Có đơn nạp thẻ cào mới tại ticket <#${ticketChannel.id}>`, embeds: [cardEmbed] }))
                            .catch(err => console.error('Lỗi log card:', err.message));
                    }

                    return await interaction.editReply({
                        content: `✅ **ĐÃ TẠO TICKET NẠP THẺ CÀO THÀNH CÔNG!**\n👉 Vui lòng vào kênh <#${ticketChannel.id}> để theo dõi tiến độ duyệt đơn!`
                    });

                } catch (e) {
                    console.error('Lỗi tạo kênh Ticket Card:', e);
                    return await interaction.editReply({
                        content: `❌ Không thể tạo kênh Ticket: \`${e.message}\`. Vui lòng kiểm tra quyền **Manage Channels** của Bot!`
                    });
                }
            } else if (interaction.customId === 'modal_calc') {
                const rawInput = interaction.fields.getTextInputValue('calc_money');
                const moneyM = parseMoneyToM(rawInput);
                const priceBankVnd = Math.round(moneyM * RATE);
                const requiredCardVnd = Math.round(priceBankVnd / 0.8);

                return await interaction.reply({
                    content: `🧮 **BẢNG TÍNH GIÁ MONEY**\n• Mua: \`${rawInput}\` $\rightarrow$ \`${moneyM}M$\`\n💵 Thanh toán Bank: \`${priceBankVnd.toLocaleString('vi-VN')} VNĐ\`\n🎟️ Thẻ cào nạp (-20%): \`${requiredCardVnd.toLocaleString('vi-VN')} VNĐ\``,
                    flags: MessageFlags.Ephemeral
                });
            }
        }
    } catch (err) {
        console.error('❌ Lỗi Xử Lý Interaction:', err);
    }
});

// ==================== ĐĂNG NHẬP BOT ====================
const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
if (token) {
    client.login(token);
} else {
    console.error('❌ LỖI: Không tìm thấy Token trong biến môi trường!');
}
