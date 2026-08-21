const http = require('http');

// Web server ảo cho Render
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
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
    ]
});

// ==========================================
// ⚙️ CẤU HÌNH THÔNG TIN SERVER CỦA BẠN
// ==========================================
const serverConfig = {
    adminRoleId: "ID_ROLE_ADMIN_CUA_BAN",       
    ticketCategoryId: "ID_CATEGORY_TICKET_CUA_BAN", 
    legitChannelId: "ID_KENH_LEGIT_CUA_BAN",   
    
    bank: {
        shortName: "MB",                       
        accountNo: "0357597469",                
        accountName: "TRAN HUU HAI SON"        
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

// 🎨 BẢNG CỬA HÀNG
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
                value: `>>> 💵 Giá Bank: **${item.price.toLocaleString('vi-VN')} VNĐ**\n📦 Tình trạng: ${status}`,
                inline: false
            },
            { name: '\u200B', value: '\u200B', inline: false }
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
// 🚀 BOT KHỞI ĐỘNG
// ==========================================
client.once('ready', async () => {
    console.log(`✅ Bot đã đăng nhập thành công với tên ${client.user.tag}!`);
    const rest = new REST({ version: '10' }).setToken(client.token);
    try {
        const commands = [
            new SlashCommandBuilder().setName('shop').setDescription('Mở bảng cửa hàng spawner').toJSON(),
            new SlashCommandBuilder()
                .setName('price')
                .setDescription('Thay đổi giá spawner (Dành cho Admin)')
                .addStringOption(option => option.setName('type').setDescription('Loại spawner').setRequired(true)
                    .addChoices(
                        { name: 'Skeleton Spawner', value: 'ske' },
                        { name: 'Blaze Spawner', value: 'blaze' },
                        { name: 'Creeper Spawner', value: 'creeper' },
                        { name: 'Iron Golem Spawner', value: 'golem' }
                    ))
                .addIntegerOption(option => option.setName('amount').setDescription('Giá tiền mới (VNĐ)').setRequired(true))
                .toJSON()
        ];
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Đã đăng ký lệnh thành công!');
    } catch (error) { console.error('❌ Lỗi đăng ký lệnh:', error); }
});

// ==========================================
// 📸 BẮT SỰ KIỆN KHÁCH GỬI BILL ĐỂ TAG ADMIN (ĐÃ TỐI ƯU PING SÁNG)
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.channel.name.startsWith('don-') && message.attachments.size > 0) {
        const hasValidAdminRole = serverConfig.adminRoleId && serverConfig.adminRoleId !== "ID_ROLE_ADMIN_CUA_BAN";
        const adminMention = hasValidAdminRole ? `<@&${serverConfig.adminRoleId}>` : "@Admin";
        
        await message.channel.send({
            content: `🔔 ${adminMention} ơi! Khách hàng <@${message.author.id}> vừa gửi ảnh bill thanh toán. Nhờ Admin vào kiểm tra và giao hàng nhé! 📦`,
            allowedMentions: { roles: hasValidAdminRole ? [serverConfig.adminRoleId] : [] }
        });
    }
});

// ==========================================
// 🎧 BỘ XỬ LÝ TƯƠNG TÁC
// ==========================================
client.on('interactionCreate', async (interaction) => {

    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'shop') {
            await interaction.reply({ embeds: [createShopEmbed()], components: [createShopButtons()] });
        }

        // XỬ LÝ ĐỔI GIÁ /PRICE
        if (interaction.commandName === 'price') {
            const hasAdminPerms = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
            const hasAdminRole = serverConfig.adminRoleId !== "ID_ROLE_ADMIN_CUA_BAN" ? interaction.member.roles.cache.has(serverConfig.adminRoleId) : false;

            if (!hasAdminPerms && !hasAdminRole) {
                return interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này!', flags: MessageFlags.Ephemeral });
            }

            const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;

            const type = interaction.options.getString('type');
            const newPrice = interaction.options.getInteger('amount');
            const spawner = spawnerConfig[type];

            if (!spawner) return interaction.editReply({ content: "❌ Loại spawner không tồn tại!" });

            const oldPrice = spawner.price;
            spawner.price = newPrice;

            await interaction.editReply({ 
                content: `✅ Đã cập nhật giá **${spawner.name}** từ **${oldPrice.toLocaleString('vi-VN')} VNĐ** ➡️ **${newPrice.toLocaleString('vi-VN')} VNĐ**!\n*Gõ lại /shop ở kênh chat để tạo bảng giá mới.*` 
            });
        }
    }

    // [1] KHÁCH BẤM MUA -> CHỌN PHƯƠNG THỨC THANH TOÁN
    if (interaction.isButton() && interaction.customId.startsWith('buy_')) {
        const key = interaction.customId.replace('buy_', '');
        const spawner = spawnerConfig[key];

        if (!spawner || spawner.stock <= 0) {
            return interaction.reply({ content: `❌ Sản phẩm này đã hết hàng!`, flags: MessageFlags.Ephemeral });
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`method_bank_${key}`)
                .setLabel('Thanh toán Ngân Hàng')
                .setEmoji('🏦')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`method_card_${key}`)
                .setLabel('Thanh toán Thẻ Cào (+20% Phí)')
                .setEmoji('💳')
                .setStyle(ButtonStyle.Danger)
        );

        await interaction.reply({
            content: `**Vui lòng chọn phương thức thanh toán cho ${spawner.name}:**\n*(Lưu ý: Nạp bằng thẻ cào điện thoại chịu thêm 20% phí gạch thẻ)*`,
            components: [row],
            flags: MessageFlags.Ephemeral
        });
    }

    // [2] XỬ LÝ CHỌN PHƯƠNG THỨC
    if (interaction.isButton() && interaction.customId.startsWith('method_')) {
        const isBank = interaction.customId.startsWith('method_bank_');
        const key = interaction.customId.replace(isBank ? 'method_bank_' : 'method_card_', '');
        const spawner = spawnerConfig[key];

        if (isBank) {
            // FORM BANK
            const modal = new ModalBuilder().setCustomId(`modal_bank_${key}`).setTitle(`🏦 Mua ${spawner.name.split(' ')[0]} (CK)`);
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ign').setLabel('Tên trong game (IGN):').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('qty').setLabel(`Số lượng (Còn: ${spawner.stock}):`).setStyle(TextInputStyle.Short).setValue('1').setRequired(true))
            );
            await interaction.showModal(modal);
        } else {
            // FORM CARD (BỎ SỐ LƯỢNG - TỰ TÍNH THEO MỆNH GIÁ)
            const modal = new ModalBuilder().setCustomId(`modal_card_${key}`).setTitle(`💳 Nạp Thẻ Mua ${spawner.name.split(' ')[0]}`);
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('ign').setLabel('Tên trong game (IGN):').setStyle(TextInputStyle.Short).setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('card_net').setLabel('Nhà mạng:').setStyle(TextInputStyle.Short).setPlaceholder('Ví dụ: Viettel, Vinaphone, Mobifone...').setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('card_val').setLabel('Mệnh giá thẻ (VNĐ):').setStyle(TextInputStyle.Short).setPlaceholder('Ví dụ: 100000 hoặc 100k').setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('pin').setLabel('Mã thẻ (PIN):').setStyle(TextInputStyle.Short).setPlaceholder('Nhập chính xác mã PIN').setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('serial').setLabel('Số Seri (Serial):').setStyle(TextInputStyle.Short).setPlaceholder('Nhập chính xác số Seri').setRequired(true)
                )
            );
            await interaction.showModal(modal);
        }
    }

    // [3] XỬ LÝ FORM -> TẠO TICKET
    if (interaction.isModalSubmit() && (interaction.customId.startsWith('modal_bank_') || interaction.customId.startsWith('modal_card_'))) {
        const isBank = interaction.customId.startsWith('modal_bank_');
        const key = interaction.customId.replace(isBank ? 'modal_bank_' : 'modal_card_', '');
        const spawner = spawnerConfig[key];

        let ign = "";
        let quantity = 1;
        let cardValue = 0;
        let cardNet = "";
        let pin = "";
        let serial = "";

        if (isBank) {
            ign = interaction.fields.getTextInputValue('ign');
            quantity = parseInt(interaction.fields.getTextInputValue('qty'));

            if (isNaN(quantity) || quantity <= 0) return interaction.reply({ content: '❌ Số lượng không hợp lệ!', flags: MessageFlags.Ephemeral });
            if (quantity > spawner.stock) return interaction.reply({ content: `❌ Kho chỉ còn \`${spawner.stock}\` cái!`, flags: MessageFlags.Ephemeral });
        } else {
            ign = interaction.fields.getTextInputValue('ign');
            cardNet = interaction.fields.getTextInputValue('card_net');
            const rawVal = interaction.fields.getTextInputValue('card_val').toLowerCase().trim();
            pin = interaction.fields.getTextInputValue('pin');
            serial = interaction.fields.getTextInputValue('serial');

            // Xử lý mệnh giá nhập vào (VD: 100k -> 100000)
            let multiplier = 1;
            let cleanVal = rawVal;
            if (rawVal.endsWith('k')) {
                multiplier = 1000;
                cleanVal = rawVal.replace('k', '');
            }
            cardValue = parseInt(cleanVal.replace(/[^0-9]/g, '')) * multiplier;

            if (isNaN(cardValue) || cardValue <= 0) {
                return interaction.reply({ content: '❌ Mệnh giá thẻ nhập vào không hợp lệ!', flags: MessageFlags.Ephemeral });
            }

            // TỰ ĐỘNG TÍNH SỐ SPAWNER NHẬN ĐƯỢC (SỐ NGUYÊN)
            const pricePerSpawnerCard = Math.round(spawner.price * 1.2);
            quantity = Math.floor(cardValue / pricePerSpawnerCard);

            if (quantity < 1) {
                return interaction.reply({
                    content: `❌ Thẻ mệnh giá **${cardValue.toLocaleString('vi-VN')} VNĐ** không đủ để mua 1 **${spawner.name}**!\n` +
                             `*(Giá spawner qua thẻ cào đã +20% phí là: **${pricePerSpawnerCard.toLocaleString('vi-VN')} VNĐ**/cái)*`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        try {
            const permissionOverwrites = [
                { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] }
            ];
            if (serverConfig.adminRoleId !== "ID_ROLE_ADMIN_CUA_BAN") {
                permissionOverwrites.push({ id: serverConfig.adminRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] });
            }

            const ticketChannel = await interaction.guild.channels.create({
                name: `don-${spawner.name.split(' ')[0]}-${ign.toLowerCase()}`,
                type: ChannelType.GuildText,
                parent: serverConfig.ticketCategoryId !== "ID_CATEGORY_TICKET_CUA_BAN" ? serverConfig.ticketCategoryId : null,
                permissionOverwrites: permissionOverwrites
            });

            let adminStatusText = "🟢 **Admin đang có mặt**, vui lòng chờ phản hồi!";
            try {
                if (serverConfig.adminRoleId !== "ID_ROLE_ADMIN_CUA_BAN") {
                    const adminRole = interaction.guild.roles.cache.get(serverConfig.adminRoleId);
                    if (adminRole) {
                        await interaction.guild.members.fetch();
                        const onlineAdmins = adminRole.members.filter(m => m.presence && ['online', 'idle', 'dnd'].includes(m.presence.status));
                        if (onlineAdmins.size === 0) adminStatusText = "🟡 **Hiện tại Admin đang vắng mặt.** Bạn vui lòng kiên nhẫn chờ chút nhé!";
                    }
                }
            } catch (e) {}

            const ticketEmbed = new EmbedBuilder().setTimestamp();
            const ticketButtons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`confirm_${key}_${quantity}`).setLabel('✅ Admin Xác nhận & Trừ kho').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 Đóng Ticket').setStyle(ButtonStyle.Danger)
            );

            if (isBank) {
                const totalPrice = spawner.price * quantity;
                const randomCode = Math.floor(1000 + Math.random() * 9000);
                const safeIgn = ign.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                const memoContent = `TT ${randomCode} ${safeIgn}`;
                
                const qrImageUrl = `https://img.vietqr.io/image/${serverConfig.bank.shortName}-${serverConfig.bank.accountNo}-compact2.png?amount=${totalPrice}&addInfo=${encodeURIComponent(memoContent)}&accountName=${encodeURIComponent(serverConfig.bank.accountName)}`;

                ticketEmbed.setColor('#0099ff')
                    .setTitle(`🏦 ĐƠN HÀNG CHUYỂN KHOẢN: ${spawner.name.toUpperCase()}`)
                    .setDescription(
                        `Chào <@${interaction.user.id}>, dưới đây là thông tin đơn của bạn:\n` +
                        `• 👤 **IGN:** \`${ign}\`\n• 📦 **Số lượng:** \`${quantity}\` cái\n` +
                        `• 💰 **Tổng thanh toán:** **${totalPrice.toLocaleString('vi-VN')} VNĐ**\n\n` +
                        `⚠️ **ĐỢI ADMIN REP TRONG KÊNH NÀY RỒI MỚI CHUYỂN KHOẢN NHÉ!**\n${adminStatusText}\n\n` +
                        `───────────────────────────────────\n` +
                        `🏦 **THÔNG TIN CHUYỂN KHOẢN:**\n` +
                        `• Ngân hàng: **MB Bank**\n• Số tài khoản: \`${serverConfig.bank.accountNo}\`\n` +
                        `• Chủ tài khoản: **${serverConfig.bank.accountName}**\n` +
                        `• Nội dung CK: \`${memoContent}\` *(Vui lòng ghi y hệt chữ này)*\n\n` +
                        `*(Bạn có thể Quét QR bên dưới. Sau khi CK xong, hãy gửi ảnh bill vào đây!)*`
                    )
                    .setImage(qrImageUrl);
            } else {
                const pricePerSpawnerCard = Math.round(spawner.price * 1.2);

                ticketEmbed.setColor('#E67E22')
                    .setTitle(`💳 ĐƠN HÀNG THẺ CÀO: ${spawner.name.toUpperCase()}`)
                    .setDescription(
                        `Chào <@${interaction.user.id}>, thông tin nạp thẻ của bạn đã được ghi nhận.\n` +
                        `• 👤 **IGN:** \`${ign}\`\n` +
                        `• 💵 **Mệnh giá thẻ:** **${cardValue.toLocaleString('vi-VN')} VNĐ**\n` +
                        `• 🎯 **Số ${spawner.name} nhận được:** \`${quantity}\` **cái** *(Tự động tính phần nguyên)*\n` +
                        `• ℹ️ *(Đơn giá thẻ cào +20% phí: ${pricePerSpawnerCard.toLocaleString('vi-VN')} VNĐ/cái)*\n\n` +
                        `${adminStatusText}\n\n` +
                        `───────────────────────────────────\n` +
                        `🧾 **THÔNG TIN THẺ NẠP (Chạm để copy):**\n` +
                        `• 🌐 **Nhà mạng:** \`${cardNet}\`\n` +
                        `• 🔑 **Mã PIN:** \`${pin}\` *(Chạm/Click để copy)*\n` +
                        `• 🔢 **Số SERI:** \`${serial}\` *(Chạm/Click để copy)*\n\n` +
                        `*Admin sẽ tiến hành nạp thẻ và giao sản phẩm cho bạn ngay khi kiểm tra xong!*`
                    );
            }

            const hasValidAdminRole = serverConfig.adminRoleId && serverConfig.adminRoleId !== "ID_ROLE_ADMIN_CUA_BAN";
            const adminMention = hasValidAdminRole ? `<@&${serverConfig.adminRoleId}>` : "@Admin";
            
            await ticketChannel.send({ 
                content: `🔔 Khách: <@${interaction.user.id}> | Admin: ${adminMention}`, 
                embeds: [ticketEmbed], 
                components: [ticketButtons],
                allowedMentions: { roles: hasValidAdminRole ? [serverConfig.adminRoleId] : [] }
            });
            await interaction.editReply({ content: `✅ Vui lòng vào kênh <#${ticketChannel.id}> để hoàn tất giao dịch!` });

        } catch (error) {
            console.error(error);
            await interaction.editReply({ content: "❌ Lỗi tạo kênh Ticket." });
        }
    }

    // [4] NÚT ADMIN XÁC NHẬN
    if (interaction.isButton() && interaction.customId.startsWith('confirm_')) {
        const hasAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || (serverConfig.adminRoleId !== "ID_ROLE_ADMIN_CUA_BAN" && interaction.member.roles.cache.has(serverConfig.adminRoleId));
        if (!hasAdmin) return interaction.reply({ content: '❌ Chỉ Admin mới dùng được nút này!', flags: MessageFlags.Ephemeral });

        const parts = interaction.customId.split('_');
        const key = parts[1];
        const requestedQuantity = parts[2];

        const modal = new ModalBuilder().setCustomId(`modal_deduct_${key}`).setTitle('Xác nhận hoàn tất giao dịch');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('quantityInput').setLabel('Số lượng spawner thực tế giao:').setStyle(TextInputStyle.Short).setValue(requestedQuantity).setRequired(true)));
        await interaction.showModal(modal);
    }

    if (interaction.isButton() && interaction.customId === 'close_ticket') {
        const hasAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || (serverConfig.adminRoleId !== "ID_ROLE_ADMIN_CUA_BAN" && interaction.member.roles.cache.has(serverConfig.adminRoleId));
        if (!hasAdmin) return interaction.reply({ content: '❌ Bạn không có quyền đóng ticket!', flags: MessageFlags.Ephemeral });
        await interaction.reply({ content: '🔒 Kênh sẽ tự động xoá sau **5 giây**...' });
        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }

    // [5] HOÀN TẤT VÀ NHẮC ĐÁNH GIÁ LEGIT
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_deduct_')) {
        const key = interaction.customId.replace('modal_deduct_', '');
        const quantity = parseInt(interaction.fields.getTextInputValue('quantityInput'));
        const spawner = spawnerConfig[key];

        if (!spawner) return interaction.reply({ content: '❌ Lỗi hệ thống!', flags: MessageFlags.Ephemeral });
        spawner.stock -= quantity;

        const legitChannel = serverConfig.legitChannelId !== "ID_KENH_LEGIT_CUA_BAN" ? `<#${serverConfig.legitChannelId}>` : "**kênh legit**";

        await interaction.reply({
            content: `🎉 **GIAO DỊCH HOÀN TẤT THÀNH CÔNG!**\n\n` +
                     `👑 Admin <@${interaction.user.id}> đã giao thành công **\`${quantity}\`x ${spawner.name}**.\n` +
                     `📦 Kho hiện tại còn: \`${spawner.stock}\` cái.\n\n` +
                     `❤️ Cảm ơn bạn! Đừng quên ghé ${legitChannel} để gửi một đánh giá **+1 Legit** ủng hộ shop nhé! 🔥`
        });
    }
});

client.login(process.env.TOKEN);
