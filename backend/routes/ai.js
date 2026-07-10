const express = require('express');
const { parseBooking, isConfigured } = require('../services/ai');
const { geocodeOne } = require('../services/geocode');
const { estimate } = require('../services/fare');
const { makeReference } = require('../services/reference');
const supabase = require('../db/supabase');

const router = express.Router();

// GET /api/ai/status
router.get('/status', (req, res) => {
  res.json({ configured: isConfigured() });
});

// POST /api/ai/chat  { history: [{role, content}, ...] }
// When Bob has all the info, creates the booking directly and returns it.
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

    // Bob collected everything — create the booking.
    const d = result.data;

    // Geocode for coordinates (best-effort)
    const [pickupGeo, dropoffGeo] = await Promise.all([
      geocodeOne(d.pickup).catch(() => null),
      geocodeOne(d.dropoff).catch(() => null),
    ]);

    const pickup = pickupGeo
      ? { address: pickupGeo.address, lat: pickupGeo.lat, lng: pickupGeo.lng }
      : { address: d.pickup };
    const dropoff = dropoffGeo
      ? { address: dropoffGeo.address, lat: dropoffGeo.lat, lng: dropoffGeo.lng }
      : { address: d.dropoff };

    const quote = estimate(pickup, dropoff);
    const reference = makeReference();

    // Insert into Supabase
    const { data: booking, error: dbErr } = await supabase
      .from('bookings')
      .insert({
        reference,
        pickup_address: pickup.address,
        pickup_lat: pickup.lat ?? null,
        pickup_lng: pickup.lng ?? null,
        dropoff_address: dropoff.address,
        dropoff_lat: dropoff.lat ?? null,
        dropoff_lng: dropoff.lng ?? null,
        scheduled_at: d.datetime_iso,
        distance_miles: quote.distanceMiles,
        duration_minutes: quote.durationMinutes,
        fare: quote.fare,
        payment_method: d.payment_method,
        rider_name: d.rider_name,
        rider_phone: d.rider_phone,
        rider_email: d.rider_email || null,
        source: 'ai',
      })
      .select()
      .single();

    if (dbErr) throw dbErr;

    res.json({
      type: 'booking_confirmed',
      note: result.note,
      booking,
    });
  } catch (err) {
    if (err.code === 'AI_NOT_CONFIGURED') {
      return res.status(503).json({ error: err.message, code: 'AI_NOT_CONFIGURED' });
    }
    console.error('ai chat error', err.message);
    res.status(502).json({ error: 'Bob had trouble with that. Please try again.' });
  }
});

module.exports = router;
