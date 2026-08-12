const express = require('express');
const supabase = require('../db/supabase');
const { requireDriver, requireActiveDriver } = require('../middleware/requireDriver');
const { estimateRoute } = require('../services/fare');
const google = require('../services/googleMaps');
const { stripe } = require('../services/stripe');
const { sendDriverAcceptedNotification, sendArrivalNotification } = require('../services/sms');
const checkr = require('../services/checkr');
const { getScreening, setScreening } = require('../services/screening');

const router = express.Router();

const AVAILABLE_WINDOW_DAYS = 7;

// Statuses during which a booking is "live" — a driver is physically
// moving on behalf of this trip. Location pings are only accepted, and
// the rider is only shown a moving car, while a booking is in one of
// these. See the note on the location endpoint for why that boundary
// matters.
const ACTIVE_TRIP_STATUSES = ['driver_assigned', 'driver_en_route', 'arrived', 'in_progress'];

// The lifecycle as a state machine rather than a free-for-all. Each key
// lists the only statuses reachable from it.
//
// Enforcing this server-side is not defensive pedantry: these timestamps
// are the evidence base for driver pay, rider refunds and no-show
// disputes. A double-tapped button that lets started_at overwrite itself,
// or an "arrived" that lands after "in_progress" because two requests
// raced, corrupts that record in a way that is very hard to reconstruct
// later. The client is also offline-prone and retries, so out-of-order
// and duplicate requests are expected, not hypothetical.
const ALLOWED_TRANSITIONS = {
  driver_assigned: ['driver_en_route', 'canceled'],
  driver_en_route: ['arrived', 'canceled'],
  arrived:         ['in_progress', 'canceled'],
  in_progress:     ['completed'],
};

// Which timestamp column each destination status stamps.
const STATUS_TIMESTAMP = {
  driver_en_route: 'en_route_at',
  arrived:         'arrived_at',
  in_progress:     'started_at',
  completed:       'completed_at',
  canceled:        'canceled_at',
};

// ============================================================
// Schedule / discovery
// ============================================================

// GET /api/driver/schedule — this driver's own upcoming + recent bookings.
// requireDriver only: a pending/suspended driver can see their own (likely
// empty) schedule — harmless, no need to also gate on active.
router.get('/schedule', requireDriver, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('driver_id', req.driver.id)
      .order('scheduled_at', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('driver schedule fetch error', err.message);
    res.status(500).json({ error: 'Could not fetch schedule.' });
  }
});

// GET /api/driver/available-trips — unclaimed upcoming bookings, browsable window.
router.get('/available-trips', requireDriver, requireActiveDriver, async (req, res) => {
  try {
    const now = new Date().toISOString();
    const windowEnd = new Date(Date.now() + AVAILABLE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .is('driver_id', null)
      .in('status', ['confirmed', 'dispatching'])
      .gte('scheduled_at', now)
      .lte('scheduled_at', windowEnd)
      .order('scheduled_at', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('available trips fetch error', err.message);
    res.status(500).json({ error: 'Could not fetch available trips.' });
  }
});

// POST /api/driver/bookings/:bookingId/claim — instant guarded assignment.
router.post('/bookings/:bookingId/claim', requireDriver, requireActiveDriver, async (req, res) => {
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

    // Compute and cache the route once, at claim time. This is the right
    // moment for it: the trip is now certain to happen, the driver's
    // navigation screen is about to need the geometry, and doing it here
    // means every later map render — driver, rider, admin replay — reads
    // stored columns instead of re-billing Google.
    ensureRouteCached(data).catch((e) =>
      console.warn('[driver] route cache failed (non-fatal):', e.message));

    // Best-effort: text the rider that a driver accepted, with the live
    // tracking link. Never let an SMS hiccup fail the claim.
    sendDriverAcceptedNotification(data, req.driver).catch((e) =>
      console.warn('[driver] accepted SMS failed (non-fatal):', e.message));

    res.json(data);
  } catch (err) {
    console.error('claim booking error', err.message);
    res.status(500).json({ error: 'Could not claim trip.' });
  }
});

// GET /api/driver/active-trip — the trip this driver is currently on, if any.
//
// This is the crash-recovery path, and it is not optional in a real ride
// app. Driver phones die, browsers get killed by the OS to reclaim
// memory, and drivers close the tab by accident — all of it mid-trip.
// Without this, reopening the app drops them back on the dashboard with
// a passenger in the car and no way to end the trip. With it, the app
// reconstructs exactly where they were from the server's state.
router.get('/active-trip', requireDriver, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('driver_id', req.driver.id)
      .in('status', ACTIVE_TRIP_STATUSES)
      .order('scheduled_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    res.json(data || null);
  } catch (err) {
    console.error('active trip fetch error', err.message);
    res.status(500).json({ error: 'Could not fetch active trip.' });
  }
});

// ============================================================
// Trip lifecycle
// ============================================================

// POST /api/driver/bookings/:bookingId/status  { status, reason? }
router.post('/bookings/:bookingId/status', requireDriver, requireActiveDriver, async (req, res) => {
  const { bookingId } = req.params;
  const { status: next, reason } = req.body || {};

  if (!next || !STATUS_TIMESTAMP[next]) {
    return res.status(400).json({ error: 'Unknown status.' });
  }

  try {
    const { data: booking, error: fetchErr } = await supabase
      .from('bookings')
      .select('id, status, driver_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, route_polyline, scheduled_at')
      .eq('id', bookingId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });

    // Ownership check before anything else. Without it any authenticated
    // driver could drive another driver's trip through its lifecycle.
    if (booking.driver_id !== req.driver.id) {
      return res.status(403).json({ error: 'This trip is not assigned to you.' });
    }

    // Idempotent no-op: a retried request that has already been applied
    // returns success rather than an error, so a flaky connection does
    // not surface as a scary failure to a driver holding a phone at the
    // kerb.
    if (booking.status === next) return res.json(booking);

    const allowed = ALLOWED_TRANSITIONS[booking.status] || [];
    if (!allowed.includes(next)) {
      return res.status(409).json({
        error: `Cannot go from ${booking.status} to ${next}.`,
        code: 'invalid_transition',
        currentStatus: booking.status,
      });
    }

    const patch = { status: next, [STATUS_TIMESTAMP[next]]: new Date().toISOString() };
    if (next === 'canceled') {
      patch.canceled_by = 'driver';
      patch.cancel_reason = reason || null;
    }

    // The .eq('status', booking.status) guard makes this a compare-and-set
    // rather than a blind write. If anything changed the row between the
    // read above and this update — the rider cancelling, a second tab,
    // ops intervening — the update matches zero rows instead of silently
    // clobbering the newer state.
    const { data, error } = await supabase
      .from('bookings')
      .update(patch)
      .eq('id', bookingId)
      .eq('status', booking.status)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(409).json({
        error: 'This trip changed while you were updating it. Refresh and try again.',
        code: 'conflict',
      });
    }

    if (next === 'in_progress') {
      // Entering the passenger-carrying leg: the cached route is now
      // pickup->dropoff, so refresh it if it was never computed.
      ensureRouteCached(data).catch(() => {});
    }

    // Ping the rider the instant the driver marks "arrived" — best-effort,
    // never let a texting hiccup fail the transition the driver is waiting
    // on. `data` is the full updated row, so it carries rider_phone +
    // track_token.
    if (next === 'arrived') {
      sendArrivalNotification(data).catch((e) =>
        console.warn('[driver] arrival SMS failed (non-fatal):', e.message));
    }

    res.json(data);
  } catch (err) {
    console.error('status transition error', err.message);
    res.status(500).json({ error: 'Could not update trip status.' });
  }
});

// ============================================================
// Location ingestion
// ============================================================

// Reject fixes too vague to be worth storing. A 2 km accuracy radius is
// cell-tower triangulation, not GPS, and plotting it makes the car
// teleport across town — worse than showing nothing.
const MAX_ACCEPTABLE_ACCURACY_M = 500;

function validPing(p) {
  const lat = Number(p?.lat);
  const lng = Number(p?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  // (0,0) is Null Island — the classic signature of an uninitialised
  // GPS reading rather than a real position in the Gulf of Guinea.
  if (lat === 0 && lng === 0) return null;

  const accuracy = Number(p.accuracy);
  if (Number.isFinite(accuracy) && accuracy > MAX_ACCEPTABLE_ACCURACY_M) return null;

  const recordedAt = p.recordedAt ? new Date(p.recordedAt) : new Date();
  if (Number.isNaN(recordedAt.getTime())) return null;

  return {
    lat,
    lng,
    heading: Number.isFinite(Number(p.heading)) ? Number(p.heading) : null,
    speed_mph: Number.isFinite(Number(p.speedMph)) ? Number(p.speedMph) : null,
    accuracy_m: Number.isFinite(accuracy) ? accuracy : null,
    recorded_at: recordedAt.toISOString(),
  };
}

// POST /api/driver/location
//   { bookingId?, pings: [{ lat, lng, heading?, speedMph?, accuracy?, recordedAt? }] }
//
// Accepts a BATCH, not a single fix. The driver app samples GPS every
// few seconds but uploads on a longer interval, which matters for three
// reasons: it cuts request volume by roughly the batch factor, it lets
// the app queue fixes through a tunnel or dead zone and flush them on
// reconnect instead of losing them, and it saves meaningful battery on a
// phone that is already running navigation for a full shift.
router.post('/location', requireDriver, requireActiveDriver, async (req, res) => {
  const { bookingId, pings } = req.body || {};

  if (!Array.isArray(pings) || pings.length === 0) {
    return res.status(400).json({ error: 'No location pings supplied.' });
  }
  // Bound the batch so a buggy or malicious client cannot post a
  // hundred thousand rows in one call.
  if (pings.length > 200) {
    return res.status(413).json({ error: 'Too many pings in one batch.' });
  }

  const clean = pings.map(validPing).filter(Boolean);
  if (clean.length === 0) {
    // Every fix was junk. Not an error the driver can act on, and not
    // worth failing the request over — the app will send more shortly.
    return res.json({ accepted: 0, rejected: pings.length });
  }

  try {
    let verifiedBookingId = null;

    if (bookingId) {
      // Attribute pings to a trip ONLY after confirming this driver owns
      // it and it is actually live. Trusting the client's bookingId would
      // let any driver write a false GPS trail onto another driver's
      // trip — and that trail is exactly what a fare or no-show dispute
      // gets decided on.
      const { data: booking, error: bErr } = await supabase
        .from('bookings')
        .select('id, driver_id, status')
        .eq('id', bookingId)
        .maybeSingle();
      if (bErr) throw bErr;

      if (booking && booking.driver_id === req.driver.id && ACTIVE_TRIP_STATUSES.includes(booking.status)) {
        verifiedBookingId = booking.id;
      }
      // If it fails any of those checks the pings are still stored, just
      // unattributed — the driver's own position history is legitimate
      // regardless, and dropping it would blind dispatch.
    }

    const rows = clean.map((p) => ({ ...p, driver_id: req.driver.id, booking_id: verifiedBookingId }));

    const { error: insErr } = await supabase.from('driver_locations').insert(rows);
    if (insErr) throw insErr;

    // Mirror the newest fix onto drivers.current_* so "where is every
    // driver right now" stays a single indexed row read rather than a
    // group-by over the whole breadcrumb table.
    //
    // Newest by recorded_at (device clock), not by array position: a
    // reconnecting client may flush a backlog in whatever order it
    // queued them, and stamping an old fix as current would drag the
    // marker backwards.
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

    // Refresh the rider-facing ETA on a throttle. Deliberately fire-and
    // -forget: the driver's upload must not wait on a Google round trip.
    if (verifiedBookingId) {
      refreshEta(verifiedBookingId, newest).catch(() => {});
    }

    res.json({ accepted: clean.length, rejected: pings.length - clean.length });
  } catch (err) {
    console.error('location ingest error', err.message);
    res.status(500).json({ error: 'Could not record location.' });
  }
});

// POST /api/driver/online  { online: boolean }
router.post('/online', requireDriver, requireActiveDriver, async (req, res) => {
  const online = !!req.body?.online;
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

// ============================================================
// Helpers
// ============================================================

/**
 * Compute the pickup->dropoff route once and store it on the booking.
 * No-op when already cached or when coordinates are missing.
 */
async function ensureRouteCached(booking) {
  if (!booking || booking.route_polyline) return;
  if (booking.pickup_lat == null || booking.dropoff_lat == null) return;
  if (!google.isConfigured()) return;

  const route = await google.getRoute(
    { lat: Number(booking.pickup_lat), lng: Number(booking.pickup_lng) },
    { lat: Number(booking.dropoff_lat), lng: Number(booking.dropoff_lng) },
    booking.scheduled_at
  );
  if (!route?.polyline) return;

  await supabase
    .from('bookings')
    .update({
      route_polyline: route.polyline,
      route_distance_meters: route.distanceMeters,
      route_duration_seconds: route.durationSeconds,
      route_source: route.source,
    })
    .eq('id', booking.id);
}

// Recompute the live ETA at most this often per booking.
//
// The naive version — one Directions call per location ping — would be
// twelve Google requests per minute per active driver. At ~$5/1000 that
// is roughly $3.60 per driver per hour on ETA alone, which is more than
// the platform's cut of most rides. A 60-second refresh is well inside
// what a rider perceives as live, and the client smoothly counts the
// number down in between.
const ETA_REFRESH_MS = 60 * 1000;

async function refreshEta(bookingId, newest) {
  if (!google.isConfigured()) return;

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, status, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, eta_updated_at')
    .eq('id', bookingId)
    .maybeSingle();
  if (!booking) return;

  if (booking.eta_updated_at && Date.now() - new Date(booking.eta_updated_at).getTime() < ETA_REFRESH_MS) {
    return;
  }

  // Before pickup the rider cares "when does my car get here"; after
  // pickup they care "when do I arrive". Same field, different target.
  const target = booking.status === 'in_progress'
    ? { lat: Number(booking.dropoff_lat), lng: Number(booking.dropoff_lng) }
    : { lat: Number(booking.pickup_lat), lng: Number(booking.pickup_lng) };

  if (target.lat == null || Number.isNaN(target.lat)) return;

  const route = await google.getRoute({ lat: newest.lat, lng: newest.lng }, target, null);
  if (!route?.durationSeconds) return;

  await supabase
    .from('bookings')
    .update({ eta_seconds: route.durationSeconds, eta_updated_at: new Date().toISOString() })
    .eq('id', bookingId);
}

// --- Driver payouts: Stripe Connect Express --------------------------------
// A pointer to the driver's Connect account lives in Supabase Auth app_metadata
// (server-controlled), since this environment can't add a drivers column.
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
function appBaseUrl() {
  return (process.env.PUBLIC_APP_URL || process.env.PUBLIC_BASE_URL || 'https://www.roverzoom.com').replace(/\/+$/, '');
}

// POST /api/driver/payouts/onboard — start/resume Stripe Connect onboarding.
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
    const base = appBaseUrl();
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

// GET /api/driver/payouts/status
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
// POST /api/driver/screening/start — begin (or resume) the hosted check.
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

// GET /api/driver/screening/status
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

module.exports = router;
module.exports.ACTIVE_TRIP_STATUSES = ACTIVE_TRIP_STATUSES;
