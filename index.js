const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder,
    PermissionFlagsBits,
    REST,
    Routes,
    SlashCommandBuilder,
    MessageFlags,
    ChannelType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

require('dotenv').config(); // Thêm dòng này nếu bạn dùng file .env để chứa TOKEN

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ==========================================
// ⚙️ CẤU HÌNH THÔNG TIN SERVER CỦA BẠN
// ==========================================
const serverConfig = {
    adminRoleId: "ID_ROLE_ADMIN_CUA_BAN",         // ĐIỀN ID ROLE ADMIN VÀO ĐÂY (Vd: "123456789012345678")
    ticketCategoryId: "ID_CATEGORY_TICKET_CUA_BAN", // ĐIỀN ID DANH MỤC CHỨA TICKET VÀO ĐÂY (Vd: "987654321098765432")
    qrImageUrl: "https://link-den-anh-qr-cua-ban.com/qr.jpg" // ĐIỀN LINK ẢNH QR THANH TOÁN CỦA BẠN VÀO ĐÂY
};

// ==========================================
// 📦 CẤU HÌNH CỬA HÀNG (SPAWNERS)
// ==========================================
const spawnerConfig = {
    ske: { name: "Skeleton Spawner", price: 50000, stock: 10, emoji: "💀" },
    blaze: { name: "Blaze Spawner", price: 150000, stock: 5, emoji: "🔥" },
    creeper: { name: "Creeper Spawner", price: 100000, stock: 8, emoji: "💥" },
    golem: { name: "Iron Golem Spawner", price: 300000, stock: 3, emoji: "🤖" }
};

// Hàm xử lý deferReply an toàn (Dùng cho các tương tác KHÔNG hiển thị Modal)
async function safeDeferReply(interaction, options) {
    try {
        if (interaction.deferred || interaction.replied) return true;
        await interaction.deferReply(options);
        return true;
    } catch (error) {
        console.error("Lỗi khi defer reply:", error);
        return false;
    }
}

// Hàm tạo giao diện Bảng Cửa hàng (Embed)
function createShopEmbed() {
    const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('🛒 HỆ THỐNG CỬA HÀNG SPAWNER')
        .setDescription('Chào mừng bạn đến với cửa hàng! Nhấn vào các nút bên dưới để tiến hành mua hàng.')
        .setTimestamp();

    Object.keys(spawnerConfig).forEach(key => {
        const item = spawnerConfig[key];
        embed.addFields({
            name: `${item.emoji} ${item.name}`,
            value: `💰 Giá: **${item.price.toLocaleString('vi-VN')} VNĐ**\n📦 Còn lại: \`${item.stock}\` cái`,
            inline: false
        });
    });

    return embed;
}

// Hàm tạo các nút bấm cửa hàng
function createShopButtons() {
    const row = new ActionRowBuilder();
    Object.keys(spawnerConfig).forEach(key => {
        const item = spawnerConfig[key];
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`buy_${key}`)
                .setLabel(`Mua ${item.name.split(' ')[0]}`)
                .setEmoji(item.emoji)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(item.stock <= 0) // Nút sẽ tự mờ đi nếu hết hàng
        );
    });
    return row;
}

// ==========================================
// 🚀 BOT KHỞI ĐỘNG & ĐĂNG KÝ LỆNH
// ==========================================
client.once('ready', async () => {
    console.log(`✅ Bot đã đăng nhập thành công với tên ${client.user.tag}!`);

    const rest = new REST({ version: '10' }).setToken(client.token);
    try {
        const commands = [
            new SlashCommandBuilder()
                .setName('shop')
                .setDescription('Mở bảng cửa hàng spawner cố định')
                .toJSON(),
            new SlashCommandBuilder()
                .setName('price')
                .setDescription('Thay đổi giá tiền của loại spawner (Chỉ Admin)')
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('Chọn loại spawner cần đổi giá')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Skeleton Spawner', value: 'ske' },
                            { name: 'Blaze Spawner', value: 'blaze' },
                            { name: 'Creeper Spawner', value: 'creeper' },
                            { name: 'Iron Golem Spawner', value: 'golem' }
                        ))
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('Giá tiền mới (tính bằng VNĐ)')
                        .setRequired(true))
                .toJSON()
        ];

        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('✅ Đã đăng ký thành công các lệnh /shop và /price lên Discord!');
    } catch (error) {
        console.error('❌ Lỗi khi đăng ký lệnh:', error);
    }
});

// ==========================================
// 🎧 BỘ XỬ LÝ TƯƠNG TÁC (TẤT CẢ SỰ KIỆN)
// ==========================================
client.on('interactionCreate', async (interaction) => {

    // ----------------------------------------
    // [1] LỆNH DẤU GẠCH CHÉO (/SHOP, /PRICE)
    // ----------------------------------------
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'shop') {
            await interaction.reply({
                embeds: [createShopEmbed()],
                components: [createShopButtons()]
            });
        }

        if (interaction.commandName === 'price') {
            const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;

            const type = interaction.options.getString('type');
            const newPrice = interaction.options.getInteger('amount');
            const spawner = spawnerConfig[type];

            if (!spawner) return interaction.editReply({ content: "❌ Loại spawner không tồn tại!" });

            const oldPrice = spawner.price;
            spawner.price = newPrice;

            await interaction.editReply({
                content: `✅ Đã cập nhật giá **${spawner.name}** từ **${oldPrice.toLocaleString('vi-VN')} VNĐ** thành **${newPrice.toLocaleString('vi-VN')} VNĐ**!\n*Vui lòng gõ lại lệnh /shop ở kênh công khai để cập nhật bảng mới.*`
            });
        }
    }

    // ----------------------------------------
    // [2] NÚT MUA HÀNG (MỞ BẢNG FORM CHO KHÁCH)
    // ----------------------------------------
    if (interaction.isButton() && interaction.customId.startsWith('buy_')) {
        const key = interaction.customId.replace('buy_', '');
        const spawner = spawnerConfig[key];

        if (!spawner || spawner.stock <= 0) {
            return interaction.reply({ content: `❌ Rất tiếc, loại spawner này hiện đang lỗi hoặc đã hết hàng!`, flags: MessageFlags.Ephemeral });
        }

        // Tạo Form điền thông tin
        const modal = new ModalBuilder()
            .setCustomId(`modal_buy_${key}`)
            .setTitle(`📝 Đơn mua ${spawner.name.split(' ')[0]}`);

        const ignInput = new TextInputBuilder()
            .setCustomId('ignInput')
            .setLabel('Tên trong game (IGN) của bạn:')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const quantityInput = new TextInputBuilder()
            .setCustomId('quantityInput')
            .setLabel(`Số lượng mua (Tối đa: ${spawner.stock}):`)
            .setStyle(TextInputStyle.Short)
            .setValue('1')
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(ignInput),
            new ActionRowBuilder().addComponents(quantityInput)
        );

        // HIỂN THỊ FORM (Không được deferReply trước khi showModal)
        await interaction.showModal(modal);
    }

    // ----------------------------------------
    // [3] XỬ LÝ KHÁCH GỬI FORM -> TẠO TICKET
    // ----------------------------------------
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_buy_')) {
        const key = interaction.customId.replace('modal_buy_', '');
        const spawner = spawnerConfig[key];

        const ign = interaction.fields.getTextInputValue('ignInput');
        const quantity = parseInt(interaction.fields.getTextInputValue('quantityInput'));

        // Kiểm tra logic số lượng nhập vào
        if (isNaN(quantity) || quantity <= 0) {
            return interaction.reply({ content: '❌ Số lượng không hợp lệ! Vui lòng nhập số nguyên dương.', flags: MessageFlags.Ephemeral });
        }
        if (quantity > spawner.stock) {
            return interaction.reply({ content: `❌ Trong kho hiện chỉ còn \`${spawner.stock}\` cái, không thể mua ${quantity} cái!`, flags: MessageFlags.Ephemeral });
        }

        // Defer trước khi tạo kênh mất nhiều thời gian
        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        try {
            // CẤU HÌNH QUYỀN TICKET ĐẢM BẢO RIÊNG TƯ TUYỆT ĐỐI
            const permissionOverwrites = [
                {
                    // Chặn mọi người (@everyone) thấy kênh
                    id: interaction.guild.id,
                    deny: [PermissionFlagsBits.ViewChannel],
                },
                {
                    // Cấp quyền cho Bot
                    id: client.user.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles],
                },
                {
                    // Cấp quyền cho người mua (Khách)
                    id: interaction.user.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory],
                }
            ];

            // Cấp quyền cho Admin (nếu cấu hình ID Role hợp lệ)
            if (serverConfig.adminRoleId !== "ID_ROLE_ADMIN_CUA_BAN") {
                permissionOverwrites.push({
                    id: serverConfig.adminRoleId,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels],
                });
            }

            // Tạo kênh Ticket
            const ticketChannel = await interaction.guild.channels.create({
                name: `don-hang-${ign.toLowerCase()}`,
                type: ChannelType.GuildText,
                parent: serverConfig.ticketCategoryId !== "ID_CATEGORY_TICKET_CUA_BAN" ? serverConfig.ticketCategoryId : null,
                permissionOverwrites: permissionOverwrites
            });

            // Tính tiền
            const totalPrice = spawner.price * quantity;

            // Thiết kế Bill & QR
            const ticketEmbed = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle(`🛒 ĐƠN HÀNG: ${spawner.name.toUpperCase()}`)
                .setDescription(`Chào bạn <@${interaction.user.id}>,\nCảm ơn bạn đã đặt hàng, dưới đây là thông tin đơn của bạn:\n\n👤 **Tên In-game (IGN):** \`${ign}\`\n📦 **Số lượng mua:** \`${quantity}\`\n💰 **TỔNG THANH TOÁN:** **${totalPrice.toLocaleString('vi-VN')} VNĐ**\n\n📸 **VUI LÒNG QUÉT MÃ QR, CHUYỂN KHOẢN VÀ GỬI ẢNH BILL VÀO KÊNH NÀY** để Admin kiểm tra!`)
                .setImage(serverConfig.qrImageUrl)
                .setFooter({ text: "Hệ thống bán Spawner tự động" })
                .setTimestamp();

            // Nút Admin xử lý (gắn key và số lượng để dễ xử lý)
            const ticketButtons = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`confirm_${key}_${quantity}`) 
                    .setLabel('✅ Xác nhận & Trừ kho')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('🔒 Đóng Ticket')
                    .setStyle(ButtonStyle.Danger)
            );

            // Gửi tin nhắn vào Ticket
            const adminPing = serverConfig.adminRoleId !== "ID_ROLE_ADMIN_CUA_BAN" ? `<@&${serverConfig.adminRoleId}>` : "Admin";
            await ticketChannel.send({
                content: `🔔 Khách: <@${interaction.user.id}> | ${adminPing}`,
                embeds: [ticketEmbed],
                components: [ticketButtons]
            });

            // Báo lại cho khách đã tạo thành công
            await interaction.editReply({
                content: `✅ Đơn hàng đã được tạo! Vui lòng truy cập kênh <#${ticketChannel.id}> để thanh toán.`
            });

        } catch (error) {
            console.error("Lỗi khi tạo ticket:", error);
            await interaction.editReply({ content: "❌ Đã xảy ra lỗi khi tạo Ticket. Kiểm tra lại quyền của Bot!" });
        }
    }

    // ----------------------------------------
    // [4] NÚT ADMIN TRONG TICKET
    // ----------------------------------------
    if (interaction.isButton() && interaction.customId.startsWith('confirm_')) {
        // Kiểm tra quyền Admin
        const hasAdminPerms = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        const hasAdminRole = serverConfig.adminRoleId !== "ID_ROLE_ADMIN_CUA_BAN" ? interaction.member.roles.cache.has(serverConfig.adminRoleId) : false;

        if (!hasAdminPerms && !hasAdminRole) {
            return interaction.reply({ content: '❌ Chỉ Quản trị viên mới có thể sử dụng nút này!', flags: MessageFlags.Ephemeral });
        }

        const parts = interaction.customId.split('_');
        const key = parts[1];
        const requestedQuantity = parts[2];

        // Mở Form để Admin chốt số lượng (Phòng hờ khách chuyển thiếu tiền, admin có thể sửa số)
        const modal = new ModalBuilder()
            .setCustomId(`modal_deduct_${key}`)
            .setTitle('Xác nhận giao hàng');

        const quantityInput = new TextInputBuilder()
            .setCustomId('quantityInput')
            .setLabel('Nhập số lượng thực tế giao:')
            .setStyle(TextInputStyle.Short)
            .setValue(requestedQuantity) 
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(quantityInput));
        
        await interaction.showModal(modal);
    }

    if (interaction.isButton() && interaction.customId === 'close_ticket') {
        const hasAdminPerms = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        const hasAdminRole = serverConfig.adminRoleId !== "ID_ROLE_ADMIN_CUA_BAN" ? interaction.member.roles.cache.has(serverConfig.adminRoleId) : false;

        if (!hasAdminPerms && !hasAdminRole) {
            return interaction.reply({ content: '❌ Chỉ Quản trị viên mới có thể đóng ticket!', flags: MessageFlags.Ephemeral });
        }

        await interaction.reply({ content: '🔒 Giao dịch hoàn tất. Kênh sẽ tự động xoá sau **5 giây**...' });
        setTimeout(() => {
            interaction.channel.delete().catch(e => console.error("Lỗi xóa kênh:", e));
        }, 5000);
    }

    // ----------------------------------------
    // [5] ADMIN GỬI FORM XÁC NHẬN -> TRỪ KHO
    // ----------------------------------------
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_deduct_')) {
        const key = interaction.customId.replace('modal_deduct_', '');
        const quantity = parseInt(interaction.fields.getTextInputValue('quantityInput'));
        const spawner = spawnerConfig[key];

        if (!spawner) return interaction.reply({ content: '❌ Loại spawner không tồn tại!', flags: MessageFlags.Ephemeral });
        if (isNaN(quantity) || quantity <= 0) return interaction.reply({ content: '❌ Số lượng xác nhận không hợp lệ!', flags: MessageFlags.Ephemeral });

        // Trừ kho
        spawner.stock -= quantity;

        // Báo kết quả vào kênh Ticket
        await interaction.reply({
            content: `🎉 **XÁC NHẬN GIAO DỊCH THÀNH CÔNG!**\nAdmin <@${interaction.user.id}> đã xác nhận giao **\`${quantity}\`x ${spawner.name}** cho khách hàng.\n📦 Kho loại này hiện tại còn lại: \`${spawner.stock}\` cái.`
        });
    }
});

client.login(process.env.TOKEN);
