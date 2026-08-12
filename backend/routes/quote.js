const express = require('express');
const { geocode, resolvePlace } = require('../services/geocode');
const { estimate, estimateRoute } = require('../services/fare');
const google = require('../services/googleMaps');

const router = express.Router();

// GET /api/geocode?q=...&session=...
//
// `session` is a client-generated UUID held for the duration of one
// address entry (see AddressInput.jsx). Passing it through is what makes
// Google bill a whole typing session as one request instead of one per
// keystroke. It is optional — omit it and everything still works, just
// more expensively.
router.get('/geocode', async (req, res) => {
  try {
    const results = await geocode(req.query.q || '', 5, req.query.session || null);
    res.json(results);
  } catch (err) {
    console.error('geocode error', err.message);
    res.status(502).json({ error: 'Address lookup failed. Try again.' });
  }
});

// POST /api/place  { placeId, address, session }
//
// Second half of the autocomplete handshake: resolve the ONE suggestion
// the rider picked into real coordinates. Google's autocomplete
// deliberately returns no lat/lng, so without this a picked address has
// no coordinates — and an address with no coordinates cannot be routed,
// priced accurately, or shown to a driver on a map.
router.post('/place', async (req, res) => {
  const { placeId, address, lat, lng, session } = req.body || {};
  try {
    const resolved = await resolvePlace({ placeId, address, lat, lng }, session || null);
    if (!resolved) {
      // Soft failure by design. The rider keeps the address text they
      // typed and can still book; the trip just falls back to the
      // straight-line fare and the driver navigates by address string.
      return res.json({ address: address || '', lat: null, lng: null, resolved: false });
    }
    res.json({ ...resolved, resolved: true });
  } catch (err) {
    console.error('place resolve error', err.message);
    res.status(502).json({ error: 'Could not resolve that address.' });
  }
});

// POST /api/estimate  { pickup:{lat,lng}, dropoff:{lat,lng}, scheduledAt? }
//
// scheduledAt is optional but worth sending: it lets the routing layer
// price the trip against predicted traffic for the hour the ride
// actually happens, which for a scheduled-ride product is the whole
// point of the category.
router.post('/estimate', async (req, res) => {
  const { pickup, dropoff, scheduledAt } = req.body || {};
  try {
    const quote = await estimateRoute(pickup, dropoff, scheduledAt || null);
    res.json(quote);
  } catch (err) {
    // estimateRoute already swallows provider failures internally, so
    // reaching here means something unexpected. Still answer with a
    // price rather than an error — a rider must always get a quote.
    console.error('estimate error', err.message);
    res.json(estimate(pickup, dropoff));
  }
});

// GET /api/maps/status — does the client have a usable map?
//
// Lets the frontend decide between rendering a real map and rendering
// the static fallback, without shipping a second copy of the "is it
// configured" logic to the browser.
router.get('/maps/status', (req, res) => {
  res.json({
    serverRouting: google.isConfigured(),
    // Reflects the browser key, which is a separate credential. It is
    // read from the server's view of the environment purely so the
    // client gets one authoritative answer.
    browserKeyConfigured: (process.env.VITE_GOOGLE_MAPS_API_KEY || '').length > 10,
  });
});

module.exports = router;
