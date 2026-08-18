const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
    PermissionsBitField,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

// ============================================================
// 1. INITIALIZATION & CONFIGURATION
// ============================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
});

const CONFIG_FILE = path.join(__dirname, 'config.json');
const STOCK_FILE = path.join(__dirname, 'stock.json');
const ACCS_FILE = path.join(__dirname, 'accounts.json');
const ORDERS_FILE = path.join(__dirname, 'orders.json');

const DEFAULT_CONFIG = {
    token: "YOUR_BOT_TOKEN_HERE",
    adminRoleId: "",
    buyerRoleId: "",
    logChannelId: "",
    ticketCategoryId: "",
    panelChannelId: "",
    panelMessageId: "",
    ratePerK: 10000,
    bankInfo: "STK: 123456789 - MBBank - NGUYEN VAN A",
};

// ============================================================
// 2. SAFE JSON HELPERS (FIXED ATOMIC WRITE & ATOMIC READ)
// ============================================================

function readJson(file, defaultValue = {}) {
    try {
        if (!fs.existsSync(file)) {
            writeJson(file, defaultValue);
            return defaultValue;
        }
        const data = fs.readFileSync(file, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error(`Lỗi đọc file ${file}:`, err.message);
        return defaultValue;
    }
}

function writeJson(file, data) {
    const tempFile = `${file}.tmp`;
    try {
        fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tempFile, file);
        return true;
    } catch (err) {
        console.error(`Lỗi ghi file ${file}:`, err.message);
        if (fs.existsSync(tempFile)) {
            try { fs.unlinkSync(tempFile); } catch (e) {}
        }
        return false;
    }
}

// Load Initial Data
let config = { ...DEFAULT_CONFIG, ...readJson(CONFIG_FILE, DEFAULT_CONFIG) };
let stockData = readJson(STOCK_FILE, { stockM: 0 });
let accountsData = readJson(ACCS_FILE, []);
let ordersData = readJson(ORDERS_FILE, {});

function saveConfig() { writeJson(CONFIG_FILE, config); }
function saveStock(val) { 
    stockData.stockM = Math.max(0, Math.round(val * 1000) / 1000); 
    writeJson(STOCK_FILE, stockData); 
}
function saveAccounts() { writeJson(ACCS_FILE, accountsData); }
function saveOrders() { writeJson(ORDERS_FILE, ordersData); }

// ============================================================
// 3. INTERACTION LOCK & SAFE REPLIES
// ============================================================

const seenInteractions = new Set();

function claimInteraction(interactionId) {
    if (seenInteractions.has(interactionId)) return false;
    seenInteractions.add(interactionId);
    setTimeout(() => seenInteractions.delete(interactionId), 60000);
    return true;
}

async function safeDeferReply(interaction, ephemeral = true) {
    if (interaction.deferred || interaction.replied) return;
    try {
        await interaction.deferReply({ ephemeral });
    } catch (err) {
        if (err.code !== 40060) console.error("Lỗi safeDeferReply:", err.message);
    }
}

async function safeDeferUpdate(interaction) {
    if (interaction.deferred || interaction.replied) return;
    try {
        await interaction.deferUpdate();
    } catch (err) {
        if (err.code !== 40060) console.error("Lỗi safeDeferUpdate:", err.message);
    }
}

async function safeReply(interaction, options) {
    try {
        if (interaction.deferred || interaction.replied) {
            return await interaction.followUp(options);
        }
        return await interaction.reply(options);
    } catch (err) {
        console.error("Lỗi safeReply:", err.message);
    }
}

// ============================================================
// 4. EMBEDS & PANELS
// ============================================================

function buildPanelEmbed() {
    const availableAccs = accountsData.filter(a => !a.sold).length;
    return new EmbedBuilder()
        .setTitle("🛒 DỊCH VỤ MUA BÁN MONEY & ACCOUNT")
        .setColor(0x00FF88)
        .setDescription("Lựa chọn dịch vụ bên dưới để khởi tạo giao dịch tự động.")
        .addFields(
            { name: "💵 Stock Money", value: `**${stockData.stockM.toLocaleString('vi-VN')} M**`, inline: true },
            { name: "🏷️ Tỷ Giá", value: `**${config.ratePerK.toLocaleString('vi-VN')} VNĐ / 1M**`, inline: true },
            { name: "📦 Account Sẵn Có", value: `**${availableAccs} Acc**`, inline: true }
        )
        .setFooter({ text: "Hệ thống giao dịch tự động 24/7" })
        .setTimestamp();
}

function buildPanelButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_buy_money').setLabel('Buy Money').setStyle(ButtonStyle.Success).setEmoji('💵'),
        new ButtonBuilder().setCustomId('btn_buy_acc').setLabel('Buy Account').setStyle(ButtonStyle.Primary).setEmoji('🎮')
    );
}

async function updateAutoBuyPanel() {
    if (!config.panelChannelId) return;
    try {
        const channel = await client.channels.fetch(config.panelChannelId).catch(() => null);
        if (!channel) return;

        const embed = buildPanelEmbed();
        const components = [buildPanelButtons()];

        if (config.panelMessageId) {
            const msg = await channel.messages.fetch(config.panelMessageId).catch(() => null);
            if (msg) {
                await msg.edit({ embeds: [embed], components });
                return;
            }
        }

        const newMsg = await channel.send({ embeds: [embed], components });
        config.panelMessageId = newMsg.id;
        saveConfig();
    } catch (err) {
        console.error("Lỗi cập nhật Panel:", err.message);
    }
}

// ============================================================
// 5. TICKET MANAGEMENT
// ============================================================

async function createTicketChannel(guild, user, type) {
    const channelName = `${type}-${user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
    
    const permissionOverwrites = [
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
        { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
    ];

    if (config.adminRoleId) {
        permissionOverwrites.push({
            id: config.adminRoleId,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
        });
    }

    return await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: config.ticketCategoryId || null,
        permissionOverwrites
    });
}

// ============================================================
// 6. EVENT HANDLERS
// ============================================================

client.on('ready', () => {
    console.log(`Bot đã đăng nhập thành công với tên: ${client.user.tag}`);
    updateAutoBuyPanel();
});

client.on('interactionCreate', async (interaction) => {
    if (!claimInteraction(interaction.id)) return;

    try {
        if (interaction.isButton()) {
            await handleButtonInteraction(interaction);
        } else if (interaction.isModalSubmit()) {
            await handleModalInteraction(interaction);
        }
    } catch (err) {
        console.error("Lỗi xử lý interaction:", err);
        await safeReply(interaction, { content: "❌ Có lỗi xảy ra trong quá trình xử lý!", ephemeral: true });
    }
});

// ============================================================
// 7. BUTTON ROUTER
// ============================================================

async function handleButtonInteraction(interaction) {
    const { customId } = interaction;

    if (customId === 'btn_buy_money') {
        const modal = new ModalBuilder()
            .setCustomId('modal_buy_money')
            .setTitle('Mua Money');
        const inputAmount = new TextInputBuilder()
            .setCustomId('money_amount')
            .setLabel('Số lượng Money muốn mua (M)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ví dụ: 100')
            .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(inputAmount));
        await interaction.showModal(modal);
    } 
    else if (customId === 'btn_buy_acc') {
        await handleAccList(interaction);
    } 
    else if (customId.startsWith('buy_acc_')) {
        await handleAccButton(interaction);
    } 
    else if (customId.startsWith('approve_money_') || customId.startsWith('reject_money_')) {
        await handleMoneyApproval(interaction);
    } 
    else if (customId.startsWith('approve_acc_') || customId.startsWith('reject_acc_')) {
        await handleAccApproval(interaction);
    } 
    else if (customId.startsWith('close_ticket_')) {
        await safeDeferUpdate(interaction);
        await interaction.channel.delete().catch(() => null);
    }
}

// ============================================================
// 8. MODAL SUBMIT HANDLER (MONEY)
// ============================================================

async function handleModalInteraction(interaction) {
    if (interaction.customId === 'modal_buy_money') {
        await safeDeferReply(interaction, true);
        
        const amountStr = interaction.fields.getTextInputValue('money_amount');
        const amountM = parseFloat(amountStr);

        if (isNaN(amountM) || amountM <= 0) {
            return await safeReply(interaction, { content: "❌ Số lượng không hợp lệ!", ephemeral: true });
        }

        if (amountM > stockData.stockM) {
            return await safeReply(interaction, { content: `❌ Stock hiện tại không đủ! Chỉ còn ${stockData.stockM}M.`, ephemeral: true });
        }

        const totalPrice = amountM * config.ratePerK;
        const ticketChannel = await createTicketChannel(interaction.guild, interaction.user, 'money');

        const orderId = `MONEY_${Date.now()}`;
        ordersData[orderId] = {
            id: orderId,
            userId: interaction.user.id,
            amountM,
            totalPrice,
            status: 'PENDING'
        };
        saveOrders();

        const embed = new EmbedBuilder()
            .setTitle("📄 THÔNG TIN ĐƠN HÀNG MONEY")
            .setColor(0xFFFF00)
            .addFields(
                { name: "Khách hàng", value: `<@${interaction.user.id}>`, inline: true },
                { name: "Số lượng", value: `${amountM} M`, inline: true },
                { name: "Tổng tiền", value: `**${totalPrice.toLocaleString('vi-VN')} VNĐ**`, inline: true },
                { name: "Thông tin chuyển khoản", value: config.bankInfo }
            )
            .setFooter({ text: "Vui lòng chuyển khoản đúng số tiền và chờ Admin xác nhận." });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`approve_money_${orderId}`).setLabel('Xác Nhận Đã Thanh Toán').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`reject_money_${orderId}`).setLabel('Hủy Đơn').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`close_ticket_${orderId}`).setLabel('Đóng Ticket').setStyle(ButtonStyle.Secondary)
        );

        await ticketChannel.send({ content: `<@${interaction.user.id}> | <@&${config.adminRoleId}>`, embeds: [embed], components: [row] });
        await safeReply(interaction, { content: `✅ Đã tạo Ticket mua Money tại: ${ticketChannel}`, ephemeral: true });
    }
}

// ============================================================
// 9. ACCOUNT BUY HANDLER
// ============================================================

async function handleAccList(interaction) {
    await safeDeferReply(interaction, true);

    const availableAccs = accountsData.filter(a => !a.sold);
    if (availableAccs.length === 0) {
        return await safeReply(interaction, { content: "❌ Hiện tại không có Account nào sẵn có!", ephemeral: true });
    }

    const embed = new EmbedBuilder()
        .setTitle("🎮 DANH SÁCH ACCOUNT HIỆN CÓ")
        .setColor(0x0099FF);

    const row = new ActionRowBuilder();

    availableAccs.slice(0, 5).forEach((acc, idx) => {
        embed.addFields({
            name: `ID: ${acc.id} - Giá: ${acc.price.toLocaleString('vi-VN')} VNĐ`,
            value: `${acc.details || 'Không có mô tả'}`
        });
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`buy_acc_${acc.id}`)
                .setLabel(`Mua ID ${acc.id}`)
                .setStyle(ButtonStyle.Primary)
        );
    });

    await safeReply(interaction, { embeds: [embed], components: [row], ephemeral: true });
}

async function handleAccButton(interaction) {
    await safeDeferReply(interaction, true);
    const accId = interaction.customId.replace('buy_acc_', '');
    const acc = accountsData.find(a => String(a.id) === String(accId) && !a.sold);

    if (!acc) {
        return await safeReply(interaction, { content: "❌ Account này không còn tồn tại hoặc đã được bán!", ephemeral: true });
    }

    const ticketChannel = await createTicketChannel(interaction.guild, interaction.user, 'acc');

    const orderId = `ACC_${Date.now()}`;
    ordersData[orderId] = {
        id: orderId,
        userId: interaction.user.id,
        accId: acc.id,
        totalPrice: acc.price,
        status: 'PENDING'
    };
    saveOrders();

    const embed = new EmbedBuilder()
        .setTitle("📄 THÔNG TIN ĐƠN HÀNG ACCOUNT")
        .setColor(0xFFFF00)
        .addFields(
            { name: "Khách hàng", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Mã Account", value: `${acc.id}`, inline: true },
            { name: "Tổng tiền", value: `**${acc.price.toLocaleString('vi-VN')} VNĐ**`, inline: true },
            { name: "Thông tin chuyển khoản", value: config.bankInfo }
        );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`approve_acc_${orderId}`).setLabel('Xác Nhận Đã Thanh Toán').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`reject_acc_${orderId}`).setLabel('Hủy Đơn').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`close_ticket_${orderId}`).setLabel('Đóng Ticket').setStyle(ButtonStyle.Secondary)
    );

    await ticketChannel.send({ content: `<@${interaction.user.id}> | <@&${config.adminRoleId}>`, embeds: [embed], components: [row] });
    await safeReply(interaction, { content: `✅ Đã tạo Ticket mua Account tại: ${ticketChannel}`, ephemeral: true });
}

// ============================================================
// 10. APPROVAL HANDLERS (ADMIN)
// ============================================================

async function handleMoneyApproval(interaction) {
    await safeDeferUpdate(interaction);
    const isApprove = interaction.customId.startsWith('approve_money_');
    const orderId = interaction.customId.replace(isApprove ? 'approve_money_' : 'reject_money_', '');
    const order = ordersData[orderId];

    if (!order || order.status !== 'PENDING') {
        return await interaction.channel.send({ content: "❌ Đơn hàng không tồn tại hoặc đã được xử lý từ trước!" });
    }

    if (isApprove) {
        if (stockData.stockM < order.amountM) {
            return await interaction.channel.send({ content: "❌ Stock không đủ để hoàn tất đơn hàng này!" });
        }

        // Trừ Stock đúng 1 lần và bảo toàn số thực
        saveStock(stockData.stockM - order.amountM);
        order.status = 'COMPLETED';
        saveOrders();

        await updateAutoBuyPanel();

        const embed = new EmbedBuilder()
            .setTitle("✅ GIAO DỊCH THÀNH CÔNG")
            .setColor(0x00FF00)
            .setDescription(`Đã xác nhận giao dịch thành công cho <@${order.userId}>!`)
            .addFields({ name: "Số lượng đã nhận", value: `${order.amountM} M` });

        await interaction.channel.send({ embeds: [embed] });
    } else {
        order.status = 'REJECTED';
        saveOrders();
        await interaction.channel.send({ content: "❌ Đơn hàng đã bị hủy bỏ." });
    }
}

async function handleAccApproval(interaction) {
    await safeDeferUpdate(interaction);
    const isApprove = interaction.customId.startsWith('approve_acc_');
    const orderId = interaction.customId.replace(isApprove ? 'approve_acc_' : 'reject_acc_', '');
    const order = ordersData[orderId];

    if (!order || order.status !== 'PENDING') {
        return await interaction.channel.send({ content: "❌ Đơn hàng không tồn tại hoặc đã được xử lý từ trước!" });
    }

    const acc = accountsData.find(a => String(a.id) === String(order.accId));

    if (isApprove) {
        if (!acc || acc.sold) {
            return await interaction.channel.send({ content: "❌ Account đã bị bán hoặc không tồn tại!" });
        }

        acc.sold = true;
        saveAccounts();

        order.status = 'COMPLETED';
        saveOrders();

        await updateAutoBuyPanel();

        const embed = new EmbedBuilder()
            .setTitle("✅ BÀN GIAO ACCOUNT THÀNH CÔNG")
            .setColor(0x00FF00)
            .addFields(
                { name: "Tài khoản / Thông tin", value: `\`\`\`${acc.credentials || 'Không có thông tin credentials'}\`\`\`` }
            );

        await interaction.channel.send({ content: `<@${order.userId}>`, embeds: [embed] });
    } else {
        order.status = 'REJECTED';
        saveOrders();
        await interaction.channel.send({ content: "❌ Đơn hàng đã bị hủy bỏ." });
    }
}

// ============================================================
// 11. LOGIN
// ============================================================

client.login(config.token);
