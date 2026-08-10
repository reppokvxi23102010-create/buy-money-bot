const http = require('http');
require('dotenv').config();
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
  PermissionFlagsBits 
} = require('discord.js');
const fs = require('fs');
const path = require('path');

// 1. Tạo HTTP Web Server nhẹ để Render kiểm tra Port (tránh sập service)
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.write('Bot Discord đang hoạt động!');
  res.end();
}).listen(PORT, () => {
  console.log(`[HTTP] Server đang chạy trên port ${PORT}`);
});

// 2. Khởi tạo Bot Discord
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

  if (!token || !clientId) {
    console.error('❌ Thiếu TOKEN hoặc CLIENT_ID trong Environment Variables trên Render!');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log('🔄 Đang đăng ký Slash Commands...');
    await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands }
    );
    console.log('✅ Đăng ký Slash Commands thành công!');
  } catch (error) {
    console.error('❌ Lỗi khi đăng ký Slash Commands:', error);
  }
}

// 5. Sự kiện khi Bot kết nối thành công
client.once('ready', async () => {
  console.log(`🤖 Bot đã online: ${client.user.tag}`);
  await registerCommands();
});

// 6. Xử lý khi người dùng tương tác (Lệnh Slash, Button, Modal)
client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'ping') {
        await interaction.reply(`Pong! 🏓 Độ trễ: ${client.ws.ping}ms`);
      }
    }
  } catch (error) {
    console.error('❌ Lỗi xử lý Interaction:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Có lỗi xảy ra khi xử lý lệnh này!', ephemeral: true });
    }
  }
});

// 7. Đăng nhập Bot
const botToken = process.env.TOKEN || process.env.DISCORD_TOKEN;
if (!botToken) {
  console.error('❌ Không tìm thấy TOKEN bot!');
} else {
  client.login(botToken);
}
