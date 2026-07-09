const express = require('express');
const pool = require('../db/pool');
const { estimate } = require('../services/fare');
const { makeReference } = require('../services/reference');

const router = express.Router();

// POST /api/bookings — create a confirmed booking
router.post('/', async (req, res) => {
  const {
    pickup, dropoff, scheduledAt, paymentMethod,
    rider, source = 'form',
  } = req.body || {};

  if (!pickup?.address || !dropoff?.address || !scheduledAt || !paymentMethod) {
    return res.status(400).json({ error: 'Missing pickup, dropoff, time, or payment method.' });
  }
  if (!rider?.name || !rider?.phone) {
    return res.status(400).json({ error: 'Name and phone are required.' });
  }
  if (!['card', 'cash'].includes(paymentMethod)) {
    return res.status(400).json({ error: 'Payment method must be card or cash.' });
  }

  const { distanceMiles, durationMinutes, fare } = estimate(pickup, dropoff);

  try {
    // Generate a unique reference (retry a couple of times on the rare collision).
    let reference = makeReference();
    for (let attempt = 0; attempt < 3; attempt++) {
      const exists = await pool.query('SELECT 1 FROM bookings WHERE reference = $1', [reference]);
      if (exists.rows.length === 0) break;
      reference = makeReference();
    }

    const result = await pool.query(
      `INSERT INTO bookings (
         reference, pickup_address, pickup_lat, pickup_lng,
         dropoff_address, dropoff_lat, dropoff_lng, scheduled_at,
         distance_miles, duration_minutes, fare, payment_method,
         rider_name, rider_phone, rider_email, source
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        reference, pickup.address, pickup.lat ?? null, pickup.lng ?? null,
        dropoff.address, dropoff.lat ?? null, dropoff.lng ?? null, scheduledAt,
        distanceMiles, durationMinutes, fare, paymentMethod,
        rider.name, rider.phone, rider.email ?? null, source,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('booking insert error', err.message);
    res.status(500).json({ error: 'Could not create booking.' });
  }
});

// GET /api/bookings/:reference — fetch a booking (confirmation screen / lookup)
router.get('/:reference', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM bookings WHERE reference = $1', [
      req.params.reference,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('booking fetch error', err.message);
    res.status(500).json({ error: 'Could not fetch booking.' });
  }
});

module.exports = router;
