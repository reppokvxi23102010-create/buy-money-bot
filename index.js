require('dotenv').config();
const http = require('http');
const { 
  Client, 
  GatewayIntentBits, 
  REST, 
  Routes, 
  SlashCommandBuilder, 
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits
} = require('discord.js');
const fs = require('fs');
const path = require('path');

// 1. Khởi tạo Web Server mở cổng HTTP cho Render (Khắc phục lỗi No open ports detected)
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Bot Discord đang hoạt động 24/7 trên Render!');
}).listen(PORT, () => {
  console.log(`[HTTP] Server đang chạy trên port ${PORT}`);
});

// 2. Khởi tạo Bot Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// 3. Danh sách Slash Commands
const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Kiểm tra độ trễ của Bot')
].map(command => command.toJSON());

// 4. Hàm đăng ký Slash Commands với Discord API
async function registerCommands() {
  const token = process.env.TOKEN || process.env.DISCORD_TOKEN;
  const clientId = process.env.CLIENT_ID || process.env.APPLICATION_ID;
  const guildId = process.env.GUILD_ID;

  if (!token || !clientId) {
    console.error('❌ Thiếu TOKEN hoặc CLIENT_ID trong Environment Variables trên Render!');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log('🔄 Đang đăng ký Slash Commands...');
    if (guildId) {
      // Đăng ký cho Server cụ thể (Hiển thị ngay lập tức)
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands }
      );
      console.log(`✅ Đăng ký Slash Commands cho Server (${guildId}) thành công!`);
    } else {
      // Đăng ký Toàn cầu (Global)
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands }
      );
      console.log('✅ Đăng ký Slash Commands Toàn cầu thành công!');
    }
  } catch (error) {
    console.error('❌ Lỗi khi đăng ký Slash Commands:', error);
  }
}

// 5. Sự kiện khi Bot kết nối thành công (Dùng clientReady theo chuẩn v14)
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`🤖 Bot đã online: ${readyClient.user.tag}`);
  await registerCommands();
});

// 6. Xử lý khi người dùng tương tác (Lệnh Slash, Button, Modal)
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'ping') {
        await interaction.reply({
          content: `Pong! 🏓 Độ trễ WebSocket: **${client.ws.ping}ms**.`
        });
      }
    }
  } catch (error) {
    console.error('❌ Lỗi xử lý Interaction:', error);
    const errorMessage = { content: 'Có lỗi xảy ra khi xử lý lệnh này!', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMessage).catch(() => {});
    } else {
      await interaction.reply(errorMessage).catch(() => {});
    }
  }
});

// 7. Bắt ngoại lệ chống sập ứng dụng (Crash protection)
process.on('unhandledRejection', (error) => {
  console.error('⚠️ [Unhandled Rejection]:', error);
});

process.on('uncaughtException', (error) => {
  console.error('⚠️ [Uncaught Exception]:', error);
});

// 8. Đăng nhập Bot
const botToken = process.env.TOKEN || process.env.DISCORD_TOKEN;
if (!botToken) {
  console.error('❌ Không tìm thấy TOKEN bot trong Environment Variables!');
} else {
  client.login(botToken).catch((err) => {
    console.error('❌ Lỗi đăng nhập Bot:', err);
  });
}
