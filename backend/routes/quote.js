const express = require('express');
const { geocode, reverseGeocode } = require('../services/geocode');
const { estimate } = require('../services/fare');

const router = express.Router();

// GET /api/geocode?q=...
router.get('/geocode', async (req, res) => {
  try {
    const results = await geocode(req.query.q || '');
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
router.post('/estimate', (req, res) => {
  const { pickup, dropoff } = req.body || {};
  res.json(estimate(pickup, dropoff));
});

module.exports = router;
