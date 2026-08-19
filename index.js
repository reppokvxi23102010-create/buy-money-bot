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
// WEB SERVER
// ============================================================
const PORT = Number(process.env.PORT) || 10000;
http.createServer((req,res)=>{
  res.writeHead(200, {'Content-Type':'text/plain; charset=utf-8'});
  res.end('SMP BOT AutoBuy Money + Account đang hoạt động 24/7!');
}).listen(PORT, ()=>console.log(`[HTTP] Port ${PORT}`));

// ============================================================
// CLIENT
// ============================================================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// ============================================================
// CONFIG / FILES
// ============================================================
const TIMEZONE = 'Asia/Ho_Chi_Minh';
const CARD_DISCOUNT = 0.20;
const BANK_CONFIG = {
  BANK_ID: process.env.BANK_ID || 'MB',
  ACCOUNT_NO: process.env.BANK_ACCOUNT_NO || '',
  ACCOUNT_NAME: process.env.BANK_ACCOUNT_NAME || ''
};
const STOCK_FILE = path.join(__dirname,'stock.json');
const CONFIG_FILE = path.join(__dirname,'config.json');
const ACC_STOCK_FILE = path.join(__dirname,'accounts.json');
const ACC_DETAIL_FILE = path.join(__dirname,'accounts_detail.json');
const ORDERS_FILE = path.join(__dirname,'money_orders.json');

function ensureJson(file,fallback){
  try{if(!fs.existsSync(file)) fs.writeFileSync(file,JSON.stringify(fallback,null,2),'utf8');}
  catch(e){console.error('[JSON CREATE]',file,e.message)}
}
function readJson(file,fallback){
  try{ensureJson(file,fallback);return JSON.parse(fs.readFileSync(file,'utf8'));}
  catch(e){console.error('[JSON READ]',file,e.message);return fallback;}
}
function writeJson(file,data){
  try{fs.writeFileSync(file,JSON.stringify(data,null,2),'utf8');return true;}
  catch(e){console.error('[JSON WRITE]',file,e.message);return false;}
}

let config = readJson(CONFIG_FILE,{});
let stockM = Number(readJson(STOCK_FILE,{stockM:5000}).stockM) || 0;
let RATE = Number(config.rate) > 0 ? Number(config.rate) : 130;
let schedule = {
  startHour: Number.isInteger(Number(config.schedule?.startHour)) ? Number(config.schedule.startHour) : 10,
  startMinute: Number.isInteger(Number(config.schedule?.startMinute)) ? Number(config.schedule.startMinute) : 0,
  endHour: Number.isInteger(Number(config.schedule?.endHour)) ? Number(config.schedule.endHour) : 22,
  endMinute: Number.isInteger(Number(config.schedule?.endMinute)) ? Number(config.schedule.endMinute) : 0
};

function saveConfig(){writeJson(CONFIG_FILE,config)}
function saveStock(){writeJson(STOCK_FILE,{stockM:Math.max(0,Number(stockM)||0)})}
function orders(){return readJson(ORDERS_FILE,{})}
function saveOrders(x){writeJson(ORDERS_FILE,x)}
function accStock(){return readJson(ACC_STOCK_FILE,[])}
function saveAccStock(x){writeJson(ACC_STOCK_FILE,x)}
function accs(){return readJson(ACC_DETAIL_FILE,[])}
function saveAccs(x){writeJson(ACC_DETAIL_FILE,x)}

// ============================================================
// TIME SCHEDULE - DEFAULT 10:00 -> 22:00
// ============================================================
function normalizeSchedule(){
  schedule.startHour=Math.max(0,Math.min(23,Number(schedule.startHour)||0));
  schedule.startMinute=Math.max(0,Math.min(59,Number(schedule.startMinute)||0));
  schedule.endHour=Math.max(0,Math.min(23,Number(schedule.endHour)||0));
  schedule.endMinute=Math.max(0,Math.min(59,Number(schedule.endMinute)||0));
}
normalizeSchedule();
function vnNow(){
  const p=new Intl.DateTimeFormat('en-GB',{timeZone:TIMEZONE,hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());
  const h=Number(p.find(x=>x.type==='hour')?.value||0), m=Number(p.find(x=>x.type==='minute')?.value||0);
  return {hour:h,minute:m,total:h*60+m};
}
function fmtTime(h,m){return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`}
function scheduleText(){return `${fmtTime(schedule.startHour,schedule.startMinute)} → ${fmtTime(schedule.endHour,schedule.endMinute)}`}
function working(){
  const now=vnNow(), s=schedule.startHour*60+schedule.startMinute, e=schedule.endHour*60+schedule.endMinute;
  if(s===e) return false;
  if(s<e) return now.total>=s && now.total<e;
  return now.total>=s || now.total<e;
}
function scheduleStatus(){return working()?'🟢 ĐANG TRONG GIỜ HOẠT ĐỘNG':'🔴 ĐANG NGOÀI GIỜ HOẠT ĐỘNG'}

// ============================================================
// GENERAL HELPERS
// ============================================================
function isAdmin(i){
  const byId=Boolean(process.env.ADMIN_DISCORD_ID && i.user?.id===process.env.ADMIN_DISCORD_ID);
  const byPerm=Boolean(i.memberPermissions?.has(PermissionsBitField.Flags.Administrator));
  return byId||byPerm;
}
function adminOverwrites(){
  return process.env.ADMIN_DISCORD_ID ? [{id:process.env.ADMIN_DISCORD_ID,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages,PermissionsBitField.Flags.AttachFiles,PermissionsBitField.Flags.ManageChannels]}] : [];
}
function formatStock(x){x=Number(x)||0;if(x<=0)return '🔴 HẾT HÀNG (0M$)';if(x>=1000)return `${(x/1000).toFixed(2)}B$ (${x.toLocaleString('vi-VN')}M$)`;return `${x.toLocaleString('vi-VN')}M$`}
function parseCardValue(v){if(!v)return 0;let s=String(v).trim().toLowerCase().replace(/\s/g,'');let mul=1;if(s.endsWith('k')){mul=1000;s=s.slice(0,-1)}else if(s.endsWith('m')){mul=1000000;s=s.slice(0,-1)}s=s.replace(/,/g,'').replace(/\./g,'');const n=Number(s);return Number.isFinite(n)&&n>0?Math.floor(n*mul):0}
function parseMoneyM(v){if(!v)return 0;let s=String(v).trim().toLowerCase().replace(/\s/g,'').replace(/,/g,'');const orig=s;let mul=1;if(s.endsWith('b')){mul=1000;s=s.slice(0,-1)}else if(s.endsWith('m')){s=s.slice(0,-1)}else if(s.endsWith('k')){mul=.001;s=s.slice(0,-1)}const n=Number(s);if(!Number.isFinite(n)||n<=0)return 0;if(/[bmk]$/.test(orig))return n*mul;return n>=10000?n/1000000:n}
async function reply(i,data){try{return i.replied||i.deferred?await i.followUp(data):await i.reply(data)}catch(e){console.error('[REPLY]',e.message)}}
async function defer(i,data={}){try{if(i.replied||i.deferred)return true;await i.deferReply(data);return true}catch(e){console.error('[DEFER]',e.message);return false}}
async function deferUpdate(i){try{if(i.replied||i.deferred)return true;await i.deferUpdate();return true}catch(e){console.error('[DEFER UPDATE]',e.message);return false}}
async function edit(i,data){try{return i.replied||i.deferred?await i.editReply(data):await i.reply(data)}catch(e){console.error('[EDIT]',e.message)}}

// ============================================================
// MONEY PANEL
// ============================================================
function moneyPanel(){
  const canBuy=working()&&stockM>0;
  const status=!working()?'🔴 NGOÀI GIỜ HOẠT ĐỘNG':stockM<=0?'🔴 HẾT KHO MONEY':'🟢 HOẠT ĐỘNG';
  const embed=new EmbedBuilder().setColor(canBuy?'#2ecc71':'#e74c3c').setTitle('🛒 HỆ THỐNG AUTO BUY MONEY KINGSMP').setDescription(
    `🟢 **Trạng thái:** ${status}\n`+
    `🕐 **Giờ hoạt động:** \`${scheduleText()}\`\n`+
    `🇻🇳 **Múi giờ:** \`${TIMEZONE}\`\n`+
    `💸 **Tỷ giá:** \`${RATE} VNĐ = 1M$\`\n`+
    `🎟️ **Thẻ cào:** Trừ ${CARD_DISCOUNT*100}%\n`+
    `📦 **Kho:** \`${formatStock(stockM)}\`\n\n`+
    (!working()?'🌙 Bot hiện đang ngoài giờ hoạt động.':stockM<=0?'⚠️ Kho đã hết Money.':'💰 Chọn phương thức mua bên dưới:')
  ).setTimestamp();
  const row=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('buy_bank').setLabel('Mua Bằng Ngân Hàng').setEmoji('💵').setStyle(ButtonStyle.Success).setDisabled(!canBuy),
    new ButtonBuilder().setCustomId('buy_card').setLabel('Mua Bằng Thẻ Cào (-20%)').setEmoji('🎟️').setStyle(ButtonStyle.Primary).setDisabled(!canBuy),
    new ButtonBuilder().setCustomId('calc_price').setLabel('Tính Tiền').setEmoji('🧮').setStyle(ButtonStyle.Secondary).setDisabled(!canBuy),
    new ButtonBuilder().setCustomId('guide').setLabel('Hướng Dẫn').setEmoji('📖').setStyle(ButtonStyle.Secondary)
  );
  return {embeds:[embed],components:[row]};
}
async function updatePanel(){
  if(!config.channelId)return;
  try{
    const ch=await client.channels.fetch(String(config.channelId));
    if(!ch?.isTextBased())return;
    if(config.messageId){
      try{const msg=await ch.messages.fetch(String(config.messageId));await msg.edit(moneyPanel());return}
      catch(e){if(!['10008','10003'].includes(String(e.code))&&!String(e.message).toLowerCase().includes('unknown message')){console.error('[PANEL EDIT]',e.message);return}}
    }
    const msg=await ch.send(moneyPanel());config.messageId=msg.id;saveConfig();console.log('[PANEL] Created',msg.id);
  }catch(e){console.error('[PANEL]',e.message)}
}

// ============================================================
// COMMAND HANDLERS
// ============================================================
async function handleTime(i){
  if(!isAdmin(i))return reply(i,{content:'❌ Chỉ Admin mới được chỉnh giờ!',flags:MessageFlags.Ephemeral});
  schedule={startHour:i.options.getInteger('start_hour',true),startMinute:i.options.getInteger('start_minute',true),endHour:i.options.getInteger('end_hour',true),endMinute:i.options.getInteger('end_minute',true)};
  normalizeSchedule(); config.schedule={...schedule}; saveConfig(); await updatePanel();
  const n=vnNow();
  return reply(i,{content:`✅ **Đã đổi giờ hoạt động!**\n\n🕐 **Giờ:** \`${scheduleText()}\`\n🕒 **Giờ VN hiện tại:** \`${fmtTime(n.hour,n.minute)}\`\n${scheduleStatus()}`,flags:MessageFlags.Ephemeral});
}
async function handleMoneyCommand(i){
  if(!isAdmin(i))return reply(i,{content:'❌ Bạn không có quyền Administrator!',flags:MessageFlags.Ephemeral});
  if(i.commandName==='setup'){
    if(!await defer(i,{flags:MessageFlags.Ephemeral}))return;
    const msg=await i.channel.send(moneyPanel());config.channelId=i.channelId;config.messageId=msg.id;saveConfig();return edit(i,{content:'✅ Đã thiết lập AutoBuy Panel!'});
  }
  if(i.commandName==='setstock'){
    if(!await defer(i,{flags:MessageFlags.Ephemeral}))return;
    const x=parseMoneyM(i.options.getString('amount',true));if(x<=0)return edit(i,{content:'❌ Stock không hợp lệ. Ví dụ `500m`, `10b`.'});
    stockM=x;saveStock();await updatePanel();return edit(i,{content:`✅ Kho hiện tại: **${formatStock(stockM)}**`});
  }
  if(i.commandName==='rate'){
    if(!await defer(i,{flags:MessageFlags.Ephemeral}))return;
    RATE=i.options.getInteger('value',true);config.rate=RATE;saveConfig();await updatePanel();return edit(i,{content:`✅ Rate mới: **${RATE}đ / 1M$**`});
  }
}
async function openMoneyModal(i,id){
  if(!working())return reply(i,{content:`🌙 Bot đang ngoài giờ. Giờ: **${scheduleText()}**`,flags:MessageFlags.Ephemeral});
  if(stockM<=0&&id!=='guide')return reply(i,{content:'🔴 Hệ thống đang hết kho Money.',flags:MessageFlags.Ephemeral});
  if(id==='buy_bank'){
    const m=new ModalBuilder().setCustomId('modal_bank').setTitle(`Mua Bank - ${RATE}đ/1M`).addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bank_name').setLabel('Tên Ingame').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bank_vnd').setLabel('Số tiền nạp').setPlaceholder('Ví dụ 10k, 20k').setStyle(TextInputStyle.Short).setRequired(true))
    );return i.showModal(m);
  }
  if(id==='buy_card'){
    const m=new ModalBuilder().setCustomId('modal_card').setTitle(`Nạp Thẻ - ${RATE}đ/1M`).addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_ign').setLabel('Tên Ingame').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_type').setLabel('Loại thẻ').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_val').setLabel('Mệnh giá').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_code').setLabel('Mã thẻ').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('card_seri').setLabel('Seri').setStyle(TextInputStyle.Short).setRequired(true))
    );return i.showModal(m);
  }
  if(id==='calc_price'){
    const m=new ModalBuilder().setCustomId('modal_calc').setTitle('Tính Tiền').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('calc_money').setLabel('Money (b/m/k)').setStyle(TextInputStyle.Short).setRequired(true)));return i.showModal(m);
  }
  if(id==='guide')return reply(i,{content:`📖 **HƯỚNG DẪN**\n💸 Rate: **${RATE}đ = 1M$**\n🎟️ Card: **-20%**\n📦 Kho: **${formatStock(stockM)}**\n🕐 Giờ: **${scheduleText()}**`,flags:MessageFlags.Ephemeral});
}
async function handleMoneyModal(i){
  if(i.customId==='modal_calc'){
    const raw=i.fields.getTextInputValue('calc_money'), m=parseMoneyM(raw);if(m<=0)return reply(i,{content:'❌ Money không hợp lệ.',flags:MessageFlags.Ephemeral});
    const bank=Math.round(m*RATE), card=Math.round(bank/(1-CARD_DISCOUNT));return reply(i,{content:`🧮 **TÍNH GIÁ**\n• Money: **${m.toLocaleString('vi-VN')}M$**\n💵 Bank: **${bank.toLocaleString('vi-VN')} VNĐ**\n🎟️ Card: **${card.toLocaleString('vi-VN')} VNĐ**`,flags:MessageFlags.Ephemeral});
  }
  if(!await defer(i,{flags:MessageFlags.Ephemeral}))return;
  const o=orders();let id='';let data={};let embed;let prefix='';
  if(i.customId==='modal_bank'){
    const ign=i.fields.getTextInputValue('bank_name').trim(), vnd=parseCardValue(i.fields.getTextInputValue('bank_vnd')), amount=Math.floor(vnd/RATE);
    if(vnd<1000||amount<=0)return edit(i,{content:'❌ Số tiền không hợp lệ hoặc quá thấp.'});
    if(amount>stockM)return edit(i,{content:`❌ Kho không đủ. Kho còn ${formatStock(stockM)}.`});
    id=`M${Date.now()}${Math.random().toString(36).slice(2,7).toUpperCase()}`;prefix='bank';data={ign,vndAmount:vnd,amountM:amount};
    const memo=`KSMP ${ign}`;const qr=`https://img.vietqr.io/image/${BANK_CONFIG.BANK_ID}-${BANK_CONFIG.ACCOUNT_NO}-compact2.png?amount=${vnd}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(BANK_CONFIG.ACCOUNT_NAME)}`;
    embed=new EmbedBuilder().setTitle('💳 THÔNG TIN CHUYỂN KHOẢN BANK').setColor('#3498db').setDescription('Sau khi chuyển tiền, gửi ảnh bill vào ticket.').addFields(
      {name:'👤 Ingame',value:`\`${ign}\``,inline:true},{name:'💰 Money',value:`\`${amount.toLocaleString('vi-VN')}M$\``,inline:true},{name:'💵 Số tiền',value:`\`${vnd.toLocaleString('vi-VN')} VNĐ\``,inline:true},
      {name:'🏦 Ngân hàng',value:`\`${BANK_CONFIG.BANK_ID}\` - STK: \`${BANK_CONFIG.ACCOUNT_NO||'Chưa cấu hình'}\``},{name:'👤 Chủ TK',value:`\`${BANK_CONFIG.ACCOUNT_NAME||'Chưa cấu hình'}\``},{name:'📌 Nội dung',value:`\`${memo}\``}).setImage(qr).setFooter({text:`Mã đơn: ${id}`});
  }else{
    const ign=i.fields.getTextInputValue('card_ign').trim(), type=i.fields.getTextInputValue('card_type').trim(), val=parseCardValue(i.fields.getTextInputValue('card_val')), pin=i.fields.getTextInputValue('card_code').trim(), seri=i.fields.getTextInputValue('card_seri').trim(), net=Math.floor(val*(1-CARD_DISCOUNT)), amount=Math.floor(net/RATE);
    if(val<1000||amount<=0)return edit(i,{content:'❌ Thẻ không hợp lệ hoặc quá thấp.'});
    if(amount>stockM)return edit(i,{content:`❌ Kho không đủ. Kho còn ${formatStock(stockM)}.`});
    id=`C${Date.now()}${Math.random().toString(36).slice(2,7).toUpperCase()}`;prefix='card';data={ign,cardType:type,cardValueVnd:val,netVnd:net,amountM:amount,cardCode:pin,cardSeri:seri};
    embed=new EmbedBuilder().setTitle('🎟️ THÔNG TIN ĐƠN NẠP THẺ').setColor('#f1c40f').setDescription('Admin sẽ kiểm tra thẻ trước khi duyệt.').addFields(
      {name:'👤 Ingame',value:`\`${ign}\``,inline:true},{name:'💳 Loại',value:`\`${type}\``,inline:true},{name:'💵 Mệnh giá',value:`\`${val.toLocaleString('vi-VN')} VNĐ\``,inline:true},{name:'💰 Money',value:`\`${amount.toLocaleString('vi-VN')}M$\``,inline:true},{name:'🔑 Mã thẻ',value:`\`${pin}\``},{name:'🔢 Seri',value:`\`${seri}\``}).setFooter({text:`Mã đơn: ${id}`});
  }
  o[id]={id,type:prefix,userId:i.user.id,username:i.user.username,status:'pending',createdAt:Date.now(),...data};saveOrders(o);
  try{
    const safe=String(data.ign).toLowerCase().replace(/[^a-z0-9-_]/g,'').slice(0,60)||'user';
    const ch=await i.guild.channels.create({name:`ticket-${prefix}-${safe}`,type:ChannelType.GuildText,permissionOverwrites:[{id:i.guild.id,deny:[PermissionsBitField.Flags.ViewChannel]},{id:i.user.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages,PermissionsBitField.Flags.AttachFiles]},...adminOverwrites()]});
    await ch.setTopic(`moneyOrder:${id}`);
    const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`money_approve_${id}`).setLabel(prefix==='bank'?'Duyệt Đơn':'Duyệt Thẻ').setEmoji('✅').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId(`money_reject_${id}`).setLabel('Từ Chối').setEmoji('❌').setStyle(ButtonStyle.Danger),new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setEmoji('🔒').setStyle(ButtonStyle.Secondary));
    await ch.send({content:`<@${i.user.id}>`,embeds:[embed],components:[row]});o[id].ticketChannelId=ch.id;o[id].ticketUrl=`https://discord.com/channels/${i.guild.id}/${ch.id}`;saveOrders(o);
    return edit(i,{content:`✅ **Đã tạo Ticket!**\n👉 ${ch}\n🆔 Mã đơn: \`${id}\``});
  }catch(e){delete o[id];saveOrders(o);return edit(i,{content:`❌ Không thể tạo Ticket: \`${e.message}\``})}
}

// ============================================================
// ACCOUNT COMMANDS
// ============================================================
async function handleAccCommand(i){
  if(!isAdmin(i))return reply(i,{content:'❌ Bạn không có quyền!',flags:MessageFlags.Ephemeral});
  if(i.commandName==='setstockacc'){
    if(!await defer(i,{flags:MessageFlags.Ephemeral}))return;const raw=i.options.getString('danh_sach',true);const lines=raw.split('\n').map(x=>x.trim()).filter(Boolean);const s=accStock();let count=0;for(const line of lines){const p=line.split('|').map(x=>x.trim());if(p.length>=2){s.push({id:`stock_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,name:p[0],email:p[1],recoveryCode:p[2]||'Không có'});count++}}saveAccStock(s);return edit(i,{content:`✅ Đã thêm **${count} acc**. Kho: **${s.length}**`});
  }
  if(i.commandName==='acc'||i.commandName==='deleteacc'){
    if(!await defer(i,{flags:MessageFlags.Ephemeral}))return;const s=accStock();if(!s.length)return edit(i,{content:'❌ Kho Account trống.'});const menu=new StringSelectMenuBuilder().setCustomId(i.commandName==='acc'?'select_stock_acc_manual':'select_delete_acc_menu').setPlaceholder(i.commandName==='acc'?'📦 Chọn acc':'🗑️ Chọn acc để xóa').addOptions(s.slice(0,25).map(x=>new StringSelectMenuOptionBuilder().setLabel(String(x.name||'Không tên').slice(0,100)).setDescription(String(x.email||'Không email').slice(0,90)).setValue(String(x.id))));return edit(i,{content:`📦 Kho Account: **${s.length}**`,components:[new ActionRowBuilder().addComponents(menu)]});
  }
  if(i.commandName==='thongtin'){
    if(!await defer(i,{flags:MessageFlags.Ephemeral}))return;const a=accs();const x={id:`acc_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,username:i.options.getString('username',true).trim(),priceBank:i.options.getInteger('price_bank',true),priceCard:i.options.getInteger('price_card',true),capeCount:i.options.getInteger('cape_count',true),capeList:i.options.getString('cape_list',true).trim(),rank:i.options.getString('rank',true),imageUrl:i.options.getString('image_url')||null,status:'available',channelId:i.channelId,messageId:null,pendingTicketId:null,pendingBuyerId:null};const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`buy_single_${x.id}`).setLabel('Mua Ngay').setEmoji('🛒').setStyle(ButtonStyle.Success));const msg=await i.channel.send({embeds:[makeAccEmbed(x)],components:[row]});x.messageId=msg.id;a.push(x);saveAccs(a);return edit(i,{content:`✅ Đã đăng bán Acc \`${x.username}\`!`});
  }
  if(i.commandName==='price'||i.commandName==='cape'){
    if(!await defer(i,{flags:MessageFlags.Ephemeral}))return;const name=i.options.getString('username',true).trim();const a=accs();const x=a.find(v=>String(v.username).toLowerCase()===name.toLowerCase());if(!x)return edit(i,{content:`❌ Không tìm thấy Acc \`${name}\``});if(i.commandName==='price'){x.priceBank=i.options.getInteger('price_bank',true);x.priceCard=i.options.getInteger('price_card',true)}else{x.capeCount=i.options.getInteger('cape_count',true);x.capeList=i.options.getString('cape_list',true).trim()}saveAccs(a);await updateAccListing(x);return edit(i,{content:'✅ Đã cập nhật.'});
  }
}
function makeAccEmbed(a){const e=new EmbedBuilder().setColor(a.status==='available'?'#2ecc71':a.status==='pending'?'#f1c40f':'#e74c3c').setTitle(`🎮 ${a.username}`).setDescription(`🏷️ Bank: **${Number(a.priceBank||0).toLocaleString('vi-VN')} VNĐ**\n🎟️ Card: **${Number(a.priceCard||0).toLocaleString('vi-VN')} VNĐ**\n✅ Trạng thái: **${a.status==='available'?'🟢 Có Sẵn':a.status==='pending'?'🟡 Đang Có Người Mua':'🔴 Đã Bán'}**`).addFields({name:'Username',value:`\`${a.username}\``},{name:'Cape',value:`\`${a.capeCount}\``,inline:true},{name:'Cape list',value:`\`${a.capeList||'Không'}\``,inline:true},{name:'Rank',value:`\`${a.rank}\``});if(a.imageUrl)e.setImage(a.imageUrl);return e}
async function updateAccListing(a){if(!a?.channelId||!a?.messageId)return;try{const ch=await client.channels.fetch(String(a.channelId));const msg=await ch.messages.fetch(String(a.messageId));const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(a.status==='available'?`buy_single_${a.id}`:`sold_${a.id}`).setLabel(a.status==='available'?'Mua Ngay':'🔴 Đã Bán').setStyle(a.status==='available'?ButtonStyle.Success:ButtonStyle.Danger).setDisabled(a.status!=='available'));await msg.edit({embeds:[makeAccEmbed(a)],components:[row]})}catch(e){console.error('[ACC LIST]',e.message)}}
async function handleAccSelect(i){
  if(!isAdmin(i))return reply(i,{content:'❌ Bạn không có quyền!',flags:MessageFlags.Ephemeral});if(!await deferUpdate(i))return;const id=i.values[0],s=accStock();const idx=s.findIndex(x=>String(x.id)===String(id));if(idx<0)return edit(i,{content:'❌ Acc không còn!',components:[]});
  if(i.customId==='select_delete_acc_menu'){const [x]=s.splice(idx,1);saveAccStock(s);return edit(i,{content:`✅ Đã xóa \`${x.name}\`. Kho còn **${s.length}**`,components:[]})}
  const [x]=s.splice(idx,1);saveAccStock(s);const e=new EmbedBuilder().setTitle(`🔑 ${x.name}`).setColor('#3498db').addFields({name:'Email',value:`\`${x.email}\``},{name:'Recovery',value:`\`${x.recoveryCode}\``});return edit(i,{content:`✅ Đã lấy acc \`${x.name}\``,embeds:[e],components:[]})
}
async function handleAccButton(i){
  const id=i.customId;if(id==='approve_bill'){
    if(!isAdmin(i))return reply(i,{content:'❌ Chỉ Admin!',flags:MessageFlags.Ephemeral});if(!await defer(i,{flags:MessageFlags.Ephemeral}))return;const topic=i.channel?.topic||'';if(!topic.startsWith('accOrder:'))return edit(i,{content:'❌ Ticket không phải Account.'});const aid=topic.replace('accOrder:',''), list=accs(), product=list.find(x=>x.id===aid);if(!product)return edit(i,{content:'❌ Không tìm thấy sản phẩm.'});const s=accStock();if(!s.length)return edit(i,{content:'❌ Kho Account trống.'});const menu=new StringSelectMenuBuilder().setCustomId(`select_deliver_acc_${i.message.id}`).setPlaceholder('📦 Chọn acc để giao').addOptions(s.slice(0,25).map(x=>new StringSelectMenuOptionBuilder().setLabel(String(x.name||'Không tên').slice(0,100)).setDescription(String(x.email||'').slice(0,90)).setValue(String(x.id))));return edit(i,{content:`📦 Kho có **${s.length} acc**`,components:[new ActionRowBuilder().addComponents(menu)]})}
  if(id==='reject_bill'){if(!isAdmin(i))return reply(i,{content:'❌ Chỉ Admin!',flags:MessageFlags.Ephemeral});if(!await deferUpdate(i))return;return i.channel.send('⚠️ Bill chưa hợp lệ. Vui lòng gửi lại.')}
  if(id.startsWith('buy_single_')){
    if(!working())return reply(i,{content:`🌙 Ngoài giờ. Giờ: **${scheduleText()}**`,flags:MessageFlags.Ephemeral});if(!await defer(i,{flags:MessageFlags.Ephemeral}))return;const aid=id.replace('buy_single_',''), list=accs(), product=list.find(x=>x.id===aid);if(!product||product.status!=='available')return edit(i,{content:'❌ Acc không còn sẵn.'});try{const safe=i.user.username.toLowerCase().replace(/[^a-z0-9-_]/g,'').slice(0,60)||'user';const ch=await i.guild.channels.create({name:`ticket-${safe}`,type:ChannelType.GuildText,permissionOverwrites:[{id:i.guild.id,deny:[PermissionsBitField.Flags.ViewChannel]},{id:i.user.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages,PermissionsBitField.Flags.AttachFiles]},...adminOverwrites()]});await ch.setTopic(`accOrder:${product.id}`);product.status='pending';product.pendingTicketId=ch.id;product.pendingBuyerId=i.user.id;saveAccs(list);const qr=`https://img.vietqr.io/image/${BANK_CONFIG.BANK_ID}-${BANK_CONFIG.ACCOUNT_NO}-compact2.png?amount=${product.priceBank}&addInfo=${encodeURIComponent(`THANH TOAN DON HANG ${product.username}`)}&accountName=${encodeURIComponent(BANK_CONFIG.ACCOUNT_NAME)}`;const e=new EmbedBuilder().setTitle(`💳 THANH TOÁN: ${product.username}`).setColor('#2ecc71').addFields({name:'Bank',value:`\`${product.priceBank.toLocaleString('vi-VN')} VNĐ\``,inline:true},{name:'Card',value:`\`${product.priceCard.toLocaleString('vi-VN')} VNĐ\``,inline:true},{name:'STK',value:`\`${BANK_CONFIG.ACCOUNT_NO||'Chưa cấu hình'}\``}).setImage(qr);await ch.send({content:`<@${i.user.id}>`,embeds:[e],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('approve_bill').setLabel('Duyệt - Chọn Acc').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId('reject_bill').setLabel('Từ Chối').setStyle(ButtonStyle.Danger))]});return edit(i,{content:`✅ Đã tạo Ticket mua Acc!\n👉 ${ch}`})}catch(e){product.status='available';product.pendingTicketId=null;product.pendingBuyerId=null;saveAccs(list);return edit(i,{content:`❌ Lỗi: \`${e.message}\``})}}
}
async function handleDeliver(i){
  if(!isAdmin(i))return reply(i,{content:'❌ Chỉ Admin!',flags:MessageFlags.Ephemeral});if(!await deferUpdate(i))return;const topic=i.channel?.topic||'';if(!topic.startsWith('accOrder:'))return edit(i,{content:'❌ Ticket không hợp lệ.',components:[]});const aid=topic.replace('accOrder:',''), list=accs(), product=list.find(x=>x.id===aid);if(!product)return edit(i,{content:'❌ Không tìm thấy sản phẩm.',components:[]});const s=accStock(), idx=s.findIndex(x=>String(x.id)===String(i.values[0]));if(idx<0)return edit(i,{content:'❌ Acc không còn.',components:[]});const [x]=s.splice(idx,1);saveAccStock(s);product.status='sold';product.pendingTicketId=null;product.pendingBuyerId=null;product.soldAt=Date.now();saveAccs(list);await updateAccListing(product);await i.channel.send({embeds:[new EmbedBuilder().setTitle('🎉 GIAO ACC THÀNH CÔNG').setColor('#2ecc71').addFields({name:'Name',value:`\`${x.name}\``},{name:'Email',value:`\`${x.email}\``},{name:'Recovery',value:`\`${x.recoveryCode}\``})],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setStyle(ButtonStyle.Danger))]});return edit(i,{content:`✅ Đã giao acc \`${x.name}\``,components:[]})}

// ============================================================
// COMMANDS
// ============================================================
const moneyNames=['setup','setstock','rate'];
const accNames=['setstockacc','acc','deleteacc','thongtin','price','cape'];
const commands=[
 new SlashCommandBuilder().setName('setup').setDescription('Tạo AutoBuy Panel'),
 new SlashCommandBuilder().setName('setstock').setDescription('Đổi kho Money').addStringOption(o=>o.setName('amount').setDescription('500m / 10b').setRequired(true)),
 new SlashCommandBuilder().setName('rate').setDescription('Đổi Rate').addIntegerOption(o=>o.setName('value').setDescription('130').setMinValue(1).setRequired(true)),
 new SlashCommandBuilder().setName('time').setDescription('Đổi giờ hoạt động').addIntegerOption(o=>o.setName('start_hour').setDescription('0-23').setMinValue(0).setMaxValue(23).setRequired(true)).addIntegerOption(o=>o.setName('start_minute').setDescription('0-59').setMinValue(0).setMaxValue(59).setRequired(true)).addIntegerOption(o=>o.setName('end_hour').setDescription('0-23').setMinValue(0).setMaxValue(23).setRequired(true)).addIntegerOption(o=>o.setName('end_minute').setDescription('0-59').setMinValue(0).setMaxValue(59).setRequired(true)),
 new SlashCommandBuilder().setName('setstockacc').setDescription('Thêm acc vào kho').addStringOption(o=>o.setName('danh_sach').setDescription('Tên|Email|Recovery mỗi dòng').setRequired(true)),
 new SlashCommandBuilder().setName('acc').setDescription('Xem kho acc'),
 new SlashCommandBuilder().setName('deleteacc').setDescription('Xóa acc khỏi kho'),
 new SlashCommandBuilder().setName('thongtin').setDescription('Đăng bán acc').addStringOption(o=>o.setName('username').setDescription('Minecraft username').setRequired(true)).addIntegerOption(o=>o.setName('price_bank').setDescription('Giá bank').setRequired(true)).addIntegerOption(o=>o.setName('price_card').setDescription('Giá card').setRequired(true)).addIntegerOption(o=>o.setName('cape_count').setDescription('Số cape').setRequired(true)).addStringOption(o=>o.setName('cape_list').setDescription('Tên cape').setRequired(true)).addStringOption(o=>o.setName('rank').setDescription('Rank').setRequired(true)).addStringOption(o=>o.setName('image_url').setDescription('Link ảnh').setRequired(false)),
 new SlashCommandBuilder().setName('price').setDescription('Đổi giá acc').addStringOption(o=>o.setName('username').setDescription('Username').setRequired(true)).addIntegerOption(o=>o.setName('price_bank').setDescription('Bank').setRequired(true)).addIntegerOption(o=>o.setName('price_card').setDescription('Card').setRequired(true)),
 new SlashCommandBuilder().setName('cape').setDescription('Đổi cape acc').addStringOption(o=>o.setName('username').setDescription('Username').setRequired(true)).addIntegerOption(o=>o.setName('cape_count').setDescription('Số cape').setRequired(true)).addStringOption(o=>o.setName('cape_list').setDescription('Cape').setRequired(true))
];
async function register(){const token=process.env.DISCORD_TOKEN||process.env.TOKEN, app=process.env.CLIENT_ID||process.env.APPLICATION_ID;if(!token||!app){console.error('❌ Thiếu token/client id');return}const rest=new REST({version:'10'}).setToken(token);const route=process.env.GUILD_ID?Routes.applicationGuildCommands(app,process.env.GUILD_ID):Routes.applicationCommands(app);await rest.put(route,{body:commands.map(x=>x.toJSON())});console.log(`✅ Đã đăng ký ${commands.length} Slash Commands`)}

// ============================================================
// INTERACTION ROUTER
// ============================================================
client.on(Events.InteractionCreate,async i=>{
  console.log(`🔥 [INTERACTION] type=${i.type} command=${i.isChatInputCommand()?i.commandName:'-'} customId=${i.customId||'-'} user=${i.user?.tag||i.user?.id||'-'}`);
  try{
    if(i.isChatInputCommand()){
      if(i.commandName==='time')return handleTime(i);
      if(moneyNames.includes(i.commandName))return handleMoneyCommand(i);
      if(accNames.includes(i.commandName))return handleAccCommand(i);
      return reply(i,{content:'❌ Command chưa có handler.',flags:MessageFlags.Ephemeral});
    }
    if(i.isButton()){
      if(i.customId==='close_ticket'){
        if(!isAdmin(i))return reply(i,{content:'❌ Chỉ Admin!',flags:MessageFlags.Ephemeral});
        await reply(i,{content:'🔒 Ticket sẽ xóa sau 5 giây.'});setTimeout(()=>i.channel?.delete().catch(()=>{}),5000);return;
      }
      if(i.customId.startsWith('money_')||['buy_bank','buy_card','calc_price','guide'].includes(i.customId))return handleMoneyButton(i);
      return handleAccButton(i);
    }
    if(i.isStringSelectMenu()){
      if(i.customId.startsWith('select_deliver_acc_'))return handleDeliver(i);
      return handleAccSelect(i);
    }
    if(i.isModalSubmit())return handleMoneyModal(i);
  }catch(e){console.error('❌ [INTERACTION ERROR]',e);if(!i.replied&&!i.deferred)await reply(i,{content:`❌ Lỗi: \`${e.message}\``,flags:MessageFlags.Ephemeral})}
});

async function handleMoneyButton(i){return openMoneyModal(i,i.customId)}

// ============================================================
// MESSAGE CREATE
// ============================================================
client.on(Events.MessageCreate,async m=>{
  if(m.author.bot)return;
  try{
    const t=String(m.content||'').toLowerCase();
    if(t.includes('sell')||t.includes('stock'))await m.channel.send({embeds:[new EmbedBuilder().setColor('#3498db').setTitle('📦 THÔNG TIN KHO MONEY').setDescription(`📦 Stock: **${formatStock(stockM)}**\n💸 Rate: **${RATE}đ / 1M$**\n🕐 Giờ: **${scheduleText()}**`).setTimestamp()]});
    if(m.channel?.type===ChannelType.GuildText&&m.channel.name?.startsWith('ticket-')&&m.channel.topic?.startsWith('accOrder:')&&m.attachments.some(a=>String(a.contentType||'').startsWith('image/'))){await m.channel.send({embeds:[new EmbedBuilder().setTitle('🧾 BILL ĐƯỢC GỬI').setDescription('Admin kiểm tra bill bên dưới.')],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('approve_bill').setLabel('Duyệt - Chọn Acc').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId('reject_bill').setLabel('Từ Chối').setStyle(ButtonStyle.Danger))]})}
  }catch(e){console.error('[MESSAGE]',e.message)}
});

// ============================================================
// SCHEDULE WATCHER
// ============================================================
let lastState=null;
async function checkSchedule(){const state=working();if(state===lastState)return;lastState=state;console.log(state?`🟢 [SCHEDULE] MỞ ${scheduleText()}`:`🔴 [SCHEDULE] ĐÓNG ${scheduleText()}`);await updatePanel()}

// ============================================================
// READY / ERRORS / LOGIN
// ============================================================
client.once(Events.ClientReady,async c=>{
  console.log(`🤖 Bot online: ${c.user.tag}`);
  config=readJson(CONFIG_FILE,{});stockM=Number(readJson(STOCK_FILE,{stockM:5000}).stockM)||0;RATE=Number(config.rate)>0?Number(config.rate):130;
  schedule={startHour:Number(config.schedule?.startHour??10),startMinute:Number(config.schedule?.startMinute??0),endHour:Number(config.schedule?.endHour??22),endMinute:Number(config.schedule?.endMinute??0)};normalizeSchedule();
  console.log(`📦 Stock: ${stockM}M$`);console.log(`💸 Rate: ${RATE}đ/1M$`);console.log(`🕐 Schedule: ${scheduleText()} (${scheduleStatus()})`);console.log(`🧩 Panel: channel=${config.channelId||'none'} message=${config.messageId||'none'}`);
  try{await register()}catch(e){console.error('[REGISTER]',e)}
  await updatePanel();lastState=working();setInterval(()=>checkSchedule().catch(e=>console.error('[SCHEDULE]',e)),30000);console.log('✅ [READY] Interaction listener đang hoạt động.');
});
client.on('error',e=>console.error('[CLIENT ERROR]',e));client.on('warn',w=>console.warn('[CLIENT WARN]',w));client.on('shardError',e=>console.error('[SHARD ERROR]',e));
process.on('unhandledRejection',e=>console.error('[UNHANDLED]',e));process.on('uncaughtException',e=>console.error('[UNCAUGHT]',e));
const token=process.env.DISCORD_TOKEN||process.env.TOKEN;if(!token)console.error('❌ Thiếu DISCORD_TOKEN/TOKEN');else client.login(token).catch(e=>console.error('❌ Login fail',e.message));
