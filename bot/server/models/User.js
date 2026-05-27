const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  telegramId: { type: Number, unique: true, required: true },
  username: { type: String, default: 'Unknown' },
  firstName: { type: String, default: '' },
  balance: { type: Number, default: 0 },
  totalEarned: { type: Number, default: 0 },
  completedTasks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Task' }],
  banned: { type: Boolean, default: false },
  joinedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
