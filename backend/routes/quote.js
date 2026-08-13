const express = require('express');
const { geocode, reverseGeocode, googleGeocode, isGoogleEnabled } = require('../services/geocode');
const { estimate } = require('../services/fare');

const router = express.Router();

// GET /api/geocode?q=...[&precise=1]
// The plain form powers the as-you-type dropdown (fast, free provider, hit on
// every keystroke). `precise=1` is the commit-time lookup (on blur / final
// resolve): it prefers Google — which has house-number-level data the free
// provider lacks — so a typed street address resolves to the exact house. Only
// one such call per address, so Google cost stays low. Falls back to free.
router.get('/geocode', async (req, res) => {
  const q = req.query.q || '';
  const precise = req.query.precise === '1';
  try {
    if (precise && isGoogleEnabled()) {
      try {
        const g = await googleGeocode(q);
        if (g) return res.json([g]);
      } catch (err) {
        console.warn('google precise geocode failed, falling back:', err.message);
      }
    }
    const results = await geocode(q);
    res.json(results);
  } catch (err) {
    console.error('geocode error', err.message);
    res.status(502).json({ error: 'Address lookup failed. Try again.' });
  }
});

// GET /api/reverse-geocode?lat=&lng= — powers the kiosk "This trip" button.
router.get('/reverse-geocode', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'lat and lng are required.' });
  }
  try {
    const result = await reverseGeocode(lat, lng);
    if (!result) return res.status(404).json({ error: 'No address found for that location.' });
    res.json(result);
  } catch (err) {
    console.error('reverse geocode error', err.message);
    res.status(502).json({ error: 'Location lookup failed. Try again.' });
  }
});

// POST /api/estimate  { pickup:{lat,lng}, dropoff:{lat,lng} }
router.post('/estimate', async (req, res) => {
  const { pickup, dropoff, when } = req.body || {};
  try {
    res.json(await estimate(pickup, dropoff, when));
  } catch (err) {
    console.error('estimate error', err.message);
    res.status(502).json({ error: 'Could not estimate the fare. Try again.' });
  }
});

module.exports = router;
