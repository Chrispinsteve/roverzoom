const express = require('express');
const supabase = require('../db/supabase');
const { requireDriver, requireActiveDriver, requireCompleteProfile } = require('../middleware/requireDriver');
const { driverPayout } = require('../services/payout');
const { briefAddress } = require('../services/address');
const { sendDriverAcceptedNotification } = require('../services/sms');

const router = express.Router();

// A driver must be able to see and accept EVERY upcoming booking a rider can
// make — otherwise a saved booking silently strands the rider. Riders can
// schedule up to 14 days out (kiosk lib/datetime.js), so there is deliberately
// NO upper time bound here: any unclaimed future booking is browsable. The
// only bound is a grace on the lower end (below) so an imminent or slightly
// past ride stays claimable instead of vanishing the moment its time ticks by.
const AVAILABLE_GRACE_HOURS = Number(process.env.AVAILABLE_GRACE_HOURS) || 6;

function withPayout(booking) {
  return { ...booking, driver_payout: driverPayout(Number(booking.fare)) };
}

// GET /api/driver/schedule — this driver's own upcoming + recent bookings.
// requireDriver only: a pending/suspended driver can see their own (likely
// empty) schedule — harmless, no need to also gate on active. Dropoff stays
// exact here — these are the driver's own assigned/completed rides, not the
// pre-claim browse list.
router.get('/schedule', requireDriver, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('driver_id', req.driver.id)
      .order('scheduled_at', { ascending: true });
    if (error) throw error;
    res.json((data || []).map(withPayout));
  } catch (err) {
    console.error('driver schedule fetch error', err.message);
    res.status(500).json({ error: 'Could not fetch schedule.' });
  }
});

// GET /api/driver/available-trips — unclaimed upcoming bookings, browsable window.
// requireCompleteProfile: this is the actual access gate in the no-online-toggle
// "open marketplace" model — a driver with an incomplete profile can't browse.
// Dropoff is redacted to city/area only (briefAddress) until claimed — exact
// address + coordinates are withheld pre-commitment.
router.get('/available-trips', requireDriver, requireActiveDriver, requireCompleteProfile, async (req, res) => {
  try {
    const windowStart = new Date(Date.now() - AVAILABLE_GRACE_HOURS * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .is('driver_id', null)
      .in('status', ['confirmed', 'dispatching'])
      .gte('scheduled_at', windowStart)
      .order('scheduled_at', { ascending: true });
    if (error) throw error;
    const redacted = (data || []).map((b) => withPayout({
      ...b,
      dropoff_address: briefAddress(b.dropoff_address),
      dropoff_lat: null,
      dropoff_lng: null,
    }));
    res.json(redacted);
  } catch (err) {
    console.error('available trips fetch error', err.message);
    res.status(500).json({ error: 'Could not fetch available trips.' });
  }
});

// POST /api/driver/bookings/:bookingId/claim — instant guarded assignment,
// first-accept-wins via the atomic guarded UPDATE (only succeeds if
// driver_id is still null). Response includes the now-unlocked exact
// dropoff (already in the row — no redaction past this point).
router.post('/bookings/:bookingId/claim', requireDriver, requireActiveDriver, requireCompleteProfile, async (req, res) => {
  const { bookingId } = req.params;

  try {
    const { data, error } = await supabase
      .from('bookings')
      .update({ driver_id: req.driver.id, status: 'driver_assigned', accepted_at: new Date().toISOString() })
      .eq('id', bookingId)
      .is('driver_id', null)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({ error: 'This trip was already claimed by another driver.' });

    // The claim SUCCEEDED. Message #2 (driver accepted + tracking link) is
    // best-effort — wrapped so a texting failure can never surface as a claim
    // error and make the driver think they lost the ride.
    try {
      await sendDriverAcceptedNotification(data, req.driver);
    } catch (smsErr) {
      console.error('driver-accepted sms failed (non-fatal)', smsErr.message);
    }

    res.json(withPayout(data));
  } catch (err) {
    console.error('claim booking error', err.message);
    res.status(500).json({ error: 'Could not claim trip.' });
  }
});

// POST /api/driver/bookings/:bookingId/status — advances a claimed booking
// through the real trip lifecycle. Each transition is a guarded UPDATE that
// only succeeds from the expected prior status, so a stale/duplicate client
// action (e.g. double-tapping "Arrived") fails safely with 409 instead of
// silently re-applying. `complete` is special-cased through the
// complete_booking() RPC since it also has to write the earnings ledger and
// bump rides_completed atomically alongside the status flip.
const TRANSITIONS = {
  en_route: { from: 'driver_assigned', to: 'driver_en_route', column: 'en_route_at' },
  arrived: { from: 'driver_en_route', to: 'arrived', column: 'arrived_at' },
  start: { from: 'arrived', to: 'in_progress', column: 'started_at' },
};

router.post('/bookings/:bookingId/status', requireDriver, requireActiveDriver, async (req, res) => {
  const { bookingId } = req.params;
  const { event } = req.body || {};

  if (event === 'complete') {
    try {
      const { data: booking, error: fetchErr } = await supabase
        .from('bookings')
        .select('fare, status, driver_id')
        .eq('id', bookingId)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!booking || booking.driver_id !== req.driver.id) {
        return res.status(404).json({ error: 'Trip not found.' });
      }
      if (booking.status !== 'in_progress') {
        return res.status(409).json({ error: 'Trip is not in progress.' });
      }

      const amount = driverPayout(Number(booking.fare));
      const { data, error } = await supabase.rpc('complete_booking', {
        p_booking_id: bookingId,
        p_driver_id: req.driver.id,
        p_earnings_amount: amount,
      });
      if (error) throw error;
      return res.json(withPayout(data));
    } catch (err) {
      console.error('complete booking error', err.message);
      return res.status(500).json({ error: 'Could not complete trip.' });
    }
  }

  const transition = TRANSITIONS[event];
  if (!transition) return res.status(400).json({ error: 'Invalid status event.' });

  try {
    const { data, error } = await supabase
      .from('bookings')
      .update({ status: transition.to, [transition.column]: new Date().toISOString() })
      .eq('id', bookingId)
      .eq('driver_id', req.driver.id)
      .eq('status', transition.from)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({ error: `Trip is not in the expected state for "${event}".` });
    res.json(withPayout(data));
  } catch (err) {
    console.error('booking status transition error', err.message);
    res.status(500).json({ error: 'Could not update trip status.' });
  }
});

// POST /api/driver/bookings/:bookingId/release — hands a claimed (not yet
// started) booking back to the open pool. Allowed only while the trip is
// still in 'driver_assigned' and pickup is more than RELEASE_CUTOFF_HOURS
// away — inside that window the rider is counting on this specific driver,
// so releasing requires contacting support instead. Same guarded-UPDATE
// pattern as claim: the WHERE clause enforces ownership + status, so a
// stale double-tap or a race with en_route fails safely with 409.
const RELEASE_CUTOFF_HOURS = Number(process.env.RELEASE_CUTOFF_HOURS) || 2;

router.post('/bookings/:bookingId/release', requireDriver, requireActiveDriver, async (req, res) => {
  const { bookingId } = req.params;
  try {
    const { data: booking, error: fetchErr } = await supabase
      .from('bookings')
      .select('id, driver_id, status, scheduled_at')
      .eq('id', bookingId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!booking || booking.driver_id !== req.driver.id) {
      return res.status(404).json({ error: 'Trip not found.' });
    }
    if (booking.status !== 'driver_assigned') {
      return res.status(409).json({ error: 'A trip can only be released before you start driving to it.' });
    }
    const hoursOut = (new Date(booking.scheduled_at) - Date.now()) / 36e5;
    if (hoursOut < RELEASE_CUTOFF_HOURS) {
      return res.status(409).json({
        error: `Pickup is less than ${RELEASE_CUTOFF_HOURS}h away — the rider is counting on you. Contact support if you truly can't make it.`,
      });
    }

    const { data, error } = await supabase
      .from('bookings')
      .update({ driver_id: null, status: 'confirmed', accepted_at: null })
      .eq('id', bookingId)
      .eq('driver_id', req.driver.id)
      .eq('status', 'driver_assigned')
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({ error: 'Trip could not be released.' });
    res.json({ released: true, bookingId });
  } catch (err) {
    console.error('release booking error', err.message);
    res.status(500).json({ error: 'Could not release trip.' });
  }
});

// GET /api/driver/earnings — real ledger-backed summary + history.
router.get('/earnings', requireDriver, async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: earnings, error } = await supabase
      .from('driver_earnings')
      .select('*')
      .eq('driver_id', req.driver.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;

    const todayTotal = (earnings || [])
      .filter((e) => e.created_at >= startOfToday)
      .reduce((sum, e) => sum + Number(e.amount), 0);
    const weekTotal = (earnings || [])
      .filter((e) => e.created_at >= startOfWeek)
      .reduce((sum, e) => sum + Number(e.amount), 0);

    const { data: payouts, error: payoutsErr } = await supabase
      .from('driver_payouts')
      .select('*')
      .eq('driver_id', req.driver.id)
      .order('period_end', { ascending: false })
      .limit(12);
    if (payoutsErr) throw payoutsErr;

    res.json({
      todayTotal: Math.round(todayTotal * 100) / 100,
      weekTotal: Math.round(weekTotal * 100) / 100,
      recent: earnings || [],
      payouts: payouts || [],
    });
  } catch (err) {
    console.error('earnings fetch error', err.message);
    res.status(500).json({ error: 'Could not fetch earnings.' });
  }
});

// --- Profile completion: photo / license / insurance upload -----------------
// driver-photos is a PUBLIC bucket (riders see this once matched); driver-
// documents is PRIVATE (license/insurance are never shown to riders).
const UPLOAD_BUCKETS = { photo: 'driver-photos', license: 'driver-documents', insurance: 'driver-documents' };
const UPLOAD_COLUMNS = { photo: 'photo_url', license: 'license_photo_url', insurance: 'insurance_photo_url' };

// POST /api/driver/profile/upload-url — server-side signed upload URL, so the
// file itself goes straight from the driver's browser to Storage rather than
// being proxied through this API.
router.post('/profile/upload-url', requireDriver, async (req, res) => {
  const { type } = req.body || {};
  const bucket = UPLOAD_BUCKETS[type];
  if (!bucket) return res.status(400).json({ error: 'Invalid document type.' });

  const path = `${req.driver.id}/${type}-${Date.now()}.jpg`;
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
    if (error) throw error;
    res.json({ bucket, path, token: data.token });
  } catch (err) {
    console.error('upload-url error', err.message);
    res.status(500).json({ error: 'Could not create an upload link. Try again in a moment.' });
  }
});

// POST /api/driver/profile/documents — records a completed upload and
// recomputes profile_completed_at. license/insurance store the raw storage
// path (private bucket — never rendered as an image, just checked for
// presence); photo stores the actual public URL since riders load it directly.
router.post('/profile/documents', requireDriver, async (req, res) => {
  const { type, path } = req.body || {};
  const column = UPLOAD_COLUMNS[type];
  if (!column || !path) return res.status(400).json({ error: 'Invalid document type or path.' });

  let valueToStore = path;
  if (type === 'photo') {
    const { data: pub } = supabase.storage.from(UPLOAD_BUCKETS.photo).getPublicUrl(path);
    valueToStore = pub.publicUrl;
  }

  try {
    const nextValues = {
      photo_url: req.driver.photo_url,
      license_photo_url: req.driver.license_photo_url,
      insurance_photo_url: req.driver.insurance_photo_url,
      [column]: valueToStore,
    };
    const complete = !!(nextValues.photo_url && nextValues.license_photo_url && nextValues.insurance_photo_url);

    const { data, error } = await supabase
      .from('drivers')
      .update({ [column]: valueToStore, profile_completed_at: complete ? new Date().toISOString() : null })
      .eq('id', req.driver.id)
      .select()
      .maybeSingle();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('profile documents error', err.message);
    res.status(500).json({ error: 'Could not save document.' });
  }
});

// POST /api/driver/bookings/:bookingId/rate-rider — the completed-trip star
// rating (driver_rating_of_rider already existed in schema with a 1-5 CHECK
// constraint; only settable once, on the driver's own completed booking).
router.post('/bookings/:bookingId/rate-rider', requireDriver, async (req, res) => {
  const { bookingId } = req.params;
  const rating = Number(req.body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be an integer from 1 to 5.' });
  }

  try {
    const { data, error } = await supabase
      .from('bookings')
      .update({ driver_rating_of_rider: rating })
      .eq('id', bookingId)
      .eq('driver_id', req.driver.id)
      .eq('status', 'completed')
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Completed trip not found.' });
    res.json(data);
  } catch (err) {
    console.error('rate rider error', err.message);
    res.status(500).json({ error: 'Could not save rating.' });
  }
});

module.exports = router;
