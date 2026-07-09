const express = require('express');
const { parseBooking, isConfigured } = require('../services/ai');
const { geocodeOne } = require('../services/geocode');
const { estimate } = require('../services/fare');

const router = express.Router();

// GET /api/ai/status — lets the frontend know whether to show the AI option
router.get('/status', (req, res) => {
  res.json({ configured: isConfigured() });
});

// POST /api/ai/chat  { history: [{role, content}, ...] }
// Returns either a clarifying question or a resolved draft booking with fare.
router.post('/chat', async (req, res) => {
  const { history } = req.body || {};
  if (!Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ error: 'history is required' });
  }

  try {
    const result = await parseBooking(history);

    if (result.type === 'question') {
      return res.json({ type: 'question', text: result.text });
    }

    // Resolve the two places to coordinates so we can price the trip.
    const [pickupGeo, dropoffGeo] = await Promise.all([
      geocodeOne(result.data.pickup).catch(() => null),
      geocodeOne(result.data.dropoff).catch(() => null),
    ]);

    const pickup = pickupGeo
      ? { address: pickupGeo.address, lat: pickupGeo.lat, lng: pickupGeo.lng }
      : { address: result.data.pickup };
    const dropoff = dropoffGeo
      ? { address: dropoffGeo.address, lat: dropoffGeo.lat, lng: dropoffGeo.lng }
      : { address: result.data.dropoff };

    const quote = estimate(pickup, dropoff);

    res.json({
      type: 'booking',
      note: result.note,
      draft: {
        pickup,
        dropoff,
        scheduledAt: result.data.datetime_iso,
        ...quote,
      },
    });
  } catch (err) {
    if (err.code === 'AI_NOT_CONFIGURED') {
      return res.status(503).json({ error: err.message, code: 'AI_NOT_CONFIGURED' });
    }
    console.error('ai chat error', err.message);
    res.status(502).json({ error: 'The assistant is unavailable right now. Try the form instead.' });
  }
});

module.exports = router;
