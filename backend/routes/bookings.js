const express = require('express');
const supabase = require('../db/supabase');
const { estimate } = require('../services/fare');
const { makeReference } = require('../services/reference');

const router = express.Router();

// Once a driver is assigned, riders should be able to identify them — but
// only this safe subset. Never phone/email/license/insurance/vehicle_plate.
const DRIVER_PUBLIC_FIELDS = 'name, photo_url, rating, vehicle_make, vehicle_model, vehicle_color';

function withDriverInfo(booking) {
  if (!booking) return booking;
  const { drivers, ...rest } = booking;
  return { ...rest, driver: drivers || null };
}

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
  if (!['card', 'cash', 'zelle'].includes(paymentMethod)) {
    return res.status(400).json({ error: 'Payment method must be card, cash, or zelle.' });
  }

  const { distanceMiles, durationMinutes, fare } = estimate(pickup, dropoff);

  try {
    // Generate a unique reference (retry a couple of times on the rare collision).
    let reference = makeReference();
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: existing, error: checkErr } = await supabase
        .from('bookings')
        .select('reference')
        .eq('reference', reference)
        .maybeSingle();
      if (checkErr) throw checkErr;
      if (!existing) break;
      reference = makeReference();
    }

    const { data, error } = await supabase
      .from('bookings')
      .insert({
        reference,
        pickup_address: pickup.address,
        pickup_lat: pickup.lat ?? null,
        pickup_lng: pickup.lng ?? null,
        dropoff_address: dropoff.address,
        dropoff_lat: dropoff.lat ?? null,
        dropoff_lng: dropoff.lng ?? null,
        scheduled_at: scheduledAt,
        distance_miles: distanceMiles,
        duration_minutes: durationMinutes,
        fare,
        payment_method: paymentMethod,
        rider_name: rider.name,
        rider_phone: rider.phone,
        rider_email: rider.email ?? null,
        source,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('booking insert error', err.message);
    res.status(500).json({ error: 'Could not create booking.' });
  }
});

// GET /api/bookings/by-phone/:phone — list a rider's bookings for "My Rides".
// No verification step: matches the app's existing no-account trust model
// (the confirmation page is looked up by reference code the same way), but
// it is NOT a secure access boundary — anyone who knows the phone number
// can see that phone's ride history.
router.get('/by-phone/:phone', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select(`*, drivers(${DRIVER_PUBLIC_FIELDS})`)
      .eq('rider_phone', req.params.phone)
      .order('scheduled_at', { ascending: false });
    if (error) throw error;
    res.json((data || []).map(withDriverInfo));
  } catch (err) {
    console.error('bookings by-phone error', err.message);
    res.status(500).json({ error: 'Could not look up rides.' });
  }
});

// GET /api/bookings/:reference — fetch a booking (confirmation screen / lookup)
router.get('/:reference', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select(`*, drivers(${DRIVER_PUBLIC_FIELDS})`)
      .eq('reference', req.params.reference)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Booking not found.' });
    res.json(withDriverInfo(data));
  } catch (err) {
    console.error('booking fetch error', err.message);
    res.status(500).json({ error: 'Could not fetch booking.' });
  }
});

module.exports = router;
