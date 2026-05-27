require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const User = require('./models/User');
const Task = require('./models/Task');
const Withdraw = require('./models/Withdraw');

const app = express();
const bot = new TelegramBot(process.env.BOT_TOKEN);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../website')));

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ DB connected'))
  .catch(console.error);

function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (key !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/api/stats', adminAuth, async (req, res) => {
  const [users, activeTasks, pendingWithdraws, pendingAgg] = await Promise.all([
    User.countDocuments(),
    Task.countDocuments({ active: true }),
    Withdraw.countDocuments({ status: 'pending' }),
    Withdraw.aggregate([{ $match: { status: 'pending' } }, { $group: { _id: null, total: { $sum: '$amount' } } }])
  ]);
  res.json({ users, activeTasks, pendingWithdraws, pendingAmount: pendingAgg[0]?.total || 0 });
});

app.get('/api/tasks', adminAuth, async (req, res) => {
  const tasks = await Task.find().sort({ createdAt: -1 });
  res.json(tasks);
});

app.post('/api/tasks', adminAuth, async (req, res) => {
  const { title, description, dropLink, reward } = req.body;
  const task = await Task.create({ title, description, dropLink, reward });
  res.json(task);
});

app.delete('/api/tasks/:id', adminAuth, async (req, res) => {
  await Task.findByIdAndUpdate(req.params.id, { active: false });
  res.json({ success: true });
});

app.get('/api/users', adminAuth, async (req, res) => {
  const users = await User.find().sort({ totalEarned: -1 }).limit(50);
  res.json(users);
});

app.post('/api/users/addbal', adminAuth, async (req, res) => {
  const { telegramId, amount } = req.body;
  const user = await User.findOneAndUpdate(
    { telegramId },
    { $inc: { balance: amount, totalEarned: amount } },
    { new: true }
  );
  if (!user) return res.json({ success: false });
  try {
    await bot.sendMessage(telegramId, `🎁 Admin আপনার balance-এ ৳${amount} যোগ করেছেন!\n💰 নতুন Balance: ৳${user.balance}`);
  } catch {}
  res.json({ success: true });
});

app.post('/api/users/ban', adminAuth, async (req, res) => {
  const { telegramId } = req.body;
  const user = await User.findOne({ telegramId });
  if (!user) return res.json({ success: false });
  user.banned = !user.banned;
  await user.save();
  res.json({ success: true });
});

app.get('/api/withdraws', adminAuth, async (req, res) => {
  const { status = 'pending', limit = 50 } = req.query;
  const withdraws = await Withdraw.find({ status }).sort({ requestedAt: -1 }).limit(parseInt(limit));
  res.json(withdraws);
});

app.post('/api/withdraws/:id/approve', adminAuth, async (req, res) => {
  const withdraw = await Withdraw.findById(req.params.id);
  if (!withdraw || withdraw.status !== 'pending') return res.json({ success: false });
  withdraw.status = 'approved';
  withdraw.resolvedAt = new Date();
  await withdraw.save();
  try {
    await bot.sendMessage(withdraw.telegramId,
      `✅ *Withdraw Approved!*\n৳${withdraw.amount} আপনার ${withdraw.method} (${withdraw.number})-এ পাঠানো হয়েছে! 🎉`,
      { parse_mode: 'Markdown' }
    );
  } catch {}
  res.json({ success: true });
});

app.post('/api/withdraws/:id/reject', adminAuth, async (req, res) => {
  const withdraw = await Withdraw.findById(req.params.id);
  if (!withdraw || withdraw.status !== 'pending') return res.json({ success: false });
  await User.findOneAndUpdate({ telegramId: withdraw.telegramId }, { $inc: { balance: withdraw.amount } });
  withdraw.status = 'rejected';
  withdraw.resolvedAt = new Date();
  await withdraw.save();
  try {
    await bot.sendMessage(withdraw.telegramId,
      `❌ *Withdraw Rejected*\n৳${withdraw.amount} balance-এ ফেরত দেওয়া হয়েছে।`,
      { parse_mode: 'Markdown' }
    );
  } catch {}
  res.json({ success: true });
});

app.post('/api/broadcast', adminAuth, async (req, res) => {
  const { message } = req.body;
  const users = await User.find({ banned: false });
  let sent = 0, failed = 0;
  for (const user of users) {
    try {
      await bot.sendMessage(user.telegramId, `📢 *Admin:*\n\n${message}`, { parse_mode: 'Markdown' });
      sent++;
    } catch { failed++; }
    await new Promise(r => setTimeout(r, 50));
  }
  res.json({ sent, failed });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
