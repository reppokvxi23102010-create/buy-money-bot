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
    SlashCommandBuilder
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Cấu hình 4 loại Spawner (Bạn có thể dễ dàng chỉnh sửa số lượng stock và giá ở đây)
const spawnerConfig = {
    ske: { name: "Skeleton Spawner", price: 50000, stock: 10, emoji: "💀" },
    blaze: { name: "Blaze Spawner", price: 150000, stock: 5, emoji: "🔥" },
    creeper: { name: "Creeper Spawner", price: 100000, stock: 8, emoji: "💥" },
    golem: { name: "Iron Golem Spawner", price: 300000, stock: 3, emoji: "🤖" }
};

// Hàm tạo Bảng Cửa hàng (Embed)
function createShopEmbed() {
    const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('🛒 HỆ THỐNG CỬA HÀNG SPAWNER')
        .setDescription('Chào mừng bạn đến với cửa hàng! Nhấn vào các nút bên dưới để mua loại spawner bạn muốn.')
        .setTimestamp();

    Object.keys(spawnerConfig).forEach(key => {
        const item = spawnerConfig[key];
        embed.addFields({
            name: `${item.emoji} ${item.name}`,
            value: `💰 Giá: **${item.price.toLocaleString('vi-VN')} VNĐ**\n📦 Còn lại: **${item.stock} cái**`,
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
                .setDisabled(item.stock <= 0) // Khóa nút nếu hết hàng
        );
    });
    return row;
}

client.once('ready', async () => {
    console.log(`Bot đã đăng nhập thành công với tên ${client.user.tag}!`);

    // Tự động đăng ký các lệnh Slash Commands lên Discord
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

client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        // 1. Xử lý lệnh /shop
        if (interaction.commandName === 'shop') {
            await interaction.reply({
                embeds: [createShopEmbed()],
                components: [createShopButtons()],
                ephemeral: false
            });
        }

        // 2. Xử lý lệnh /price để đổi giá spawner
        if (interaction.commandName === 'price') {
            const type = interaction.options.getString('type');
            const newPrice = interaction.options.getInteger('amount');

            const spawner = spawnerConfig[type];
            if (!spawner) {
                return interaction.reply({ content: "❌ Loại spawner không tồn tại!", ephemeral: true });
            }

            const oldPrice = spawner.price;
            spawner.price = newPrice;

            await interaction.reply({
                content: `✅ Đã cập nhật giá **${spawner.name}** từ **${oldPrice.toLocaleString('vi-VN')} VNĐ** thành **${newPrice.toLocaleString('vi-VN')} VNĐ**!`,
                ephemeral: true
            });
        }
    }

    // 3. Xử lý khi người dùng bấm nút mua spawner
    if (interaction.isButton() && interaction.customId.startsWith('buy_')) {
        const key = interaction.customId.replace('buy_', '');
        const spawner = spawnerConfig[key];

        if (!spawner) {
            return interaction.reply({ content: "❌ Loại spawner này không tồn tại!", ephemeral: true });
        }

        if (spawner.stock <= 0) {
            return interaction.reply({ content: `❌ Rất tiếc, **${spawner.name}** hiện đã hết hàng trong kho!`, ephemeral: true });
        }

        // Trừ kho
        spawner.stock -= 1;

        // Cập nhật lại giao diện bảng cửa hàng công khai
        await interaction.update({
            embeds: [createShopEmbed()],
            components: [createShopButtons()]
        });

        // Gửi thông báo ẩn xác nhận mua thành công
        await interaction.followUp({
            content: `✅ Bạn đã mua thành công **1x ${spawner.name}** với giá **${spawner.price.toLocaleString('vi-VN')} VNĐ**!`,
            ephemeral: true
        });
    }
});

client.login(process.env.TOKEN);
