require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  MessageFlags, PermissionsBitField, ChannelType, Events
} = require('discord.js');

// ============================================================
// 1. WEB SERVER
// ============================================================
const PORT = Number(process.env.PORT) || 10000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('SMP BOT AutoBuy Money + Account đang hoạt động 24/7!');
}).listen(PORT, () => console.log(`[HTTP] Server running on port ${PORT}`));

// ============================================================
// 2. DISCORD CLIENT
// ============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ============================================================
// 3. CONFIG & DATA PERSISTENCE
// ============================================================
const TIMEZONE = 'Asia/Ho_Chi_Minh';
const CARD_DISCOUNT = 0.20;
const BANK_CONFIG = {
  BANK_ID: process.env.BANK_ID || 'MB',
  ACCOUNT_NO: process.env.BANK_ACCOUNT_NO || '',
  ACCOUNT_NAME: process.env.BANK_ACCOUNT_NAME || ''
};

const STOCK_FILE = path.join(__dirname, 'stock.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const ACC_STOCK_FILE = path.join(__dirname, 'accounts.json');
const ACC_DETAIL_FILE = path.join(__dirname, 'accounts_detail.json');
const ORDERS_FILE = path.join(__dirname, 'money_orders.json');

function ensureJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback, null, 2), 'utf8');
  } catch (e) {
    console.error('[JSON CREATE ERROR]', file, e.message);
  }
}

function readJson(file, fallback) {
  try {
    ensureJson(file, fallback);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('[JSON READ ERROR]', file, e.message);
    return fallback;
  }
}

function writeJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[JSON WRITE ERROR]', file, e.message);
    return false;
  }
}

let config = readJson(CONFIG_FILE, {});
let stockM = Number(readJson(STOCK_FILE, { stockM: 5000 }).stockM) || 0;
let RATE = Number(config.rate) > 0 ? Number(config.rate) : 130;

let schedule = {
  startHour: Number.isInteger(Number(config.schedule?.startHour)) ? Number(config.schedule.startHour) : 10,
  startMinute: Number.isInteger(Number(config.schedule?.startMinute)) ? Number(config.schedule.startMinute) : 0,
  endHour: Number.isInteger(Number(config.schedule?.endHour)) ? Number(config.schedule.endHour) : 22,
  endMinute: Number.isInteger(Number(config.schedule?.endMinute)) ? Number(config.schedule.endMinute) : 0
};

function saveConfig() { writeJson(CONFIG_FILE, config); }
function saveStock() { writeJson(STOCK_FILE, { stockM: Math.max(0, Number(stockM) || 0) }); }
function orders() { return readJson(ORDERS_FILE, {}); }
function saveOrders(x) { writeJson(ORDERS_FILE, x); }
function accStock() { return readJson(ACC_STOCK_FILE, []); }
function saveAccStock(x) { writeJson(ACC_STOCK_FILE, x); }
function accs() { return readJson(ACC_DETAIL_FILE, []); }
function saveAccs(x) { writeJson(ACC_DETAIL_FILE, x); }

// ============================================================
// 4. TIME SCHEDULE LOGIC
// ============================================================
function normalizeSchedule() {
  schedule.startHour = Math.max(0, Math.min(23, Number(schedule.startHour) || 0));
  schedule.startMinute = Math.max(0, Math.min(59, Number(schedule.startMinute) || 0));
  schedule.endHour = Math.max(0, Math.min(23, Number(schedule.endHour) || 0));
  schedule.endMinute = Math.max(0, Math.min(59, Number(schedule.endMinute) || 0));
}
normalizeSchedule();

function vnNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const h = Number(parts.find(x => x.type === 'hour')?.value || 0);
  const m = Number(parts.find(x => x.type === 'minute')?.value || 0);
  return { hour: h, minute: m, total: h * 60 + m };
}

function fmtTime(h, m) { return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
function scheduleText() { return `${fmtTime(schedule.startHour, schedule.startMinute)} → ${fmtTime(schedule.endHour, schedule.endMinute)}`; }

function working() {
  const now = vnNow();
  const s = schedule.startHour * 60 + schedule.startMinute;
  const e = schedule.endHour * 60 + schedule.endMinute;
  if (s === e) return false;
  if (s < e) return now.total >= s && now.total < e;
  return now.total >= s || now.total < e;
}

function scheduleStatus() { return working() ? '🟢 ĐANG TRONG GIỜ HOẠT ĐỘNG' : '🔴 ĐANG NGOÀI GIỜ HOẠT ĐỘNG'; }

// ============================================================
// 5. GENERAL HELPERS & FORMATTERS
// ============================================================
function isAdmin(i) {
  const byId = Boolean(process.env.ADMIN_DISCORD_ID && i.user?.id === process.env.ADMIN_DISCORD_ID);
  const byPerm = Boolean(i.memberPermissions?.has(PermissionsBitField.Flags.Administrator));
  return byId || byPerm;
}

function adminOverwrites() {
  return process.env.ADMIN_DISCORD_ID
    ? [{ id: process.env.ADMIN_DISCORD_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.ManageChannels] }]
    : [];
}

function formatStock(x) {
  x = Number(x) || 0;
  if (x <= 0) return '🔴 HẾT HÀNG (0M$)';
  if (x >= 1000) return `${(x / 1000).toFixed(2)}B$ (${x.toLocaleString('vi-VN')}M$)`;
  return `${x.toLocaleString('vi-VN')}M$`;
}

function parseCardValue(v) {
  if (!v) return 0;
  let s = String(v).trim().toLowerCase().replace(/\s/g, '');
  let mul = 1;
  if (s.endsWith('k')) { mul = 1000; s = s.slice(0, -1); }
  else if (s.endsWith('m')) { mul = 1000000; s = s.slice(0, -1); }
  s = s.replace(/,/g, '').replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.floor(n * mul) : 0;
}

function parseMoneyM(v) {
  if (!v) return 0;
  let s = String(v).trim().toLowerCase().replace(/\s/g, '').replace(/,/g, '');
  const orig = s;
  let mul = 1;
  if (s.endsWith('b')) { mul = 1000; s = s.slice(0, -1); }
  else if (s.endsWith('m')) { s = s.slice(0, -1); }
  else if (s.endsWith('k')) { mul = 0.001; s = s.slice(0, -1); }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (/[bmk]$/.test(orig)) return n * mul;
  return n >= 10000 ? n / 1000000 : n;
}

async function reply(i, data) { try { return i.replied || i.deferred ? await i.followUp(data) : await i.reply(data); } catch (e) { console.error('[REPLY ERROR]', e.message); } }
async function defer(i, data = {}) { try { if (i.replied || i.deferred) return true; await i.deferReply(data); return true; } catch (e) { console.error('[DEFER ERROR]', e.message); return false; } }
async function deferUpdate(i) { try { if (i.replied || i.deferred) return true; await i.deferUpdate(); return true; } catch (e) { console.error('[DEFER UPDATE ERROR]', e.message); return false; } }
async function edit(i, data) { try { return i.replied || i.deferred ? await i.editReply(data) : await i.reply(data); } catch (e) { console.error('[EDIT ERROR]', e.message); } }

// ============================================================
// 6. MONEY PANEL SYSTEM
// ============================================================
function moneyPanel() {
  const canBuy = working() && stockM > 0;
  const status = !working() ? '🔴 NGOÀI GIỜ HOẠT ĐỘNG' : stockM <= 0 ? '🔴 HẾT KHO MONEY' : '🟢 HOẠT ĐỘNG';
  const embed = new EmbedBuilder()
    .setColor(canBuy ? '#2ecc71' : '#e74c3c')
    .setTitle('🛒 HỆ THỐNG AUTO BUY MONEY KINGSMP')
    .setDescription(
      `🟢 **Trạng thái:** ${status}\n` +
      `🕐 **Giờ hoạt động:** \`${scheduleText()}\`\n` +
      `🇻🇳 **Múi giờ:** \`${TIMEZONE}\`\n` +
      `💸 **Tỷ giá:** \`${RATE} VNĐ = 1M$\`\n` +
      `🎟️ **Thẻ cào:** Trừ ${CARD_DISCOUNT * 100}%\n` +
      `📦 **Kho:** \`${formatStock(stockM)}\`\n\n` +
      (!working() ? '🌙 Bot hiện đang ngoài giờ hoạt động.' : stockM <= 0 ? '⚠️ Kho đã hết Money.' : '💰 Chọn phương thức mua bên dưới:')
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('buy_bank').setLabel('Mua Bằng Ngân Hàng').setEmoji('💵').setStyle(ButtonStyle.Success).setDisabled(!canBuy),
    new ButtonBuilder().setCustomId('buy_card').setLabel('Mua Bằng Thẻ Cào (-20%)').setEmoji('🎟️').setStyle(ButtonStyle.Primary).setDisabled(!canBuy),
    new ButtonBuilder().setCustomId('calc_price').setLabel('Tính Tiền').setEmoji('🧮').setStyle(ButtonStyle.Secondary).setDisabled(!canBuy),
    new ButtonBuilder().setCustomId('guide').setLabel('Hướng Dẫn').setEmoji('📖').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row] };
}

async function updatePanel() {
  if (!config.channelId) return;
  try {
    const ch = await client.channels.fetch(String(config.channelId));
    if (!ch?.isTextBased()) return;
    if (config.messageId) {
      try {
        const msg = await ch.messages.fetch(String(config.messageId));
        await msg.edit(moneyPanel());
        return;
      } catch (e) {
        if (!['10008', '10003'].includes(String(e.code)) && !String(e.message).toLowerCase().includes('unknown message')) {
          console.error('[PANEL EDIT ERROR]', e.message);
          return;
        }
      }
    }
    const msg = await ch.send(moneyPanel());
    config.messageId = msg.id;
    saveConfig();
  } catch (e) {
    console.error('[PANEL UPDATE ERROR]', e.message);
  }
}

// ============================================================
// 7. COMMAND HANDLERS
// ============================================================
async function handleTime(i) {
  if (!isAdmin(i)) return reply(i, { content: '❌ Chỉ Admin mới được chỉnh giờ!', flags: MessageFlags.Ephemeral });
  schedule = {
    startHour: i.options.getInteger('start_hour', true),
    startMinute: i.options.getInteger('start_minute', true),
    endHour: i.options.getInteger('end_hour', true),
    endMinute: i.options.getInteger('end_minute', true)
  };
  normalizeSchedule();
  config.schedule = { ...schedule };
  saveConfig();
  await updatePanel();
  const n = vnNow();
  return reply(i, {
    content: `✅ **Đã đổi giờ hoạt động!**\n\n🕐 **Giờ:** \`${scheduleText()}\`\n🕒 **Giờ VN hiện tại:** \`${fmtTime(n.hour, n.minute)}\`\n${scheduleStatus()}`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleMoneyCommand(i) {
  if (!isAdmin(i)) return reply(i, { content: '❌ Bạn không có quyền Administrator!', flags: MessageFlags.Ephemeral });
  if (i.commandName === 'setup') {
    if (!await defer(i, { flags: MessageFlags.Ephemeral })) return;
    const msg = await i.channel.send(moneyPanel());
    config.channelId = i.channelId;
    config.messageId = msg.id;
    saveConfig();
    return edit(i, { content: '✅ Đã thiết lập AutoBuy Panel!' });
  }
  if (i.commandName === 'setstock') {
    if (!await defer(i, { flags: MessageFlags.Ephemeral })) return;
    const x = parseMoneyM(i.options.getString('amount', true));
    if (x <= 0) return edit(i, { content: '❌ Stock không hợp lệ. Ví dụ: `500m`, `10b`.' });
    stockM = x;
    saveStock();
    await updatePanel();
    return edit(i, { content: `✅ Kho hiện tại: **${formatStock(stockM)}**` });
  }
  if (i.commandName === 'rate') {
    if (!await defer(i, { flags: MessageFlags.Ephemeral })) return;
    RATE = i.options.getInteger('value', true);
    config.rate = RATE;
    saveConfig();
    await updatePanel();
    return edit(i, { content: `✅ Rate mới: **${RATE}đ / 1M$**` });
  }
}

// ============================================================
// 8. MONEY INTERACTION HANDLERS (MODALS & BUTTONS)
// ============================================================
async function openMoneyModal(i, id) {
  if (!working()) return reply(i, { content: `🌙 Bot đang ngoài giờ. Giờ hoạt động: **${scheduleText()}**`, flags: MessageFlags.Ephemeral });
  if (stockM <= 0 && id !== 'guide') return reply(i, { content: '🔴 Hệ thống đang hết kho Money.', flags: MessageFlags.Ephemeral });

  if (id === 'buy_bank') {
    const m = new ModalBuilder().setCustomId('modal_bank').setTitle(`Mua Bank - ${RATE}đ/1M`).addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bank_name').setLabel('Tên Ingame').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bank_vnd').setLabel('Số tiền nạp').setPlaceholder('Ví dụ 10k, 20k').setStyle(TextInputStyle.Short).setRequired(true))
    );
    return i.showModal(m);
  }
  if (id === 'buy_card') {
    const m = new ModalBuilder().setCustomId('modal_card').setTitle(`Nạp Thẻ - ${RATE}đ/1M`).addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_ign').setLabel('Tên Ingame').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_type').setLabel('Loại thẻ').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_val').setLabel('Mệnh giá').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_code').setLabel('Mã thẻ').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_seri').setLabel('Seri').setStyle(TextInputStyle.Short).setRequired(true))
    );
    return i.showModal(m);
  }
  if (id === 'calc_price') {
    const m = new ModalBuilder().setCustomId('modal_calc').setTitle('Tính Tiền').addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('calc_money').setLabel('Money (b/m/k)').setStyle(TextInputStyle.Short).setRequired(true))
    );
    return i.showModal(m);
  }
  if (id === 'guide') {
    return reply(i, {
      content: `📖 **HƯỚNG DẪN MUA MONEY**\n💸 Rate: **${RATE}đ = 1M$**\n🎟️ Card: **Chiết khấu -20%**\n📦 Kho còn: **${formatStock(stockM)}**\n🕐 Giờ hoạt động: **${scheduleText()}**`,
      flags: MessageFlags.Ephemeral
    });
  }
}

async function handleMoneyModal(i) {
  if (i.customId === 'modal_calc') {
    const raw = i.fields.getTextInputValue('calc_money');
    const m = parseMoneyM(raw);
    if (m <= 0) return reply(i, { content: '❌ Money không hợp lệ.', flags: MessageFlags.Ephemeral });
    const bank = Math.round(m * RATE);
    const card = Math.round(bank / (1 - CARD_DISCOUNT));
    return reply(i, {
      content: `🧮 **TÍNH GIÁ MONEY**\n• Số lượng: **${m.toLocaleString('vi-VN')}M$**\n💵 Chuyển khoản (Bank): **${bank.toLocaleString('vi-VN')} VNĐ**\n🎟️ Thẻ cào (Card): **${card.toLocaleString('vi-VN')} VNĐ**`,
      flags: MessageFlags.Ephemeral
    });
  }

  if (!await defer(i, { flags: MessageFlags.Ephemeral })) return;
  const o = orders();
  let id = '';
  let data = {};
  let embed;
  let prefix = '';

  if (i.customId === 'modal_bank') {
    const ign = i.fields.getTextInputValue('bank_name').trim();
    const vnd = parseCardValue(i.fields.getTextInputValue('bank_vnd'));
    const amount = Math.floor(vnd / RATE);

    if (vnd < 1000 || amount <= 0) return edit(i, { content: '❌ Số tiền nhập vào không hợp lệ hoặc quá thấp.' });
    if (amount > stockM) return edit(i, { content: `❌ Kho không đủ Money. Kho hiện tại: ${formatStock(stockM)}.` });

    id = `M${Date.now()}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    prefix = 'bank';
    data = { ign, vndAmount: vnd, amountM: amount };

    const memo = `KSMP ${ign}`;
    const qr = `https://img.vietqr.io/image/${BANK_CONFIG.BANK_ID}-${BANK_CONFIG.ACCOUNT_NO}-compact2.png?amount=${vnd}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(BANK_CONFIG.ACCOUNT_NAME)}`;

    embed = new EmbedBuilder()
      .setTitle('💳 THÔNG TIN CHUYỂN KHOẢN BANK')
      .setColor('#3498db')
      .setDescription('Chuyển tiền theo mã QR bên dưới, sau đó chụp bill gửi vào Ticket này.')
      .addFields(
        { name: '👤 Ingame', value: `\`${ign}\``, inline: true },
        { name: '💰 Money mua', value: `\`${amount.toLocaleString('vi-VN')}M$\``, inline: true },
        { name: '💵 Số tiền', value: `\`${vnd.toLocaleString('vi-VN')} VNĐ\``, inline: true },
        { name: '🏦 Ngân hàng', value: `\`${BANK_CONFIG.BANK_ID}\` - STK: \`${BANK_CONFIG.ACCOUNT_NO || 'Chưa cấu hình'}\`` },
        { name: '👤 Chủ TK', value: `\`${BANK_CONFIG.ACCOUNT_NAME || 'Chưa cấu hình'}\`` },
        { name: '📌 Nội dung', value: `\`${memo}\`` }
      )
      .setImage(qr)
      .setFooter({ text: `Mã đơn hàng: ${id}` });
  } else {
    const ign = i.fields.getTextInputValue('card_ign').trim();
    const type = i.fields.getTextInputValue('card_type').trim();
    const val = parseCardValue(i.fields.getTextInputValue('card_val'));
    const pin = i.fields.getTextInputValue('card_code').trim();
    const seri = i.fields.getTextInputValue('card_seri').trim();
    const net = Math.floor(val * (1 - CARD_DISCOUNT));
    const amount = Math.floor(net / RATE);

    if (val < 1000 || amount <= 0) return edit(i, { content: '❌ Thẻ không hợp lệ hoặc mệnh giá quá thấp.' });
    if (amount > stockM) return edit(i, { content: `❌ Kho không đủ Money. Kho hiện tại: ${formatStock(stockM)}.` });

    id = `C${Date.now()}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    prefix = 'card';
    data = { ign, cardType: type, cardValueVnd: val, netVnd: net, amountM: amount, cardCode: pin, cardSeri: seri };

    embed = new EmbedBuilder()
      .setTitle('🎟️ THÔNG TIN ĐƠN NẠP THẺ CÀO')
      .setColor('#f1c40f')
      .setDescription('Admin sẽ kiểm tra thẻ và cộng Money cho bạn trong ít phút.')
      .addFields(
        { name: '👤 Ingame', value: `\`${ign}\``, inline: true },
        { name: '💳 Loại thẻ', value: `\`${type}\``, inline: true },
        { name: '💵 Mệnh giá', value: `\`${val.toLocaleString('vi-VN')} VNĐ\``, inline: true },
        { name: '💰 Money thực nhận', value: `\`${amount.toLocaleString('vi-VN')}M$\``, inline: true },
        { name: '🔑 Mã thẻ', value: `\`${pin}\`` },
        { name: '🔢 Seri', value: `\`${seri}\`` }
      )
      .setFooter({ text: `Mã đơn hàng: ${id}` });
  }

  o[id] = { id, type: prefix, userId: i.user.id, username: i.user.username, status: 'pending', createdAt: Date.now(), ...data };
  saveOrders(o);

  try {
    const safe = String(data.ign).toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 60) || 'user';
    const ch = await i.guild.channels.create({
      name: `ticket-${prefix}-${safe}`,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: i.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: i.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] },
        ...adminOverwrites()
      ]
    });

    await ch.setTopic(`moneyOrder:${id}`);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`money_approve_${id}`).setLabel(prefix === 'bank' ? 'Duyệt Đơn' : 'Duyệt Thẻ').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`money_reject_${id}`).setLabel('Từ Chối').setEmoji('❌').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
    );

    await ch.send({ content: `<@${i.user.id}>`, embeds: [embed], components: [row] });
    o[id].ticketChannelId = ch.id;
    o[id].ticketUrl = `https://discord.com/channels/${i.guild.id}/${ch.id}`;
    saveOrders(o);

    return edit(i, { content: `✅ **Đã tạo Ticket thành công!**\n👉 Link kênh: ${ch}\n🆔 Mã đơn: \`${id}\`` });
  } catch (e) {
    delete o[id];
    saveOrders(o);
    return edit(i, { content: `❌ Không thể tạo Ticket: \`${e.message}\`` });
  }
}

// Xử lý nút Duyệt / Từ chối đơn Money (Bank / Card)
async function handleMoneyOrderAction(i) {
  if (!isAdmin(i)) return reply(i, { content: '❌ Chỉ Admin mới có quyền thực hiện!', flags: MessageFlags.Ephemeral });
  const isApprove = i.customId.startsWith('money_approve_');
  const orderId = i.customId.replace(isApprove ? 'money_approve_' : 'money_reject_', '');
  const o = orders();
  const order = o[orderId];

  if (!order) return reply(i, { content: '❌ Không tìm thấy thông tin đơn hàng này trong hệ thống.', flags: MessageFlags.Ephemeral });
  if (order.status !== 'pending') return reply(i, { content: `⚠️ Đơn hàng này đã được xử lý trước đó (${order.status}).`, flags: MessageFlags.Ephemeral });

  if (isApprove) {
    if (stockM < order.amountM) {
      return reply(i, { content: `❌ Kho Money không đủ để duyệt đơn (${formatStock(stockM)} < ${order.amountM}M$).`, flags: MessageFlags.Ephemeral });
    }
    stockM -= order.amountM;
    saveStock();
    order.status = 'approved';
    order.approvedAt = Date.now();
    order.approvedBy = i.user.id;
    saveOrders(o);
    await updatePanel();

    await i.channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('🎉 DUYỆT ĐƠN THÀNH CÔNG')
          .setColor('#2ecc71')
          .setDescription(`Đã giao thành công **${order.amountM.toLocaleString('vi-VN')}M$** cho ingame \`${order.ign}\`.\nKho Money còn lại: **${formatStock(stockM)}**`)
          .setFooter({ text: `Duyệt bởi Admin: ${i.user.tag}` })
      ]
    });
  } else {
    order.status = 'rejected';
    order.rejectedAt = Date.now();
    order.rejectedBy = i.user.id;
    saveOrders(o);

    await i.channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('❌ ĐƠN HÀNG BỊ TỪ CHỐI')
          .setColor('#e74c3c')
          .setDescription(`Đơn hàng của \`${order.ign}\` đã bị từ chối. Vui lòng liên hệ Admin nếu có thắc mắc.`)
          .setFooter({ text: `Từ chối bởi Admin: ${i.user.tag}` })
      ]
    });
  }
  return reply(i, { content: `✅ Đã ${isApprove ? 'duyệt' : 'từ chối'} đơn \`${orderId}\`!`, flags: MessageFlags.Ephemeral });
}

// ============================================================
// 9. ACCOUNT SYSTEM HANDLERS
// ============================================================
function makeAccEmbed(a) {
  const e = new EmbedBuilder()
    .setColor(a.status === 'available' ? '#2ecc71' : a.status === 'pending' ? '#f1c40f' : '#e74c3c')
    .setTitle(`🎮 Minecraft Acc: ${a.username}`)
    .setDescription(
      `🏷️ **Giá Bank:** \`${Number(a.priceBank || 0).toLocaleString('vi-VN')} VNĐ\`\n` +
      `🎟️ **Giá Card:** \`${Number(a.priceCard || 0).toLocaleString('vi-VN')} VNĐ\`\n` +
      `✅ **Trạng thái:** **${a.status === 'available' ? '🟢 Có Sẵn' : a.status === 'pending' ? '🟡 Đang Có Người Mua' : '🔴 Đã Bán'}**`
    )
    .addFields(
      { name: 'Username', value: `\`${a.username}\``, inline: true },
      { name: 'Số Cape', value: `\`${a.capeCount}\``, inline: true },
      { name: 'Danh sách Cape', value: `\`${a.capeList || 'Không'}\``, inline: true },
      { name: 'Rank Ingame', value: `\`${a.rank}\`` }
    );
  if (a.imageUrl) e.setImage(a.imageUrl);
  return e;
}

async function updateAccListing(a) {
  if (!a?.channelId || !a?.messageId) return;
  try {
    const ch = await client.channels.fetch(String(a.channelId));
    const msg = await ch.messages.fetch(String(a.messageId));
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(a.status === 'available' ? `buy_single_${a.id}` : `sold_${a.id}`)
        .setLabel(a.status === 'available' ? 'Mua Ngay' : '🔴 Đã Bán')
        .setStyle(a.status === 'available' ? ButtonStyle.Success : ButtonStyle.Danger)
        .setDisabled(a.status !== 'available')
    );
    await msg.edit({ embeds: [makeAccEmbed(a)], components: [row] });
  } catch (e) {
    console.error('[ACC LISTING UPDATE ERROR]', e.message);
  }
}

async function handleAccCommand(i) {
  if (!isAdmin(i)) return reply(i, { content: '❌ Bạn không có quyền!', flags: MessageFlags.Ephemeral });

  if (i.commandName === 'setstockacc') {
    if (!await defer(i, { flags: MessageFlags.Ephemeral })) return;
    const raw = i.options.getString('danh_sach', true);
    const lines = raw.split('\n').map(x => x.trim()).filter(Boolean);
    const s = accStock();
    let count = 0;
    for (const line of lines) {
      const p = line.split('|').map(x => x.trim());
      if (p.length >= 2) {
        s.push({
          id: `stock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: p[0],
          email: p[1],
          recoveryCode: p[2] || 'Không có'
        });
        count++;
      }
    }
    saveAccStock(s);
    return edit(i, { content: `✅ Đã thêm **${count} acc** vào kho. Kho hiện tại: **${s.length} acc**.` });
  }

  if (i.commandName === 'acc' || i.commandName === 'deleteacc') {
    if (!await defer(i, { flags: MessageFlags.Ephemeral })) return;
    const s = accStock();
    if (!s.length) return edit(i, { content: '❌ Kho Account đang trống.' });
    const menu = new StringSelectMenuBuilder()
      .setCustomId(i.commandName === 'acc' ? 'select_stock_acc_manual' : 'select_delete_acc_menu')
      .setPlaceholder(i.commandName === 'acc' ? '📦 Chọn acc muốn lấy thông tin' : '🗑️ Chọn acc muốn xóa khỏi kho')
      .addOptions(s.slice(0, 25).map(x => new StringSelectMenuOptionBuilder().setLabel(String(x.name || 'Không tên').slice(0, 100)).setDescription(String(x.email || 'Không email').slice(0, 90)).setValue(String(x.id))));
    return edit(i, { content: `📦 Kho Account hiện có: **${s.length}**`, components: [new ActionRowBuilder().addComponents(menu)] });
  }

  if (i.commandName === 'thongtin') {
    if (!await defer(i, { flags: MessageFlags.Ephemeral })) return;
    const a = accs();
    const x = {
      id: `acc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      username: i.options.getString('username', true).trim(),
      priceBank: i.options.getInteger('price_bank', true),
      priceCard: i.options.getInteger('price_card', true),
      capeCount: i.options.getInteger('cape_count', true),
      capeList: i.options.getString('cape_list', true).trim(),
      rank: i.options.getString('rank', true),
      imageUrl: i.options.getString('image_url') || null,
      status: 'available',
      channelId: i.channelId,
      messageId: null,
      pendingTicketId: null,
      pendingBuyerId: null
    };
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`buy_single_${x.id}`).setLabel('Mua Ngay').setEmoji('🛒').setStyle(ButtonStyle.Success));
    const msg = await i.channel.send({ embeds: [makeAccEmbed(x)], components: [row] });
    x.messageId = msg.id;
    a.push(x);
    saveAccs(a);
    return edit(i, { content: `✅ Đã đăng bài bán Acc \`${x.username}\` thành công!` });
  }

  if (i.commandName === 'price' || i.commandName === 'cape') {
    if (!await defer(i, { flags: MessageFlags.Ephemeral })) return;
    const name = i.options.getString('username', true).trim();
    const a = accs();
    const x = a.find(v => String(v.username).toLowerCase() === name.toLowerCase());
    if (!x) return edit(i, { content: `❌ Không tìm thấy Acc nào có tên \`${name}\`.` });

    if (i.commandName === 'price') {
      x.priceBank = i.options.getInteger('price_bank', true);
      x.priceCard = i.options.getInteger('price_card', true);
    } else {
      x.capeCount = i.options.getInteger('cape_count', true);
      x.capeList = i.options.getString('cape_list', true).trim();
    }
    saveAccs(a);
    await updateAccListing(x);
    return edit(i, { content: '✅ Đã cập nhật thông tin thành công.' });
  }
}

async function handleAccSelect(i) {
  if (!isAdmin(i)) return reply(i, { content: '❌ Bạn không có quyền!', flags: MessageFlags.Ephemeral });
  if (!await deferUpdate(i)) return;
  const id = i.values[0];
  const s = accStock();
  const idx = s.findIndex(x => String(x.id) === String(id));
  if (idx < 0) return edit(i, { content: '❌ Acc này không còn tồn tại trong kho!', components: [] });

  if (i.customId === 'select_delete_acc_menu') {
    const [x] = s.splice(idx, 1);
    saveAccStock(s);
    return edit(i, { content: `✅ Đã xóa acc \`${x.name}\`. Kho còn lại **${s.length} acc**.`, components: [] });
  }

  const [x] = s.splice(idx, 1);
  saveAccStock(s);
  const e = new EmbedBuilder().setTitle(`🔑 Thông tin Acc: ${x.name}`).setColor('#3498db').addFields(
    { name: 'Email', value: `\`${x.email}\`` },
    { name: 'Mã Phục Hồi (Recovery)', value: `\`${x.recoveryCode}\`` }
  );
  return edit(i, { content: `✅ Đã lấy acc \`${x.name}\` ra khỏi kho.`, embeds: [e], components: [] });
}

async function handleAccButton(i) {
  const id = i.customId;
  if (id === 'approve_bill') {
    if (!isAdmin(i)) return reply(i, { content: '❌ Chỉ Admin mới có quyền duyệt bill!', flags: MessageFlags.Ephemeral });
    if (!await defer(i, { flags: MessageFlags.Ephemeral })) return;
    const topic = i.channel?.topic || '';
    if (!topic.startsWith('accOrder:')) return edit(i, { content: '❌ Kênh Ticket này không phải đơn mua Account.' });
    const aid = topic.replace('accOrder:', '');
    const list = accs();
    const product = list.find(x => x.id === aid);
    if (!product) return edit(i, { content: '❌ Không tìm thấy sản phẩm Account tương ứng.' });

    const s = accStock();
    if (!s.length) return edit(i, { content: '❌ Kho Account đang trống, không có acc để giao.' });

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`select_deliver_acc_${i.message.id}`)
      .setPlaceholder('📦 Chọn acc trong kho để giao cho khách')
      .addOptions(s.slice(0, 25).map(x => new StringSelectMenuOptionBuilder().setLabel(String(x.name || 'Không tên').slice(0, 100)).setDescription(String(x.email || '').slice(0, 90)).setValue(String(x.id))));
    return edit(i, { content: `📦 Kho đang có **${s.length} acc**. Chọn 1 acc bên dưới để giao:`, components: [new ActionRowBuilder().addComponents(menu)] });
  }

  if (id === 'reject_bill') {
    if (!isAdmin(i)) return reply(i, { content: '❌ Chỉ Admin!', flags: MessageFlags.Ephemeral });
    if (!await deferUpdate(i)) return;
    return i.channel.send('⚠️ **Bill chưa hợp lệ hoặc chuyển thiếu tiền. Vui lòng kiểm tra và gửi lại!**');
  }

  if (id.startsWith('buy_single_')) {
    if (!working()) return reply(i, { content: `🌙 Ngoài giờ hoạt động. Giờ: **${scheduleText()}**`, flags: MessageFlags.Ephemeral });
    if (!await defer(i, { flags: MessageFlags.Ephemeral })) return;
    const aid = id.replace('buy_single_', '');
    const list = accs();
    const product = list.find(x => x.id === aid);
    if (!product || product.status !== 'available') return edit(i, { content: '❌ Acc này hiện không còn sẵn để mua.' });

    try {
      const safe = i.user.username.toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 60) || 'user';
      const ch = await i.guild.channels.create({
        name: `ticket-acc-${safe}`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: i.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: i.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] },
          ...adminOverwrites()
        ]
      });

      await ch.setTopic(`accOrder:${product.id}`);
      product.status = 'pending';
      product.pendingTicketId = ch.id;
      product.pendingBuyerId = i.user.id;
      saveAccs(list);

      const qr = `https://img.vietqr.io/image/${BANK_CONFIG.BANK_ID}-${BANK_CONFIG.ACCOUNT_NO}-compact2.png?amount=${product.priceBank}&addInfo=${encodeURIComponent(`THANH TOAN DON HANG ${product.username}`)}&accountName=${encodeURIComponent(BANK_CONFIG.ACCOUNT_NAME)}`;
      const e = new EmbedBuilder()
        .setTitle(`💳 THANH TOÁN MUA ACC: ${product.username}`)
        .setColor('#2ecc71')
        .addFields(
          { name: 'Giá Bank', value: `\`${product.priceBank.toLocaleString('vi-VN')} VNĐ\``, inline: true },
          { name: 'Giá Card', value: `\`${product.priceCard.toLocaleString('vi-VN')} VNĐ\``, inline: true },
          { name: 'Số TK Admin', value: `\`${BANK_CONFIG.ACCOUNT_NO || 'Chưa cấu hình'}\`` }
        )
        .setImage(qr);

      await ch.send({
        content: `<@${i.user.id}>`,
        embeds: [e],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('approve_bill').setLabel('Duyệt - Chọn Acc Giao').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('reject_bill').setLabel('Từ Chối Bill').setStyle(ButtonStyle.Danger)
          )
        ]
      });

      return edit(i, { content: `✅ Đã tạo Ticket mua Acc thành công!\n👉 Kênh mua: ${ch}` });
    } catch (e) {
      product.status = 'available';
      product.pendingTicketId = null;
      product.pendingBuyerId = null;
      saveAccs(list);
      return edit(i, { content: `❌ Lỗi khi tạo Ticket: \`${e.message}\`` });
    }
  }
}

async function handleDeliver(i) {
  if (!isAdmin(i)) return reply(i, { content: '❌ Chỉ Admin!', flags: MessageFlags.Ephemeral });
  if (!await deferUpdate(i)) return;
  const topic = i.channel?.topic || '';
  if (!topic.startsWith('accOrder:')) return edit(i, { content: '❌ Ticket không hợp lệ.', components: [] });

  const aid = topic.replace('accOrder:', '');
  const list = accs();
  const product = list.find(x => x.id === aid);
  if (!product) return edit(i, { content: '❌ Không tìm thấy sản phẩm.', components: [] });

  const s = accStock();
  const idx = s.findIndex(x => String(x.id) === String(i.values[0]));
  if (idx < 0) return edit(i, { content: '❌ Acc được chọn không còn trong kho.', components: [] });

  const [x] = s.splice(idx, 1);
  saveAccStock(s);

  product.status = 'sold';
  product.pendingTicketId = null;
  product.pendingBuyerId = null;
  product.soldAt = Date.now();
  saveAccs(list);

  await updateAccListing(product);

  await i.channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle('🎉 GIAO ACC THÀNH CÔNG')
        .setColor('#2ecc71')
        .addFields(
          { name: 'Tên Minecraft', value: `\`${x.name}\`` },
          { name: 'Email / Account', value: `\`${x.email}\`` },
          { name: 'Mã Phục Hồi (Recovery)', value: `\`${x.recoveryCode}\`` }
        )
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setStyle(ButtonStyle.Danger)
      )
    ]
  });

  return edit(i, { content: `✅ Đã giao thành công acc \`${x.name}\` cho khách!`, components: [] });
}

// ============================================================
// 10. SLASH COMMAND BUILDERS & REGISTRATION
// ============================================================
const moneyNames = ['setup', 'setstock', 'rate'];
const accNames = ['setstockacc', 'acc', 'deleteacc', 'thongtin', 'price', 'cape'];

const commands = [
  new SlashCommandBuilder().setName('setup').setDescription('Tạo AutoBuy Panel'),
  new SlashCommandBuilder().setName('setstock').setDescription('Đổi kho Money').addStringOption(o => o.setName('amount').setDescription('Ví dụ: 500m, 10b').setRequired(true)),
  new SlashCommandBuilder().setName('rate').setDescription('Đổi Rate Money').addIntegerOption(o => o.setName('value').setDescription('Rate VNĐ/1M$').setMinValue(1).setRequired(true)),
  new SlashCommandBuilder().setName('time').setDescription('Đổi giờ hoạt động').addIntegerOption(o => o.setName('start_hour').setDescription('0-23').setMinValue(0).setMaxValue(23).setRequired(true)).addIntegerOption(o => o.setName('start_minute').setDescription('0-59').setMinValue(0).setMaxValue(59).setRequired(true)).addIntegerOption(o => o.setName('end_hour').setDescription('0-23').setMinValue(0).setMaxValue(23).setRequired(true)).addIntegerOption(o => o.setName('end_minute').setDescription('0-59').setMinValue(0).setMaxValue(59).setRequired(true)),
  new SlashCommandBuilder().setName('setstockacc').setDescription('Thêm acc vào kho').addStringOption(o => o.setName('danh_sach').setDescription('Định dạng: Tên|Email|Recovery (mỗi acc 1 dòng)').setRequired(true)),
  new SlashCommandBuilder().setName('acc').setDescription('Xem kho acc hiện có'),
  new SlashCommandBuilder().setName('deleteacc').setDescription('Xóa acc khỏi kho'),
  new SlashCommandBuilder().setName('thongtin').setDescription('Đăng bán acc Minecraft').addStringOption(o => o.setName('username').setDescription('Minecraft username').setRequired(true)).addIntegerOption(o => o.setName('price_bank').setDescription('Giá Bank').setRequired(true)).addIntegerOption(o => o.setName('price_card').setDescription('Giá Card').setRequired(true)).addIntegerOption(o => o.setName('cape_count').setDescription('Số Cape').setRequired(true)).addStringOption(o => o.setName('cape_list').setDescription('Tên các Cape').setRequired(true)).addStringOption(o => o.setName('rank').setDescription('Rank ingame').setRequired(true)).addStringOption(o => o.setName('image_url').setDescription('Link ảnh minh họa').setRequired(false)),
  new SlashCommandBuilder().setName('price').setDescription('Đổi giá bán của acc').addStringOption(o => o.setName('username').setDescription('Username acc').setRequired(true)).addIntegerOption(o => o.setName('price_bank').setDescription('Giá Bank mới').setRequired(true)).addIntegerOption(o => o.setName('price_card').setDescription('Giá Card mới').setRequired(true)),
  new SlashCommandBuilder().setName('cape').setDescription('Cập nhật Cape của acc').addStringOption(o => o.setName('username').setDescription('Username acc').setRequired(true)).addIntegerOption(o => o.setName('cape_count').setDescription('Số Cape').setRequired(true)).addStringOption(o => o.setName('cape_list').setDescription('Danh sách Cape').setRequired(true))
];

async function register() {
  const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
  const app = process.env.CLIENT_ID || process.env.APPLICATION_ID;
  if (!token || !app) {
    console.error('❌ Thiếu DISCORD_TOKEN hoặc CLIENT_ID trong file .env');
    return;
  }
  const rest = new REST({ version: '10' }).setToken(token);
  const route = process.env.GUILD_ID
    ? Routes.applicationGuildCommands(app, process.env.GUILD_ID)
    : Routes.applicationCommands(app);
  await rest.put(route, { body: commands.map(x => x.toJSON()) });
  console.log(`✅ Đã đăng ký ${commands.length} Slash Commands thành công!`);
}

// ============================================================
// 11. CENTRAL INTERACTION ROUTER
// ============================================================
client.on(Events.InteractionCreate, async i => {
  console.log(`🔥 [INTERACTION] Type=${i.type} Command=${i.isChatInputCommand() ? i.commandName : '-'} CustomId=${i.customId || '-'} User=${i.user?.tag || i.user?.id}`);
  try {
    if (i.isChatInputCommand()) {
      if (i.commandName === 'time') return handleTime(i);
      if (moneyNames.includes(i.commandName)) return handleMoneyCommand(i);
      if (accNames.includes(i.commandName)) return handleAccCommand(i);
      return reply(i, { content: '❌ Lệnh chưa được đăng ký Handler!', flags: MessageFlags.Ephemeral });
    }

    if (i.isButton()) {
      if (i.customId === 'close_ticket') {
        if (!isAdmin(i)) return reply(i, { content: '❌ Chỉ Admin mới có thể đóng Ticket!', flags: MessageFlags.Ephemeral });
        await reply(i, { content: '🔒 Ticket sẽ bị xóa sau 5 giây...' });
        setTimeout(() => i.channel?.delete().catch(() => {}), 5000);
        return;
      }
      if (i.customId.startsWith('money_approve_') || i.customId.startsWith('money_reject_')) {
        return handleMoneyOrderAction(i);
      }
      if (['buy_bank', 'buy_card', 'calc_price', 'guide'].includes(i.customId)) {
        return openMoneyModal(i, i.customId);
      }
      return handleAccButton(i);
    }

    if (i.isStringSelectMenu()) {
      if (i.customId.startsWith('select_deliver_acc_')) return handleDeliver(i);
      return handleAccSelect(i);
    }

    if (i.isModalSubmit()) {
      return handleMoneyModal(i);
    }
  } catch (e) {
    console.error('❌ [INTERACTION ROUTER ERROR]', e);
    if (!i.replied && !i.deferred) {
      await reply(i, { content: `❌ Xảy ra lỗi: \`${e.message}\``, flags: MessageFlags.Ephemeral });
    }
  }
});

// ============================================================
// 12. MESSAGE LISTENERS (KEYWORDS & AUTO BILL DETECTION)
// ============================================================
client.on(Events.MessageCreate, async m => {
  if (m.author.bot) return;
  try {
    const t = String(m.content || '').toLowerCase();
    if (t.includes('sell') || t.includes('stock')) {
      await m.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor('#3498db')
            .setTitle('📦 THÔNG TIN KHO MONEY')
            .setDescription(`📦 Stock hiện tại: **${formatStock(stockM)}**\n💸 Tỷ giá: **${RATE}đ / 1M$**\n🕐 Giờ hoạt động: **${scheduleText()}**`)
            .setTimestamp()
        ]
      });
    }

    if (m.channel?.type === ChannelType.GuildText && m.channel.name?.startsWith('ticket-') && m.channel.topic?.startsWith('accOrder:') && m.attachments.some(a => String(a.contentType || '').startsWith('image/'))) {
      await m.channel.send({
        embeds: [
          new EmbedBuilder().setTitle('🧾 ĐÃ NHẬN ẢNH BILL').setDescription('Admin sẽ kiểm tra hình ảnh giao dịch bên dưới và tiến hành giao Acc.')
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('approve_bill').setLabel('Duyệt - Chọn Acc Giao').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('reject_bill').setLabel('Từ Chối Bill').setStyle(ButtonStyle.Danger)
          )
        ]
      });
    }
  } catch (e) {
    console.error('[MESSAGE LISTEN ERROR]', e.message);
  }
});

// ============================================================
// 13. SCHEDULE WATCHER
// ============================================================
let lastState = null;
async function checkSchedule() {
  const state = working();
  if (state === lastState) return;
  lastState = state;
  console.log(state ? `🟢 [SCHEDULE] MỞ CỬA HÀNG (${scheduleText()})` : `🔴 [SCHEDULE] ĐÓNG CỬA HÀNG (${scheduleText()})`);
  await updatePanel();
}

// ============================================================
// 14. READY & BOT STARTUP
// ============================================================
client.once(Events.ClientReady, async c => {
  console.log(`🤖 Bot online với tên: ${c.user.tag}`);

  config = readJson(CONFIG_FILE, {});
  stockM = Number(readJson(STOCK_FILE, { stockM: 5000 }).stockM) || 0;
  RATE = Number(config.rate) > 0 ? Number(config.rate) : 130;

  schedule = {
    startHour: Number(config.schedule?.startHour ?? 10),
    startMinute: Number(config.schedule?.startMinute ?? 0),
    endHour: Number(config.schedule?.endHour ?? 22),
    endMinute: Number(config.schedule?.endMinute ?? 0)
  };
  normalizeSchedule();

  console.log(`📦 Kho Money: ${stockM}M$ | Tỷ giá: ${RATE}đ/1M$`);
  console.log(`🕐 Khung giờ: ${scheduleText()} (${scheduleStatus()})`);

  try {
    await register();
  } catch (e) {
    console.error('[REGISTER COMMANDS ERROR]', e);
  }

  await updatePanel();
  lastState = working();
  setInterval(() => checkSchedule().catch(e => console.error('[SCHEDULE WATCHER ERROR]', e)), 30000);
});

client.on('error', e => console.error('[CLIENT ERROR]', e));
client.on('warn', w => console.warn('[CLIENT WARN]', w));
client.on('shardError', e => console.error('[SHARD ERROR]', e));
process.on('unhandledRejection', e => console.error('[UNHANDLED REJECTION]', e));
process.on('uncaughtException', e => console.error('[UNCAUGHT EXCEPTION]', e));

const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
if (!token) {
  console.error('❌ Thất bại: Không tìm thấy DISCORD_TOKEN/TOKEN trong file .env!');
} else {
  client.login(token).catch(e => console.error('❌ Login failed:', e.message));
}
