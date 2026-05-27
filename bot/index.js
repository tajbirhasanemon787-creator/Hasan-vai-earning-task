require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME;
const ADMIN_ID = parseInt(process.env.ADMIN_TELEGRAM_ID);

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Database connected'))
  .catch(err => console.error('❌ DB Error:', err));

const User = require('../server/models/User');
const Task = require('../server/models/Task');
const Withdraw = require('../server/models/Withdraw');

function mainMenu() {
  return {
    reply_markup: {
      keyboard: [
        ['📋 Tasks দেখুন', '💰 আমার Balance'],
        ['💸 Withdraw করুন', '📊 আমার History'],
        ['❓ সাহায্য']
      ],
      resize_keyboard: true
    }
  };
}

async function isChannelMember(userId) {
  try {
    const member = await bot.getChatMember(CHANNEL_USERNAME, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch {
    return false;
  }
}

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name || 'User';

  const member = await isChannelMember(userId);
  if (!member) {
    return bot.sendMessage(chatId,
      `⚠️ *Channel Join করুন!*\n\nTask করতে হলে প্রথমে Channel Join করতে হবে।\n\nJoin করে আবার /start লিখুন।`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '📢 Channel Join করুন', url: `https://t.me/${CHANNEL_USERNAME.replace('@', '')}` }
          ]]
        }
      }
    );
  }

  let user = await User.findOne({ telegramId: userId });
  if (!user) {
    user = await User.create({ telegramId: userId, username, firstName: msg.from.first_name || '' });
  }

  if (user.banned) {
    return bot.sendMessage(chatId, '🚫 আপনার account ban করা হয়েছে।');
  }

  bot.sendMessage(chatId,
    `✅ *স্বাগতম ${username}!*\n\n💰 Balance: *৳${user.balance}*\n✅ Tasks: *${user.completedTasks.length}*\n🏆 মোট আয়: *৳${user.totalEarned}*\n\nনিচের মেনু থেকে শুরু করুন 👇`,
    { parse_mode: 'Markdown', ...mainMenu() }
  );
});

bot.onText(/📋 Tasks দেখুন|\/tasks/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const member = await isChannelMember(userId);
  if (!member) {
    return bot.sendMessage(chatId, `⚠️ প্রথমে ${CHANNEL_USERNAME} Join করুন।`);
  }

  const user = await User.findOne({ telegramId: userId });
  if (!user || user.banned) return;

  const tasks = await Task.find({ active: true });
  if (!tasks.length) {
    return bot.sendMessage(chatId, '😔 এখন কোনো Task নেই।', mainMenu());
  }

  await bot.sendMessage(chatId, `📋 *মোট ${tasks.length}টি Task:*`, { parse_mode: 'Markdown' });

  for (const task of tasks) {
    const alreadyDone = task.completedBy.includes(userId);
    await bot.sendMessage(chatId,
      `🎯 *${task.title}*\n\n📝 ${task.description}\n\n💰 পুরস্কার: *৳${task.reward}*\n${alreadyDone ? '✅ করা হয়েছে' : '⏳ এখনো করা হয়নি'}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: alreadyDone
            ? [[{ text: '✅ Done', callback_data: 'already_done' }]]
            : [
                [{ text: '🔗 Task করতে যান', url: task.dropLink }],
                [{ text: '✔️ Task করা হয়েছে', callback_data: `done_${task._id}` }]
              ]
        }
      }
    );
  }
});

bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data === 'already_done') {
    return bot.answerCallbackQuery(query.id, { text: '✅ এই task আগেই করা হয়েছে।' });
  }

  if (data.startsWith('done_')) {
    const taskId = data.replace('done_', '');
    const task = await Task.findById(taskId);
    const user = await User.findOne({ telegramId: userId });

    if (!task || !user) return bot.answerCallbackQuery(query.id, { text: '❌ Error!' });
    if (task.completedBy.includes(userId)) {
      return bot.answerCallbackQuery(query.id, { text: '⚠️ এই task আগেই করা হয়েছে!' });
    }

    user.balance += task.reward;
    user.totalEarned += task.reward;
    user.completedTasks.push(task._id);
    await user.save();
    task.completedBy.push(userId);
    await task.save();

    await bot.answerCallbackQuery(query.id, { text: `✅ ৳${task.reward} balance-এ যোগ হয়েছে!` });
    await bot.sendMessage(chatId,
      `🎉 *Task সম্পন্ন!*\n+৳${task.reward} যোগ হয়েছে!\n💰 Balance: *৳${user.balance}*`,
      { parse_mode: 'Markdown', ...mainMenu() }
    );
    await bot.sendMessage(ADMIN_ID,
      `📌 *Task Complete*\n👤 @${user.username}\n🎯 ${task.title}\n💰 ৳${task.reward}`,
      { parse_mode: 'Markdown' }
    );
  }

  if (data.startsWith('approve_') || data.startsWith('reject_')) {
    if (userId !== ADMIN_ID) return bot.answerCallbackQuery(query.id, { text: '❌ Admin only!' });

    const parts = data.split('_');
    const action = parts[0];
    const withdrawId = parts[1];
    const withdraw = await Withdraw.findById(withdrawId);
    if (!withdraw || withdraw.status !== 'pending') {
      return bot.answerCallbackQuery(query.id, { text: '⚠️ Already processed!' });
    }

    if (action === 'approve') {
      withdraw.status = 'approved';
      withdraw.resolvedAt = new Date();
      await withdraw.save();
      await bot.answerCallbackQuery(query.id, { text: '✅ Approved!' });
      await bot.sendMessage(withdraw.telegramId,
        `✅ *Withdraw Approved!*\n৳${withdraw.amount} আপনার ${withdraw.method} (${withdraw.number})-এ পাঠানো হয়েছে! 🎉`,
        { parse_mode: 'Markdown' }
      );
    } else {
      const user = await User.findOne({ telegramId: withdraw.telegramId });
      if (user) { user.balance += withdraw.amount; await user.save(); }
      withdraw.status = 'rejected';
      withdraw.resolvedAt = new Date();
      await withdraw.save();
      await bot.answerCallbackQuery(query.id, { text: '❌ Rejected!' });
      await bot.sendMessage(withdraw.telegramId,
        `❌ *Withdraw Rejected*\n৳${withdraw.amount} balance-এ ফেরত দেওয়া হয়েছে।`,
        { parse_mode: 'Markdown' }
      );
    }
  }
});

bot.onText(/💰 আমার Balance|\/balance/, async (msg) => {
  const user = await User.findOne({ telegramId: msg.from.id });
  if (!user) return bot.sendMessage(msg.chat.id, '/start লিখুন।');
  bot.sendMessage(msg.chat.id,
    `💰 *আপনার Balance*\n\nবর্তমান: *৳${user.balance}*\nমোট আয়: *৳${user.totalEarned}*\nTasks: *${user.completedTasks.length}টি*\n\nসর্বনিম্ন Withdraw: ৳100`,
    { parse_mode: 'Markdown', ...mainMenu() }
  );
});

bot.onText(/💸 Withdraw করুন|\/withdraw/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `💸 *Withdraw করুন*\n\n*bKash:*\n/pay bKash 01XXXXXXXXX 200\n\n*Nagad:*\n/pay Nagad 01XXXXXXXXX 200\n\n⚠️ সর্বনিম্ন: ৳100`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/pay (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const parts = match[1].trim().split(/\s+/);

  if (parts.length < 3) return bot.sendMessage(chatId, '❌ Format: /pay bKash 01XXXXXXXXX 200');

  const [method, number, amtStr] = parts;
  const amount = parseInt(amtStr);

  if (!['bKash', 'Nagad'].includes(method)) return bot.sendMessage(chatId, '❌ Method: bKash অথবা Nagad');
  if (!number.match(/^01[3-9]\d{8}$/)) return bot.sendMessage(chatId, '❌ সঠিক মোবাইল নম্বর দিন।');
  if (!amount || amount < 100) return bot.sendMessage(chatId, '❌ সর্বনিম্ন ৳100।');

  const user = await User.findOne({ telegramId: userId });
  if (!user) return bot.sendMessage(chatId, '/start লিখুন।');
  if (user.balance < amount) return bot.sendMessage(chatId, `❌ অপর্যাপ্ত balance। আপনার balance: ৳${user.balance}`);

  user.balance -= amount;
  await user.save();

  const withdraw = await Withdraw.create({ telegramId: userId, username: user.username, method, number, amount });

  await bot.sendMessage(chatId,
    `⏳ *Withdraw Request পাঠানো হয়েছে!*\n\n💳 ${method}\n📱 ${number}\n💰 ৳${amount}\n\nAdmin approve করলে notify করা হবে।`,
    { parse_mode: 'Markdown', ...mainMenu() }
  );

  await bot.sendMessage(ADMIN_ID,
    `💸 *নতুন Withdraw Request!*\n\n👤 @${user.username}\n💳 ${method}\n📱 ${number}\n💰 ৳${amount}\n\n✅ Approve করে নিজে Send Money করুন।`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Approve', callback_data: `approve_${withdraw._id}` },
          { text: '❌ Reject', callback_data: `reject_${withdraw._id}` }
        ]]
      }
    }
  );
});

bot.onText(/📊 আমার History|\/history/, async (msg) => {
  const withdraws = await Withdraw.find({ telegramId: msg.from.id }).sort({ requestedAt: -1 }).limit(5);
  if (!withdraws.length) return bot.sendMessage(msg.chat.id, '📊 কোনো history নেই।', mainMenu());

  let text = `📊 *শেষ ${withdraws.length}টি Withdraw:*\n\n`;
  for (const w of withdraws) {
    const emoji = w.status === 'approved' ? '✅' : w.status === 'rejected' ? '❌' : '⏳';
    text += `${emoji} ৳${w.amount} → ${w.method} (${w.number})\n`;
  }
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown', ...mainMenu() });
});

bot.onText(/❓ সাহায্য|\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `❓ *সাহায্য*\n\n📋 /tasks — task দেখুন\n💰 /balance — balance দেখুন\n💸 /withdraw — withdraw করুন\n📊 /history — history দেখুন`,
    { parse_mode: 'Markdown', ...mainMenu() }
  );
});

bot.onText(/\/addtask (.+)/, async (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const parts = match[1].split('|').map(s => s.trim());
  if (parts.length < 4) return bot.sendMessage(msg.chat.id, '❌ Format:\n/addtask Title | Description | Link | Reward');
  const [title, description, dropLink, rewardStr] = parts;
  const reward = parseInt(rewardStr);
  if (!reward) return bot.sendMessage(msg.chat.id, '❌ Reward সংখ্যা হতে হবে।');
  const task = await Task.create({ title, description, dropLink, reward });
  bot.sendMessage(msg.chat.id, `✅ Task যোগ হয়েছে!\nID: ${task._id}\nTitle: ${title}\nReward: ৳${reward}`);
});

bot.onText(/\/deltask (.+)/, async (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  try {
    await Task.findByIdAndUpdate(match[1].trim(), { active: false });
    bot.sendMessage(msg.chat.id, '✅ Task বন্ধ করা হয়েছে।');
  } catch { bot.sendMessage(msg.chat.id, '❌ Task ID সঠিক নয়।'); }
});

bot.onText(/\/users/, async (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const count = await User.countDocuments();
  const users = await User.find().sort({ totalEarned: -1 }).limit(10);
  let text = `👥 *মোট Users: ${count}*\n\n`;
  users.forEach((u, i) => { text += `${i+1}. @${u.username} — ৳${u.balance}\n`; });
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

bot.onText(/\/addbal (\d+) (\d+)/, async (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const user = await User.findOneAndUpdate(
    { telegramId: parseInt(match[1]) },
    { $inc: { balance: parseInt(match[2]), totalEarned: parseInt(match[2]) } },
    { new: true }
  );
  if (!user) return bot.sendMessage(msg.chat.id, '❌ User পাওয়া যায়নি।');
  bot.sendMessage(msg.chat.id, `✅ ৳${match[2]} যোগ হয়েছে। Balance: ৳${user.balance}`);
  bot.sendMessage(parseInt(match[1]), `🎁 Admin ৳${match[2]} যোগ করেছেন! Balance: ৳${user.balance}`);
});

bot.onText(/\/ban (\d+)/, async (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const user = await User.findOneAndUpdate({ telegramId: parseInt(match[1]) }, { banned: true });
  if (!user) return bot.sendMessage(msg.chat.id, '❌ User পাওয়া যায়নি।');
  bot.sendMessage(msg.chat.id, `✅ @${user.username} banned।`);
});

bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const users = await User.find({ banned: false });
  let sent = 0, failed = 0;
  for (const user of users) {
    try {
      await bot.sendMessage(user.telegramId, `📢 *Admin:*\n\n${match[1]}`, { parse_mode: 'Markdown' });
      sent++;
    } catch { failed++; }
    await new Promise(r => setTimeout(r, 50));
  }
  bot.sendMessage(msg.chat.id, `📢 Done! Sent: ${sent}, Failed: ${failed}`);
});

bot.onText(/\/stats/, async (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const totalUsers = await User.countDocuments();
  const activeTasks = await Task.countDocuments({ active: true });
  const pendingWithdraws = await Withdraw.countDocuments({ status: 'pending' });
  bot.sendMessage(msg.chat.id,
    `📊 *Statistics*\n\n👥 Users: ${totalUsers}\n📋 Tasks: ${activeTasks}\n⏳ Pending: ${pendingWithdraws}`,
    { parse_mode: 'Markdown' }
  );
});

console.log('🤖 Bot চালু হয়েছে!');
