const http = require('http');

// Tạo web server ảo để Render không báo lỗi port
http.createServer((req, res) => {
    res.write("Bot Discord đang hoạt động!");
    res.end();
}).listen(process.env.PORT || 3000);

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

require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,    // Cần thiết để kiểm tra Admin
        GatewayIntentBits.GuildPresences  // Cần thiết để kiểm tra Admin Online/Offline
    ]
});

// ==========================================
// ⚙️ CẤU HÌNH THÔNG TIN SERVER CỦA BẠN
// ==========================================
const serverConfig = {
    adminRoleId: "ID_ROLE_ADMIN_CUA_BAN",       // ID Role Admin (Vd: "123456789012345678")
    ticketCategoryId: "ID_CATEGORY_TICKET_CUA_BAN", // ID Danh mục chứa Ticket
    legitChannelId: "ID_KENH_LEGIT_CUA_BAN",   // ID Kênh đánh giá/Legit (Vd: "112233445566778899")
    
    // THÔNG TIN TÀI KHOẢN NGÂN HÀNG CỦA BẠN
    bank: {
        shortName: "MB",                       // Mã ngân hàng MB Bank
        accountNo: "0357597469",                // Số tài khoản
        accountName: "TRAN HUU HAI SON"        // Tên chủ tài khoản
    }
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

// 🎨 Hàm tạo giao diện Bảng Cửa hàng (Embed đẹp & thoáng)
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
        .setFooter({ text: '⚡ Hệ thống giao dịch tự động • Uy tín 100%' });

    Object.keys(spawnerConfig).forEach(key => {
        const item = spawnerConfig[key];
        const status = item.stock > 0 ? `🟢 Còn lại: **${item.stock}** cái` : `🔴 **HẾT HÀNG**`;
        
        embed.addFields(
            {
                name: `${item.emoji} **${item.name.toUpperCase()}**`,
                value: `>>> 💵 Giá: **${item.price.toLocaleString('vi-VN')} VNĐ**\n📦 Tình trạng: ${status}`,
                inline: false
            },
            // Trường trống dùng để cách dòng cho đẹp mắt
            { name: '\u200B', value: '\u200B', inline: false }
        );
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
                .setDisabled(item.stock <= 0)
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
        console.log('✅ Đã đăng ký lệnh /shop và /price!');
    } catch (error) {
        console.error('❌ Lỗi khi đăng ký lệnh:', error);
    }
});

// ==========================================
// 🎧 BỘ XỬ LÝ TƯƠNG TÁC
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
                content: `✅ Đã cập nhật giá **${spawner.name}** từ **${oldPrice.toLocaleString('vi-VN')} VNĐ** thành **${newPrice.toLocaleString('vi-VN')} VNĐ**!\n*Vui lòng gõ lại lệnh /shop để hiển thị bảng giá mới.*`
            });
        }
    }

    // ----------------------------------------
    // [2] NÚT MUA HÀNG (MỞ FORM NỔI)
    // ----------------------------------------
    if (interaction.isButton() && interaction.customId.startsWith('buy_')) {
        const key = interaction.customId.replace('buy_', '');
        const spawner = spawnerConfig[key];

        if (!spawner || spawner.stock <= 0) {
            return interaction.reply({ content: `❌ Sản phẩm này hiện đã hết hàng hoặc bị lỗi!`, flags: MessageFlags.Ephemeral });
        }

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
            .setLabel(`Số lượng mua (Còn lại: ${spawner.stock}):`)
            .setStyle(TextInputStyle.Short)
            .setValue('1')
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(ignInput),
            new ActionRowBuilder().addComponents(quantityInput)
        );

        await interaction.showModal(modal);
    }

    // ----------------------------------------
    // [3] XỬ LÝ KHÁCH GỬI FORM -> TẠO TICKET & HIỂN THỊ VIETQR
    // ----------------------------------------
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_buy_')) {
        const key = interaction.customId.replace('modal_buy_', '');
        const spawner = spawnerConfig[key];

        const ign = interaction.fields.getTextInputValue('ignInput');
        const quantity = parseInt(interaction.fields.getTextInputValue('quantityInput'));

        if (isNaN(quantity) || quantity <= 0) {
            return interaction.reply({ content: '❌ Số lượng nhập vào không hợp lệ!', flags: MessageFlags.Ephemeral });
        }
        if (quantity > spawner.stock) {
            return interaction.reply({ content: `❌ Trong kho chỉ còn \`${spawner.stock}\` cái, không đủ cung cấp!`, flags: MessageFlags.Ephemeral });
        }

        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        try {
            // Cấu hình quyền riêng tư cho Ticket
            const permissionOverwrites = [
                {
                    id: interaction.guild.id,
                    deny: [PermissionFlagsBits.ViewChannel],
                },
                {
                    id: client.user.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles],
                },
                {
                    id: interaction.user.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory],
                }
            ];

            if (serverConfig.adminRoleId !== "ID_ROLE_ADMIN_CUA_BAN") {
                permissionOverwrites.push({
                    id: serverConfig.adminRoleId,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels],
                });
            }

            // Tạo kênh Ticket
            const ticketChannel = await interaction.guild.channels.create({
                name: `don-${spawner.name.split(' ')[0]}-${ign.toLowerCase()}`,
                type: ChannelType.GuildText,
                parent: serverConfig.ticketCategoryId !== "ID_CATEGORY_TICKET_CUA_BAN" ? serverConfig.ticketCategoryId : null,
                permissionOverwrites: permissionOverwrites
            });

            const totalPrice = spawner.price * quantity;
            const memoContent = `MUA ${spawner.name.split(' ')[0].toUpperCase()} ${ign.toUpperCase()}`;

            // Tự động tạo link Mã QR ngân hàng MB Bank qua VietQR
            const qrImageUrl = `https://img.vietqr.io/image/${serverConfig.bank.shortName}-${serverConfig.bank.accountNo}-compact2.png?amount=${totalPrice}&addInfo=${encodeURIComponent(memoContent)}&accountName=${encodeURIComponent(serverConfig.bank.accountName)}`;

            // Kiểm tra Admin có ai Online không
            let adminStatusText = "🟢 **Admin đang có mặt**, vui lòng chờ Admin xác nhận!";
            try {
                if (serverConfig.adminRoleId !== "ID_ROLE_ADMIN_CUA_BAN") {
                    const adminRole = interaction.guild.roles.cache.get(serverConfig.adminRoleId);
                    if (adminRole) {
                        await interaction.guild.members.fetch();
                        const onlineAdmins = adminRole.members.filter(m => 
                            m.presence && ['online', 'idle', 'dnd'].includes(m.presence.status)
                        );
                        if (onlineAdmins.size === 0) {
                            adminStatusText = "🟡 **Hiện tại Admin đang vắng mặt hoặc bận chút việc.** Bạn vui lòng kiên nhẫn chờ một chút nhé, Admin sẽ phản hồi ngay khi online!";
                        }
                    }
                }
            } catch (e) {
                console.error("Lỗi kiểm tra admin online:", e);
            }

            // Thiết kế Embed Ticket
            const ticketEmbed = new EmbedBuilder()
                .setColor('#F1C40F')
                .setTitle(`🛒 ĐƠN HÀNG: ${spawner.name.toUpperCase()}`)
                .setDescription(
                    `Chào bạn <@${interaction.user.id}>,\nCảm ơn bạn đã đặt hàng tại shop!\n\n` +
                    `📌 **THÔNG TIN ĐƠN HÀNG:**\n` +
                    `• 👤 **Tên In-game (IGN):** \`${ign}\`\n` +
                    `• 📦 **Sản phẩm:** \`${spawner.name}\` x **${quantity}**\n` +
                    `• 💰 **Tổng thanh toán:** **${totalPrice.toLocaleString('vi-VN')} VNĐ**\n\n` +
                    `⚠️ **LƯU Ý QUAN TRỌNG:**\n` +
                    `👉 **VUI LÒNG ĐỜI ADMIN REP TRONG TICKET NÀY TRƯỚC KHIN BANK TIỀN!**\n\n` +
                    `${adminStatusText}\n\n` +
                    `───────────────────────────────────\n` +
                    `🏦 **THÔNG TIN CHUYỂN KHOẢN:**\n` +
                    `• Ngân hàng: **MB Bank (Ngân hàng Quân Đội)**\n` +
                    `• Số tài khoản: \`${serverConfig.bank.accountNo}\`\n` +
                    `• Chủ tài khoản: **${serverConfig.bank.accountName}**\n` +
                    `• Nội dung CK: \`${memoContent}\`\n` +
                    `*(Bạn có thể Quét mã QR bên dưới để tự động điền đúng số tiền và nội dung)*`
                )
                .setImage(qrImageUrl)
                .setFooter({ text: "Vui lòng chụp ảnh bill chuyển khoản gửi vào đây sau khi chuyển tiền!" })
                .setTimestamp();

            const ticketButtons = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`confirm_${key}_${quantity}`) 
                    .setLabel('✅ Admin Xác nhận & Trừ kho')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('🔒 Đóng Ticket')
                    .setStyle(ButtonStyle.Danger)
            );

            const adminPing = serverConfig.adminRoleId !== "ID_ROLE_ADMIN_CUA_BAN" ? `<@&${serverConfig.adminRoleId}>` : "@Admin";
            await ticketChannel.send({
                content: `🔔 Khách: <@${interaction.user.id}> | Admin: ${adminPing}`,
                embeds: [ticketEmbed],
                components: [ticketButtons]
            });

            await interaction.editReply({
                content: `✅ Đơn hàng đã được tạo! Vui lòng truy cập kênh <#${ticketChannel.id}> để giao dịch.`
            });

        } catch (error) {
            console.error("Lỗi khi tạo ticket:", error);
            await interaction.editReply({ content: "❌ Đã xảy ra lỗi khi tạo kênh Ticket. Vui lòng kiểm tra lại quyền của Bot!" });
        }
    }

    // ----------------------------------------
    // [4] NÚT ADMIN TRONG TICKET
    // ----------------------------------------
    if (interaction.isButton() && interaction.customId.startsWith('confirm_')) {
        const hasAdminPerms = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        const hasAdminRole = serverConfig.adminRoleId !== "ID_ROLE_ADMIN_CUA_BAN" ? interaction.member.roles.cache.has(serverConfig.adminRoleId) : false;

        if (!hasAdminPerms && !hasAdminRole) {
            return interaction.reply({ content: '❌ Chỉ Admin mới có quyền xác nhận đơn!', flags: MessageFlags.Ephemeral });
        }

        const parts = interaction.customId.split('_');
        const key = parts[1];
        const requestedQuantity = parts[2];

        const modal = new ModalBuilder()
            .setCustomId(`modal_deduct_${key}`)
            .setTitle('Xác nhận hoàn tất giao dịch');

        const quantityInput = new TextInputBuilder()
            .setCustomId('quantityInput')
            .setLabel('Số lượng spawner thực tế giao:')
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
            return interaction.reply({ content: '❌ Chỉ Admin mới có thể đóng ticket!', flags: MessageFlags.Ephemeral });
        }

        await interaction.reply({ content: '🔒 Kênh sẽ tự động xoá sau **5 giây**...' });
        setTimeout(() => {
            interaction.channel.delete().catch(e => console.error("Lỗi xóa kênh:", e));
        }, 5000);
    }

    // ----------------------------------------
    // [5] ADMIN HOÀN TẤT GIAO DỊCH & NHẮC KHÁCH ĐÁNH GIÁ LEGIT
    // ----------------------------------------
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_deduct_')) {
        const key = interaction.customId.replace('modal_deduct_', '');
        const quantity = parseInt(interaction.fields.getTextInputValue('quantityInput'));
        const spawner = spawnerConfig[key];

        if (!spawner) return interaction.reply({ content: '❌ Loại spawner không tồn tại!', flags: MessageFlags.Ephemeral });
        if (isNaN(quantity) || quantity <= 0) return interaction.reply({ content: '❌ Số lượng không hợp lệ!', flags: MessageFlags.Ephemeral });

        // Trừ kho
        spawner.stock -= quantity;

        // Kênh đánh giá/Legit
        const legitChannelMention = serverConfig.legitChannelId !== "ID_KENH_LEGIT_CUA_BAN" ? `<#${serverConfig.legitChannelId}>` : "**kênh đánh giá/legit**";

        await interaction.reply({
            content: `🎉 **GIAO DỊCH HOÀN TẤT THÀNH CÔNG!**\n\n` +
                     `👑 Admin <@${interaction.user.id}> đã xác nhận giao thành công **\`${quantity}\`x ${spawner.name}** cho khách hàng.\n` +
                     `📦 Trong kho hiện tại còn lại: \`${spawner.stock}\` cái.\n\n` +
                     `❤️ **Cảm ơn bạn đã tin tưởng và ủng hộ shop!** Vui lòng bỏ ra vài giây ghé qua kênh ${legitChannelMention} để lại **+1 Legit / Đánh giá** ủng hộ shop nhé! 🔥`
        });
    }
});

client.login(process.env.TOKEN);
