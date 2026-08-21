const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    StringSelectMenuOptionBuilder, 
    MessageFlags 
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// 1. Cấu hình 4 loại Spawner (Tên, Giá, Số lượng tồn kho)
const spawnerConfig = {
    ske: { name: "Skeleton Spawner", price: 5000, stock: 10 },
    blaze: { name: "Blaze Spawner", price: 15000, stock: 5 },
    creeper: { name: "Creeper Spawner", price: 10000, stock: 8 },
    golem: { name: "Iron Golem Spawner", price: 30000, stock: 3 }
};

// Hàm xử lý deferReply an toàn, tránh lỗi cú pháp lồng ngoặc
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

client.once('ready', () => {
    console.log(`Bot đã đăng nhập thành công với tên ${client.user.tag}!`);
});

client.on('interactionCreate', async (interaction) => {
    // 2. Xử lý lệnh Slash Command (Ví dụ lệnh: /shop)
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'shop') {
            const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;

            // Tạo Select Menu động dựa trên spawnerConfig
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('buy_spawner_menu')
                .setPlaceholder('📌 Chọn loại spawner bạn muốn mua...')
                .addOptions(
                    Object.keys(spawnerConfig).map(key => {
                        const item = spawnerConfig[key];
                        return new StringSelectMenuOptionBuilder()
                            .setLabel(item.name)
                            .setDescription(`Giá: $${item.price.toLocaleString()} | Kho: ${item.stock}`)
                            .setValue(key);
                    })
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await interaction.editReply({
                content: '🛒 **Cửa hàng Spawner Chính Thức**\nVui lòng chọn loại spawner bên dưới để tiến hành giao dịch:',
                components: [row]
            });
        }
    }

    // 3. Xử lý khi người dùng chọn một mục trong Select Menu
    if (interaction.isStringSelectMenu() && interaction.customId === 'buy_spawner_menu') {
        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const selectedType = interaction.values[0];
        const spawner = spawnerConfig[selectedType];

        if (!spawner) {
            return interaction.editReply({ content: "❌ Loại spawner không hợp lệ!" });
        }

        // Kiểm tra số lượng tồn kho
        if (spawner.stock <= 0) {
            return interaction.editReply({ content: `❌ Rất tiếc, **${spawner.name}** hiện đã hết hàng trong kho!` });
        }

        // TODO: Thêm logic kiểm tra số dư tiền của user tại đây (Ví dụ: userBalance < spawner.price)
        // if (userBalance < spawner.price) {
        //     return interaction.editReply({ content: "❌ Bạn không đủ tiền để mua spawner này!" });
        // }

        // Tiến hành giao dịch: Trừ số lượng kho đi 1
        spawner.stock -= 1;

        await interaction.editReply({
            content: `✅ Bạn đã mua thành công **1x ${spawner.name}** với giá **$${spawner.price.toLocaleString()}**!\n📦 Số lượng kho còn lại: **${spawner.stock}**`,
            components: [] // Xóa menu sau khi giao dịch thành công
        });
    }
});

// Đăng nhập bot sử dụng token từ biến môi trường trên Render
client.login(process.env.TOKEN);
