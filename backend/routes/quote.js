const express = require('express');
const { geocode } = require('../services/geocode');
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

// POST /api/estimate  { pickup:{lat,lng}, dropoff:{lat,lng} }
router.post('/estimate', (req, res) => {
  const { pickup, dropoff } = req.body || {};
  res.json(estimate(pickup, dropoff));
});

module.exports = router;
