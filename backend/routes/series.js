const express = require('express');
const supabase = require('../db/supabase');
const { canSkip, canUnskip, SKIP_REASON, SKIP_CUTOFF_MINUTES, generateForSeries } = require('../services/rideSeries');

const router = express.Router();

// Recurring rides, managed by the rider without an account.
//
// The series id IS the token: a v4 UUID, unguessable, handed out in the
// rider's own confirmation. Exactly the trust model the tracking link already
// uses — no login, no password to forget, nothing to reset at 6am when someone
// needs to call off today's ride.
//
// An irregular WEEK needs nothing here: someone who works Monday, Wednesday,
// Thursday and Friday is days_of_week [1,3,4,5]. These endpoints are for the
// other case — a normal week with one day off.

// Only the fields a rider should see. The series row also carries the
// preferred driver and internal bookkeeping, which is nobody's business on a
// public link.
const RIDER_FIELDS = 'id,rider_name,pickup_address,dropoff_address,pickup_time,timezone,days_of_week,status,starts_on,ends_on';

async function loadSeries(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  const { data } = await supabase.from('ride_series').select(RIDER_FIELDS).eq('id', id).maybeSingle();
  return data || null;
}

// POST /api/series — create a recurring ride and materialise the first rides.
//
// Separate from POST /api/bookings rather than a flag on it. A series is not a
// booking with an extra field: it has no single scheduled_at, no reference, and
// no fare of its own — it is the thing that PRODUCES those. Folding it into the
// booking endpoint would mean every caller of that endpoint learning which half
// of the payload applies.
router.post('/', async (req, res) => {
  const { rider, pickup, dropoff, daysOfWeek, pickupTime, startsOn, paymentMethod } = req.body || {};

  if (!rider?.name || !rider?.phone) return res.status(400).json({ error: 'Name and phone are required.' });
  if (!pickup?.address || !dropoff?.address) return res.status(400).json({ error: 'Pickup and destination are required.' });
  const days = Array.isArray(daysOfWeek) ? [...new Set(daysOfWeek.map(Number))].filter((d) => d >= 0 && d <= 6) : [];
  if (!days.length) return res.status(400).json({ error: 'Choose at least one day.' });
  if (!/^\d{2}:\d{2}$/.test(String(pickupTime || ''))) return res.status(400).json({ error: 'A pickup time is required.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startsOn || ''))) return res.status(400).json({ error: 'A start date is required.' });

  const { data: series, error } = await supabase.from('ride_series').insert({
    rider_name: rider.name, rider_phone: rider.phone, rider_email: rider.email || null,
    pickup_address: pickup.address, pickup_lat: pickup.lat ?? null, pickup_lng: pickup.lng ?? null,
    dropoff_address: dropoff.address, dropoff_lat: dropoff.lat ?? null, dropoff_lng: dropoff.lng ?? null,
    days_of_week: days.sort(), pickup_time: pickupTime, starts_on: startsOn,
    // Cash until the off-session card work exists. A card series would create
    // rides nobody can charge without the rider present, which is worse than
    // saying plainly that we take payment per ride for now.
    payment_method: paymentMethod === 'card' ? 'card' : 'cash',
    status: 'active',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Generate immediately: a rider who has just set this up should see their
  // schedule, not an empty page waiting on a cron that may be hours away.
  const gen = await generateForSeries(series);
  if (gen.error) {
    // Nothing was materialised, so the series would sit inert and confusing.
    await supabase.from('ride_series').delete().eq('id', series.id);
    return res.status(400).json({ error: gen.error });
  }

  res.status(201).json({ id: series.id, created: gen.created, through: gen.through });
});

// GET /api/series/:id — the schedule, and which days are already off.
router.get('/:id', async (req, res) => {
  const series = await loadSeries(req.params.id);
  if (!series) return res.status(404).json({ error: 'Not found' });

  const today = new Date().toISOString().slice(0, 10);
  const { data: rides, error } = await supabase
    .from('bookings')
    // series_id is selected because canSkip() READS it. Left out, the guard sees
    // undefined, decides this is not a recurring ride, and hides every button —
    // a permanently-false gate that looks exactly like working code.
    .select('id,series_id,reference,series_date,scheduled_at,status,fare,canceled_by,cancel_reason')
    .eq('series_id', series.id)
    .gte('series_date', today)
    .order('series_date');
  if (error) return res.status(500).json({ error: error.message });

  const now = new Date();
  res.json({
    series,
    // Each ride says whether it can be changed AND why not, so the screen can
    // explain itself instead of showing a button that silently does nothing.
    rides: (rides || []).map((r) => ({
      date: r.series_date,
      scheduled_at: r.scheduled_at,
      reference: r.reference,
      fare: r.fare,
      skipped: r.status === 'canceled',
      skippable: canSkip(r, now),
      restorable: canUnskip(r, now),
    })),
    cutoffMinutes: SKIP_CUTOFF_MINUTES,
  });
});

// Shared by both actions: find the one ride, check it belongs to this series.
async function rideFor(seriesId, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return { error: 'bad_date' };
  const { data } = await supabase
    .from('bookings')
    .select('id,series_id,series_date,scheduled_at,status,canceled_by,cancel_reason')
    .eq('series_id', seriesId)
    .eq('series_date', date)
    .maybeSingle();
  return { ride: data || null };
}

// POST /api/series/:id/skip — "I am not working that day."
router.post('/:id/skip', async (req, res) => {
  const series = await loadSeries(req.params.id);
  if (!series) return res.status(404).json({ error: 'Not found' });

  const { ride, error: badDate } = await rideFor(series.id, req.body?.date);
  if (badDate) return res.status(400).json({ error: 'A date is required, as YYYY-MM-DD.' });

  const verdict = canSkip(ride, new Date());
  if (!verdict.ok) return res.status(409).json({ error: verdict.reason });

  // A skip is an ordinary cancellation with a sentinel reason. That sentinel is
  // what makes un-skipping safe later: only a rider's own skip can be undone,
  // never a cancellation made by dispatch or a driver.
  const { error } = await supabase.from('bookings').update({
    status: 'canceled',
    canceled_at: new Date().toISOString(),
    canceled_by: 'rider',
    cancel_reason: SKIP_REASON,
  }).eq('id', ride.id).eq('status', 'confirmed'); // lost race = someone else moved it first
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true, date: ride.series_date, skipped: true });
});

// POST /api/series/:id/unskip — "actually, I am working after all."
router.post('/:id/unskip', async (req, res) => {
  const series = await loadSeries(req.params.id);
  if (!series) return res.status(404).json({ error: 'Not found' });

  const { ride, error: badDate } = await rideFor(series.id, req.body?.date);
  if (badDate) return res.status(400).json({ error: 'A date is required, as YYYY-MM-DD.' });

  const verdict = canUnskip(ride, new Date());
  if (!verdict.ok) return res.status(409).json({ error: verdict.reason });

  const { error } = await supabase.from('bookings').update({
    status: 'confirmed',
    canceled_at: null,
    canceled_by: null,
    cancel_reason: null,
  }).eq('id', ride.id).eq('cancel_reason', SKIP_REASON); // never revive someone else's cancellation
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true, date: ride.series_date, skipped: false });
});

module.exports = router;
