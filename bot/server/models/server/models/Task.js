const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  dropLink: { type: String, required: true },
  reward: { type: Number, required: true },
  active: { type: Boolean, default: true },
  completedBy: [{ type: Number }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Task', taskSchema);
