const express = require('express');
const { runAssistant } = require('../services/assistant');

const router = express.Router();

// POST /api/assistant — one turn of the voice conversation.
// Body: { history: [{role, text}], message }  ->  { reply, booking? }
router.post('/', async (req, res) => {
  const { history, message } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'A message is required.' });
  }
  try {
    const result = await runAssistant(Array.isArray(history) ? history : [], message.trim().slice(0, 2000));
    res.json(result);
  } catch (err) {
    if (err.code === 'not_configured') {
      return res.status(503).json({ error: "The voice assistant isn't switched on yet." });
    }
    console.error('assistant error', err.message);
    res.status(500).json({ error: 'The assistant had trouble just now. Please try again.', detail: err.message, status: err.status });
  }
});

module.exports = router;
