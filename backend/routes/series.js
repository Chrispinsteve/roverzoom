const express = require('express');
const supabase = require('../db/supabase');
const { canSkip, canUnskip, SKIP_REASON, SKIP_CUTOFF_MINUTES } = require('../services/rideSeries');

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
