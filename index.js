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
    adminRoleId: "ID_ROLE_ADMIN_CUA_BAN", // Thay ID Role Admin vào đây (để tag và cấp quyền trong ticket)
    ticketCategoryId: "ID_CATEGORY_TICKET_CUA_BAN", // Thay ID Category (Danh mục) bạn muốn chứa các kênh ticket
    qrImageUrl: "https://link-den-anh-qr-cua-ban.com/qr.jpg" // Link ảnh mã QR tài khoản ngân hàng của bạn
};

// Cấu hình 4 loại Spawner
const spawnerConfig = {
    ske: { name: "Skeleton Spawner", price: 50000, stock: 10, emoji: "💀" },
    blaze: { name: "Blaze Spawner", price: 150000, stock: 5, emoji: "🔥" },
    creeper: { name: "Creeper Spawner", price: 100000, stock: 8, emoji: "💥" },
    golem: { name: "Iron Golem Spawner", price: 300000, stock: 3, emoji: "🤖" }
};

// Hàm xử lý deferReply an toàn
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

// Hàm tạo Bảng Cửa hàng (Embed)
function createShopEmbed() {
    const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('🛒 HỆ THỐNG CỬA HÀNG SPAWNER')
        .setDescription('Chào mừng bạn đến với cửa hàng! Nhấn vào các nút bên dưới để mở Ticket mua hàng.')
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

// Hàm tạo các nút bấm mua hàng
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
                .setDisabled(item.stock <= 0) // Hết hàng thì mờ nút
        );
    });
    return row;
}

client.once('ready', async () => {
    console.log(`Bot đã đăng nhập thành công với tên ${client.user.tag}!`);

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
        console.log('✅ Đã đăng ký thành công các lệnh /shop và /price!');
    } catch (error) {
        console.error('❌ Lỗi khi đăng ký lệnh:', error);
    }
});

client.on('interactionCreate', async (interaction) => {

    // ==========================================
    // 1. XỬ LÝ LỆNH SLASH (DẤU GẠCH CHÉO)
    // ==========================================
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'shop') {
            // Hiển thị công khai shop để mọi người cùng thấy
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
                content: `✅ Đã cập nhật giá **${spawner.name}** từ **${oldPrice.toLocaleString('vi-VN')} VNĐ** thành **${newPrice.toLocaleString('vi-VN')} VNĐ**!\n*Gõ lại lệnh /shop để cập nhật bảng mới.*`
            });
        }
    }

    // ==========================================
    // 2. XỬ LÝ KHI BẤM NÚT "MUA" (TẠO TICKET)
    // ==========================================
    if (interaction.isButton() && interaction.customId.startsWith('buy_')) {
        const key = interaction.customId.replace('buy_', '');
        const spawner = spawnerConfig[key];

        if (!spawner || spawner.stock <= 0) {
            return interaction.reply({ content: `❌ Rất tiếc, loại spawner này hiện đang lỗi hoặc đã hết hàng!`, flags: MessageFlags.Ephemeral });
        }

        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        try {
            // Tạo kênh Ticket
            const ticketChannel = await interaction.guild.channels.create({
                name: `ticket-${interaction.user.username}`,
                type: ChannelType.GuildText,
                parent: serverConfig.ticketCategoryId !== "ID_CATEGORY_TICKET_CUA_BAN" ? serverConfig.ticketCategoryId : null,
                permissionOverwrites: [
                    {
                        id: interaction.guild.id, // @everyone không được xem
                        deny: [PermissionFlagsBits.ViewChannel],
                    },
                    {
                        id: interaction.user.id, // Khách hàng được xem và nhắn tin
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory],
                    },
                    {
                        id: serverConfig.adminRoleId !== "ID_ROLE_ADMIN_CUA_BAN" ? serverConfig.adminRoleId : interaction.guild.roles.everyone.id, // Admin được xem
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels],
                    }
                ]
            });

            // Embed nội dung yêu cầu khách điền thông tin
            const ticketEmbed = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle(`📝 ĐƠN YÊU CẦU MUA: ${spawner.name}`)
                .setDescription(`Chào bạn <@${interaction.user.id}>,\n\nVui lòng cung cấp các thông tin sau xuống kênh chat này:\n\`1.\` **Tên trong game (IGN) của bạn**\n\`2.\` **Số lượng muốn mua** (hoặc số tiền muốn chuyển)\n\n📸 **VUI LÒNG QUÉT MÃ QR BÊN DƯỚI ĐỂ THANH TOÁN VÀ GỬI ẢNH BILL VÀO ĐÂY**.\n\n💰 Đơn giá: **${spawner.price.toLocaleString('vi-VN')} VNĐ / cái**\n📦 Hiện còn: \`${spawner.stock}\` cái`)
                .setImage(serverConfig.qrImageUrl)
                .setFooter({ text: "Admin sẽ kiểm tra và phản hồi bạn sớm nhất!" })
                .setTimestamp();

            // Nút điều khiển cho Admin
            const ticketButtons = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`confirm_${key}`)
                    .setLabel('✅ Xác nhận & Trừ kho')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('🔒 Đóng Ticket')
                    .setStyle(ButtonStyle.Danger)
            );

            // Gửi tin nhắn vào ticket kèm tag
            await ticketChannel.send({
                content: `🔔 Khách hàng: <@${interaction.user.id}> | Quản trị viên: <@&${serverConfig.adminRoleId}>`,
                embeds: [ticketEmbed],
                components: [ticketButtons]
            });

            // Báo lại cho khách
            await interaction.editReply({
                content: `✅ Đã tạo ticket mua hàng thành công! Vui lòng truy cập kênh: <#${ticketChannel.id}> để hoàn tất thanh toán.`
            });

        } catch (error) {
            console.error("Lỗi khi tạo ticket:", error);
            await interaction.editReply({ content: "❌ Đã xảy ra lỗi khi tạo Ticket. Vui lòng kiểm tra lại quyền của Bot!" });
        }
    }

    // ==========================================
    // 3. XỬ LÝ NÚT TRONG TICKET (DÀNH CHO ADMIN)
    // ==========================================
    // Xác nhận và trừ kho
    if (interaction.isButton() && interaction.customId.startsWith('confirm_')) {
        // Kiểm tra quyền Admin (hoặc có Role Admin)
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && !interaction.member.roles.cache.has(serverConfig.adminRoleId)) {
            return interaction.reply({ content: '❌ Chỉ Admin mới có thể sử dụng nút này!', flags: MessageFlags.Ephemeral });
        }

        const key = interaction.customId.replace('confirm_', '');
        
        // Tạo bảng Modal (Form nhỏ) bật lên để Admin điền số lượng
        const modal = new ModalBuilder()
            .setCustomId(`modal_deduct_${key}`)
            .setTitle('Xác nhận giao hàng');

        const quantityInput = new TextInputBuilder()
            .setCustomId('quantityInput')
            .setLabel('Nhập số lượng khách đã mua:')
            .setStyle(TextInputStyle.Short)
            .setValue('1') // Mặc định là 1
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(quantityInput));
        
        // Bật Form lên cho Admin nhập
        await interaction.showModal(modal);
    }

    // Đóng Ticket
    if (interaction.isButton() && interaction.customId === 'close_ticket') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && !interaction.member.roles.cache.has(serverConfig.adminRoleId)) {
            return interaction.reply({ content: '❌ Chỉ Admin mới có thể đóng ticket!', flags: MessageFlags.Ephemeral });
        }

        await interaction.reply({ content: '🔒 Ticket sẽ tự động xóa sau **5 giây**...' });
        setTimeout(() => {
            interaction.channel.delete().catch(e => console.error("Lỗi xóa kênh:", e));
        }, 5000);
    }

    // ==========================================
    // 4. XỬ LÝ KHI ADMIN ĐIỀN XONG FORM XÁC NHẬN
    // ==========================================
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_deduct_')) {
        const key = interaction.customId.replace('modal_deduct_', '');
        const quantity = parseInt(interaction.fields.getTextInputValue('quantityInput'));
        const spawner = spawnerConfig[key];

        if (!spawner) return interaction.reply({ content: '❌ Loại spawner không tồn tại!', flags: MessageFlags.Ephemeral });
        
        if (isNaN(quantity) || quantity <= 0) {
            return interaction.reply({ content: '❌ Số lượng không hợp lệ! Vui lòng nhập số nguyên dương.', flags: MessageFlags.Ephemeral });
        }

        // Trừ kho
        spawner.stock -= quantity;

        await interaction.reply({
            content: `🎉 **GIAO DỊCH THÀNH CÔNG!**\nAdmin đã xác nhận giao **\`${quantity}\`x ${spawner.name}** cho khách hàng.\n📦 Kho hiện tại còn: \`${spawner.stock}\` cái.\n*(Hãy gõ lại lệnh /shop ở kênh công khai để cập nhật bảng cửa hàng mới)*`
        });
    }
});

client.login(process.env.TOKEN);
