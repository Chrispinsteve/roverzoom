const express = require('express');
const { runAssistant, isConfigured } = require('../services/assistant');
const { synthesizeSpeech } = require('../services/tts');

const router = express.Router();

// GET /api/assistant/status — is the AI switched on? A quick way to tell
// "ANTHROPIC_API_KEY missing on this deploy" (configured:false) apart from
// "key present but the call failed" (configured:true but chats still error →
// credits/billing). Never exposes the key itself.
router.get('/status', (req, res) => {
  res.json({ configured: isConfigured() });
});

// POST /api/assistant/speak — { text } -> audio/mpeg of the reply in a warm
// neural voice. 503 when no TTS key is set, so the frontend falls back to the
// browser's built-in speech.
router.post('/speak', async (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required.' });
  }
  try {
    const audio = await synthesizeSpeech(text.trim());
    if (!audio) return res.status(503).json({ error: 'neural voice not configured' });
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'no-store');
    res.send(audio);
  } catch (err) {
    console.error('tts error', err.message);
    res.status(500).json({ error: 'Could not synthesize speech.' });
  }
});

// POST /api/assistant — one turn of the voice conversation.
// Body: { history: [{role, text}], message }  ->  { reply, booking? }
router.post('/', async (req, res) => {
  const { history, message, location } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'A message is required.' });
  }
  // Sanitize the rider's location to just what the assistant needs.
  let loc = null;
  if (location && Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lng))) {
    loc = { lat: Number(location.lat), lng: Number(location.lng), address: typeof location.address === 'string' ? location.address.slice(0, 200) : null };
  }
  try {
    const result = await runAssistant(Array.isArray(history) ? history : [], message.trim().slice(0, 2000), loc);
    res.json(result);
  } catch (err) {
    if (err.code === 'not_configured') {
      return res.status(503).json({ error: "The voice assistant isn't switched on yet." });
    }
    console.error('assistant error', err.message);
    res.status(500).json({ error: 'The assistant had trouble just now. Please try again.' });
  }
});

module.exports = router;
