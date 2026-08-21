const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    MessageFlags,
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

// Cấu hình 4 loại Spawner
const spawnerConfig = {
    ske: { name: "Skeleton Spawner", price: 5000, stock: 10, emoji: "💀" },
    blaze: { name: "Blaze Spawner", price: 15000, stock: 5, emoji: "🔥" },
    creeper: { name: "Creeper Spawner", price: 10000, stock: 8, emoji: "💥" },
    golem: { name: "Iron Golem Spawner", price: 30000, stock: 3, emoji: "🤖" }
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

client.once('ready', async () => {
    console.log(`Bot đã đăng nhập thành công với tên ${client.user.tag}!`);

    // Sửa lỗi: Sử dụng client.token thay vì process.env.TOKEN để đăng ký lệnh
    const rest = new REST({ version: '10' }).setToken(client.token);
    try {
        const commands = [
            new SlashCommandBuilder()
                .setName('shop')
                .setDescription('Mở cửa hàng mua spawner (Skeleton, Blaze, Creeper, Golem)')
                .toJSON()
        ];

        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('✅ Đã tự động đăng ký thành công lệnh /shop lên Discord!');
    } catch (error) {
        console.error('❌ Lỗi khi đăng ký lệnh:', error);
    }
});

client.on('interactionCreate', async (interaction) => {
    // 1. Xử lý lệnh /shop
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'shop') {
            const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;

            // Tạo các nút bấm trực tiếp cho 4 loại spawner
            const row = new ActionRowBuilder();
            
            Object.keys(spawnerConfig).forEach(key => {
                const item = spawnerConfig[key];
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`buy_${key}`)
                        .setLabel(`${item.name} ($${item.price.toLocaleString()})`)
                        .setEmoji(item.emoji)
                        .setStyle(ButtonStyle.Primary)
                );
            });

            await interaction.editReply({
                content: '🛒 **Cửa hàng Spawner Chính Thức**\nBấm trực tiếp vào các nút bên dưới để mua loại bạn muốn:',
                components: [row]
            });
        }
    }

    // 2. Xử lý khi người dùng bấm vào nút mua
    if (interaction.isButton() && interaction.customId.startsWith('buy_')) {
        const key = interaction.customId.replace('buy_', '');
        const spawner = spawnerConfig[key];

        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        if (!spawner) {
            return interaction.editReply({ content: "❌ Loại spawner này không tồn tại!" });
        }

        // Kiểm tra tồn kho
        if (spawner.stock <= 0) {
            return interaction.editReply({ content: `❌ Rất tiếc, **${spawner.name}** hiện đã hết hàng trong kho!` });
        }

        // Trừ kho
        spawner.stock -= 1;

        await interaction.editReply({
            content: `✅ Bạn đã mua thành công **1x ${spawner.name}** với giá **$${spawner.price.toLocaleString()}**!\n📦 Số lượng kho còn lại: **${spawner.stock}**`
        });
    }
});

client.login(process.env.TOKEN);
