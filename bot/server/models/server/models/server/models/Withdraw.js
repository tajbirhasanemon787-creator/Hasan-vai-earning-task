const mongoose = require('mongoose');

const withdrawSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true },
  username: { type: String },
  method: { type: String, enum: ['bKash', 'Nagad'], required: true },
  number: { type: String, required: true },
  amount: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  requestedAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date }
});

module.exports = mongoose.model('Withdraw', withdrawSchema);
