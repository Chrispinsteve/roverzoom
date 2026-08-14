const express = require('express');
const supabase = require('../db/supabase');
const { requireDriver, requireUser, requireActiveDriver, requireCompleteProfile } = require('../middleware/requireDriver');
const { driverPayout } = require('../services/payout');
const { briefAddress } = require('../services/address');
const { sendDriverAcceptedNotification } = require('../services/sms');
const { stripe } = require('../services/stripe');
const checkr = require('../services/checkr');
const { getScreening, setScreening } = require('../services/screening');

const router = express.Router();

// A driver must be able to see and accept EVERY upcoming booking a rider can
// make — otherwise a saved booking silently strands the rider. Riders can
// schedule up to 14 days out (kiosk lib/datetime.js), so there is deliberately
// NO upper time bound here: any unclaimed future booking is browsable. The
// only bound is a grace on the lower end (below) so an imminent or slightly
// past ride stays claimable instead of vanishing the moment its time ticks by.
const AVAILABLE_GRACE_HOURS = Number(process.env.AVAILABLE_GRACE_HOURS) || 6;

function withPayout(booking) {
  return { ...booking, driver_payout: driverPayout(Number(booking.fare), booking.scheduled_at) };
}

// POST /api/driver/ensure-profile — self-heal a missing driver row.
//
// Normally the drivers row is created atomically with the auth account by the
// on_auth_user_created trigger (schema.sql). If that trigger isn't installed on
// a given database — or an account predates it — a driver can log in yet have
// no profile row, and every driver endpoint then 403s "no driver profile".
// This repairs exactly that dead-end.
//
// Runs under requireUser (proves identity, does NOT need a driver row) and, via
// the service role, creates the missing row from the SAME whitelist the trigger
// uses: name/phone/vehicle_* from the user's own signup metadata; email from the
// real auth row; status/rating/etc. are never accepted from the client and take
// their column DEFAULTs. Idempotent: an existing row is returned untouched.
router.post('/ensure-profile', requireUser, async (req, res) => {
  const user = req.authUser;
  try {
    const { data: existing, error: exErr } = await supabase
      .from('drivers')
      .select('*')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (exErr) throw exErr;
    if (existing) return res.json({ driver: existing, created: false });

    const meta = user.user_metadata || {};
    const insert = {
      auth_user_id: user.id,
      name: meta.name || null,
      phone: meta.phone || null,
      email: user.email || null,
      vehicle_make: meta.vehicle_make || null,
      vehicle_model: meta.vehicle_model || null,
      vehicle_color: meta.vehicle_color || null,
      vehicle_plate: meta.vehicle_plate || null,
      // Match the signup trigger exactly, which sets 'active' (the current
      // temporary stance until verification/an admin dashboard exists). Without
      // this the row would default to 'pending_verification' and a self-healed
      // driver would be stranded on the review screen — the opposite of what a
      // trigger-created account gets. This is a hardcoded server value, never
      // read from client-controlled metadata, so it can't be used to
      // self-activate anything the trigger wouldn't have. rating/rides_completed
      // stay at their DEFAULTs.
      status: 'active',
    };

    if (!insert.name || !insert.phone) {
      return res.status(422).json({
        error: 'Your account is missing details needed to build a driver profile. Please contact support.',
        code: 'incomplete_signup',
      });
    }

    const { data: created, error: insErr } = await supabase
      .from('drivers')
      .insert(insert)
      .select()
      .single();

    if (insErr) {
      if (insErr.code === '23505') {
        return res.status(409).json({
          error: 'A driver profile with these details already exists. Please contact support to reconnect it.',
          code: 'profile_conflict',
        });
      }
      throw insErr;
    }

    res.status(201).json({ driver: created, created: true });
  } catch (err) {
    console.error('ensure-profile error', err.message);
    res.status(500).json({ error: 'Could not set up your driver profile.' });
  }
});

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
        .select('fare, scheduled_at, status, driver_id')
        .eq('id', bookingId)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!booking || booking.driver_id !== req.driver.id) {
        return res.status(404).json({ error: 'Trip not found.' });
      }
      if (booking.status !== 'in_progress') {
        return res.status(409).json({ error: 'Trip is not in progress.' });
      }

      const amount = driverPayout(Number(booking.fare), booking.scheduled_at);
      const { data, error } = await supabase.rpc('complete_booking', {
        p_booking_id: bookingId,
        p_driver_id: req.driver.id,
        p_earnings_amount: amount,
      });
      if (error) throw error;
      return res.json(withPayout({ ...data, scheduled_at: data.scheduled_at || booking.scheduled_at }));
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

// --- Driver payouts: Stripe Connect Express --------------------------------
// Drivers get paid through a Stripe Connect Express connected account: Stripe
// hosts the onboarding (bank account / debit card + identity), so we never
// store sensitive payout data, and the account's `payouts_enabled` flag is the
// source of truth. We keep only a POINTER to the account. Since this
// environment can't run DDL to add a drivers column, that pointer lives in the
// driver's Supabase Auth app_metadata (server-controlled, not user-editable)
// instead of a new column — Stripe still owns the actual payout state.
async function getConnectAccountId(driver) {
  if (!driver.auth_user_id) return null;
  const { data, error } = await supabase.auth.admin.getUserById(driver.auth_user_id);
  if (error) throw error;
  return data?.user?.app_metadata?.stripe_connect_account_id || null;
}

async function setConnectAccountId(driver, accountId) {
  const { data, error: getErr } = await supabase.auth.admin.getUserById(driver.auth_user_id);
  if (getErr) throw getErr;
  const app_metadata = { ...(data?.user?.app_metadata || {}), stripe_connect_account_id: accountId };
  const { error } = await supabase.auth.admin.updateUserById(driver.auth_user_id, { app_metadata });
  if (error) throw error;
}

function payoutBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || 'https://roverzoom.com').replace(/\/+$/, '');
}

// POST /api/driver/payouts/onboard — start or resume Connect Express onboarding.
// Returns { url } to Stripe's hosted onboarding; the frontend redirects there.
router.post('/payouts/onboard', requireDriver, async (req, res) => {
  const s = stripe();
  if (!s) return res.status(503).json({ error: 'Payouts are not configured yet.' });
  if (!req.driver.auth_user_id) return res.status(400).json({ error: 'This account can’t set up payouts.' });

  try {
    let accountId = await getConnectAccountId(req.driver);
    if (!accountId) {
      const account = await s.accounts.create({
        type: 'express',
        email: req.driver.email || undefined,
        business_type: 'individual',
        capabilities: { transfers: { requested: true } },
        metadata: { driver_id: req.driver.id },
      });
      accountId = account.id;
      await setConnectAccountId(req.driver, accountId);
    }
    const base = payoutBaseUrl();
    const link = await s.accountLinks.create({
      account: accountId,
      refresh_url: `${base}/?driver=payouts&refresh=1`,
      return_url: `${base}/?driver=payouts`,
      type: 'account_onboarding',
    });
    res.json({ url: link.url });
  } catch (err) {
    console.error('payout onboard error', err.message);
    const notEnabled = /connect/i.test(err.message || '');
    res.status(notEnabled ? 503 : 500).json({
      error: notEnabled
        ? 'Stripe Connect isn’t enabled on this platform account yet.'
        : 'Could not start payout setup. Please try again.',
    });
  }
});

// GET /api/driver/payouts/status — where this driver stands: not started,
// onboarding in progress, or fully enabled to receive payouts.
router.get('/payouts/status', requireDriver, async (req, res) => {
  const s = stripe();
  if (!s) return res.json({ configured: false, connected: false, payoutsEnabled: false });
  try {
    const accountId = await getConnectAccountId(req.driver);
    if (!accountId) return res.json({ configured: true, connected: false, payoutsEnabled: false });
    const acct = await s.accounts.retrieve(accountId);
    res.json({
      configured: true,
      connected: true,
      detailsSubmitted: !!acct.details_submitted,
      payoutsEnabled: !!acct.payouts_enabled,
    });
  } catch (err) {
    console.error('payout status error', err.message);
    res.status(500).json({ error: 'Could not fetch payout status.' });
  }
});

// --- Driver background check: Checkr ---------------------------------------
// Hosted flow: we create a candidate + invitation, the driver completes the
// SSN/DOB/license entry on Checkr's page, and the /api/checkr/webhook activates
// them when the report comes back clear. Dormant unless CHECKR_API_KEY is set.

// POST /api/driver/screening/start — begin (or resume) the background check.
// Returns { status, url } where url is Checkr's hosted invitation to open.
router.post('/screening/start', requireDriver, async (req, res) => {
  if (!checkr.isConfigured()) return res.status(503).json({ error: 'Background checks are not configured yet.' });
  if (!req.driver.auth_user_id) return res.status(400).json({ error: 'This account can’t start a background check.' });
  try {
    const scr = await getScreening(req.driver);
    if (scr.status === 'clear') return res.json({ status: 'clear' });

    let candidateId = scr.candidateId;
    if (!candidateId) {
      const parts = (req.driver.name || '').trim().split(/\s+/);
      const cand = await checkr.createCandidate({
        email: req.driver.email,
        firstName: parts[0] || undefined,
        lastName: parts.slice(1).join(' ') || undefined,
        driverId: req.driver.id,
      });
      candidateId = cand.id;
    }
    const inv = await checkr.createInvitation({
      candidateId,
      pkg: process.env.CHECKR_PACKAGE || 'driver_pro',
      state: process.env.CHECKR_WORK_STATE || 'FL',
    });
    await setScreening(req.driver.auth_user_id, { candidateId, status: 'pending', invitationUrl: inv.invitation_url });
    res.json({ status: 'pending', url: inv.invitation_url });
  } catch (err) {
    console.error('screening start error', err.message);
    res.status(500).json({ error: 'Could not start the background check. Please try again.' });
  }
});

// GET /api/driver/screening/status — where the driver's check stands.
router.get('/screening/status', requireDriver, async (req, res) => {
  if (!checkr.isConfigured()) return res.json({ configured: false, status: 'not_configured' });
  try {
    const scr = await getScreening(req.driver);
    res.json({ configured: true, status: scr.status, url: scr.invitationUrl });
  } catch (err) {
    console.error('screening status error', err.message);
    res.status(500).json({ error: 'Could not fetch screening status.' });
  }
});

// ============================================================
// Live tracking — GPS ingest + online toggle
// ============================================================
// Statuses during which a driver is physically moving on behalf of a trip.
// Pings are attributed to a booking (and the rider is shown a moving car)
// only while a booking is in one of these.
const TRACKING_ACTIVE_STATUSES = ['driver_en_route', 'arrived', 'in_progress'];

const MS_PER_SEC_TO_MPH = 2.236936;

// Sanitize one GPS fix from the client. Returns a DB-shaped row or null if the
// fix is unusable (bad coords). Never trusts client values blindly.
function validPing(p) {
  if (!p || typeof p !== 'object') return null;
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const recordedAt = p.recordedAt ? new Date(p.recordedAt) : new Date();
  const accuracy = Number(p.accuracy);
  return {
    lat,
    lng,
    heading: Number.isFinite(Number(p.heading)) ? Number(p.heading) : null,
    speed_mph: Number.isFinite(Number(p.speedMph)) ? Number(p.speedMph) : null,
    accuracy_m: Number.isFinite(accuracy) ? accuracy : null,
    recorded_at: (isNaN(recordedAt) ? new Date() : recordedAt).toISOString(),
  };
}

// POST /api/driver/location  { bookingId?, pings: [{ lat, lng, heading?, speedMph?, accuracy?, recordedAt? }] }
// Accepts a BATCH so the app can sample often but upload rarely (battery,
// request volume, dead-zone tolerance). Stores the breadcrumb trail and mirrors
// the newest fix onto drivers.current_* for fast "where is this driver" reads.
router.post('/location', requireDriver, requireActiveDriver, async (req, res) => {
  const { bookingId, pings } = req.body || {};
  if (!Array.isArray(pings) || pings.length === 0) {
    return res.status(400).json({ error: 'No location pings supplied.' });
  }
  if (pings.length > 200) {
    return res.status(413).json({ error: 'Too many pings in one batch.' });
  }

  const clean = pings.map(validPing).filter(Boolean);
  if (clean.length === 0) return res.json({ accepted: 0, rejected: pings.length });

  try {
    // Attribute pings to a trip only after confirming this driver owns it and
    // it is live — a driver must not be able to write a GPS trail onto another
    // driver's booking (that trail decides fare/no-show disputes).
    let verifiedBookingId = null;
    if (bookingId) {
      const { data: booking, error: bErr } = await supabase
        .from('bookings')
        .select('id, driver_id, status')
        .eq('id', bookingId)
        .maybeSingle();
      if (bErr) throw bErr;
      if (booking && booking.driver_id === req.driver.id && TRACKING_ACTIVE_STATUSES.includes(booking.status)) {
        verifiedBookingId = booking.id;
      }
    }

    const rows = clean.map((p) => ({ ...p, driver_id: req.driver.id, booking_id: verifiedBookingId }));
    const { error: insErr } = await supabase.from('driver_locations').insert(rows);
    if (insErr) throw insErr;

    // Newest by device clock, not array order (a reconnecting client may flush a
    // backlog out of order; stamping an old fix as current drags the marker back).
    const newest = clean.reduce((a, b) => (a.recorded_at > b.recorded_at ? a : b));
    const { error: updErr } = await supabase
      .from('drivers')
      .update({
        current_lat: newest.lat,
        current_lng: newest.lng,
        current_heading: newest.heading,
        current_speed_mph: newest.speed_mph,
        current_accuracy_m: newest.accuracy_m,
        location_updated_at: newest.recorded_at,
      })
      .eq('id', req.driver.id);
    if (updErr) throw updErr;

    res.json({ accepted: clean.length, rejected: pings.length - clean.length });
  } catch (err) {
    console.error('location ingest error', err.message);
    res.status(500).json({ error: 'Could not record location.' });
  }
});

// POST /api/driver/online  { online: boolean }
router.post('/online', requireDriver, requireActiveDriver, async (req, res) => {
  const online = !!(req.body && req.body.online);
  try {
    const { data, error } = await supabase
      .from('drivers')
      .update({ is_online: online })
      .eq('id', req.driver.id)
      .select('id, is_online')
      .maybeSingle();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('online toggle error', err.message);
    res.status(500).json({ error: 'Could not update availability.' });
  }
});

module.exports = router;
