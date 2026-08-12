// ============================================================
// Public rider tracking — GET /api/track/:token
// ============================================================
// The one genuinely unauthenticated endpoint in the app, and the only
// way a rider can watch their driver approach.
//
// WHY IT IS UNAUTHENTICATED
// RoverZoom riders have no accounts. A booking is anonymous: name,
// phone, a reference code, no auth.users row, no session. So there is no
// auth.uid() to write an RLS policy against and no login to gate a
// tracking page behind. The rider's only credential is possession of the
// link, which arrives by SMS.
//
// WHAT THAT FORCES
// Because the link IS the credential, two things have to hold:
//
//   1. The token must be unguessable. bookings.track_token is 128 bits
//      of crypto randomness, NOT the RZ-8F3K2 reference — the reference
//      is ~33.5M possibilities and is read aloud in cars, which makes it
//      fine as an ID and unfit as a secret. See migration 002.
//
//   2. The response must assume it will eventually be seen by someone
//      other than the rider. Forwarded texts, shared screens, shoulder
//      surfing, a phone that stays unlocked. So this endpoint returns a
//      deliberately narrow projection and never SELECT *.
//
// WHAT IS DELIBERATELY WITHHELD
//   * rider_name / rider_phone / rider_email — a forwarded link must not
//     become a way to harvest the passenger's contact details.
//   * The driver's surname, phone, email and driver id.
//   * The driver's position outside an active trip. This one is easy to
//     miss and matters most: bookings are made days ahead, and a naive
//     implementation happily streams an assigned driver's live GPS from
//     the moment they claim the ride. That is a stranger watching a
//     driver at home, overnight, on a link that was texted to them. The
//     position is therefore gated on ACTIVE_TRIP_STATUSES and is null
//     until the driver actually starts heading to the pickup.
// ============================================================

const express = require('express');
const crypto = require('crypto');
const supabase = require('../db/supabase');

const router = express.Router();

// ------------------------------------------------------------
// Single-device binding (trust on first use)
//
// The link is a bearer credential, so on its own it works on any number
// of phones. To limit a live trip to the one device the rider is actually
// using, the FIRST device to present a secret claims the link; later
// devices are refused with 403 device_locked. The rider moves the link to
// a new phone via POST /:token/rebind, proving possession of the booking's
// phone number.
//
// Everything here is OPTIONAL. The two columns it needs (track_device_hash,
// track_bound_at) arrive in migration 003. Until that runs, isMissingColumn
// catches the "column does not exist" error and the endpoint serves
// tracking with no lock — exactly the old behaviour.
// ------------------------------------------------------------

// Postgres 42703 = undefined_column. Supabase surfaces it in either the
// code or the message depending on the path, so check both.
function isMissingColumn(err) {
  return !!err && (err.code === '42703' || /column .* does not exist/i.test(err.message || ''));
}

function hashDevice(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex');
}

// Compare on the last 10 digits so formatting differences (spaces, +1,
// dashes) never cause a legitimate rider to fail recovery.
function phonesMatch(a, b) {
  const da = String(a || '').replace(/\D/g, '');
  const db = String(b || '').replace(/\D/g, '');
  return da.length >= 10 && db.length >= 10 && da.slice(-10) === db.slice(-10);
}

// Small in-memory throttle on recovery so the phone-number check can't be
// brute-forced by someone who has the link but is guessing the number. The
// link is already a 128-bit secret, so this only has to stop scripted
// guessing, not a determined attacker with unlimited attempts.
const REBIND_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const REBIND_MAX = 6;
const rebindAttempts = new Map(); // token -> { count, resetAt }

function rebindAllowed(token) {
  const now = Date.now();
  const rec = rebindAttempts.get(token);
  if (!rec || now > rec.resetAt) {
    rebindAttempts.set(token, { count: 1, resetAt: now + REBIND_WINDOW_MS });
    return true;
  }
  if (rec.count >= REBIND_MAX) return false;
  rec.count += 1;
  return true;
}

// Mirrors the driver route's definition. Only during these statuses is a
// driver's live position exposed to the rider.
const ACTIVE_TRIP_STATUSES = ['driver_en_route', 'arrived', 'in_progress'];

// How long after drop-off the link keeps working. Long enough to check a
// receipt or dispute a route, short enough that an old text does not
// stay a live window into anything.
const TRACKING_GRACE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Show only the first name plus a surname initial. Enough for a rider to
// confirm the right person is at the kerb, not enough to look them up.
function displayName(fullName) {
  if (!fullName) return null;
  const parts = String(fullName).trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

router.get('/:token', async (req, res) => {
  const { token } = req.params;

  // Cheap shape check before touching the database. A well-formed token
  // is 32 hex chars; anything else is a scan, not a rider.
  if (!token || !/^[a-f0-9]{32}$/i.test(token)) {
    return res.status(404).json({ error: 'Tracking link not found.' });
  }

  try {
    // Explicit column list, never '*'. If a column holding something
    // sensitive is added to bookings later, it does not silently start
    // appearing in a public response.
    const BASE_COLS = [
      'id', 'reference', 'status', 'scheduled_at',
      'pickup_address', 'pickup_lat', 'pickup_lng',
      'dropoff_address', 'dropoff_lat', 'dropoff_lng',
      'distance_miles', 'duration_minutes', 'fare', 'payment_method',
      'route_polyline', 'eta_seconds', 'eta_updated_at',
      'driver_id', 'accepted_at', 'en_route_at', 'arrived_at',
      'started_at', 'completed_at', 'canceled_at',
    ];
    // The binding column is requested only when it exists. On a database
    // that has not run migration 003 the first query fails with an
    // undefined-column error; we retry with the base list and treat the
    // lock as simply not enabled.
    let bindingEnabled = true;
    let { data: booking, error } = await supabase
      .from('bookings')
      .select([...BASE_COLS, 'track_device_hash'].join(','))
      .eq('track_token', token)
      .maybeSingle();

    if (error && isMissingColumn(error)) {
      bindingEnabled = false;
      ({ data: booking, error } = await supabase
        .from('bookings')
        .select(BASE_COLS.join(','))
        .eq('track_token', token)
        .maybeSingle());
    }

    if (error) throw error;
    if (!booking) return res.status(404).json({ error: 'Tracking link not found.' });

    // --- Single-device lock (trust on first use) ---
    // Checked before anything else is returned so a non-owning device
    // never sees trip details. The device secret rides in a header set by
    // the rider's browser (see lib/trackDevice.js); we only ever see and
    // store its hash.
    if (bindingEnabled) {
      const provided = req.get('x-track-device');
      const providedHash = provided ? hashDevice(provided) : null;
      const stored = booking.track_device_hash || null;

      if (!stored) {
        // First device to show up with a secret claims the link.
        if (providedHash) {
          await supabase
            .from('bookings')
            .update({ track_device_hash: providedHash, track_bound_at: new Date().toISOString() })
            .eq('id', booking.id)
            .is('track_device_hash', null); // lose the race safely if two devices arrive at once
        }
        // No secret yet (e.g. a cached older client): allow through — the
        // browser will send one on its next poll and claim the link then.
      } else if (providedHash !== stored) {
        return res.status(403).json({
          error: 'This tracking link is being used on another device.',
          code: 'device_locked',
        });
      }
    }

    // Expire the link a couple of hours past the end of the trip.
    const endedAt = booking.completed_at || booking.canceled_at;
    if (endedAt && Date.now() - new Date(endedAt).getTime() > TRACKING_GRACE_MS) {
      return res.status(410).json({
        error: 'This tracking link has expired.',
        code: 'tracking_expired',
      });
    }

    const isActive = ACTIVE_TRIP_STATUSES.includes(booking.status);

    // --- Driver block: fetched only once a driver is assigned ---
    let driver = null;
    if (booking.driver_id) {
      const { data: d } = await supabase
        .from('drivers')
        .select('name, rating, vehicle_make, vehicle_model, vehicle_color, vehicle_plate, current_lat, current_lng, current_heading, current_speed_mph, location_updated_at')
        .eq('id', booking.driver_id)
        .maybeSingle();

      if (d) {
        driver = {
          name: displayName(d.name),
          rating: d.rating != null ? Number(d.rating) : null,
          vehicle: {
            make: d.vehicle_make,
            model: d.vehicle_model,
            color: d.vehicle_color,
            // Riders need the plate to identify the car at the kerb —
            // it is public information painted on the vehicle.
            plate: d.vehicle_plate,
          },
          // The gate. Position is null unless the trip is genuinely live.
          location: isActive && d.current_lat != null
            ? {
                lat: Number(d.current_lat),
                lng: Number(d.current_lng),
                heading: d.current_heading != null ? Number(d.current_heading) : null,
                speedMph: d.current_speed_mph != null ? Number(d.current_speed_mph) : null,
                updatedAt: d.location_updated_at,
                // Lets the client show "last seen 2 min ago" and stop
                // animating a marker that has gone stale, instead of
                // confidently displaying a position from ten minutes ago
                // as though it were current.
                ageSeconds: d.location_updated_at
                  ? Math.round((Date.now() - new Date(d.location_updated_at).getTime()) / 1000)
                  : null,
              }
            : null,
        };
      }
    }

    // Count the ETA down locally between the server's 60s refreshes, so
    // the number moves continuously instead of freezing then jumping.
    let etaSeconds = null;
    if (isActive && booking.eta_seconds != null && booking.eta_updated_at) {
      const elapsed = Math.round((Date.now() - new Date(booking.eta_updated_at).getTime()) / 1000);
      etaSeconds = Math.max(0, booking.eta_seconds - elapsed);
    }

    res.json({
      reference: booking.reference,
      status: booking.status,
      scheduledAt: booking.scheduled_at,
      pickup: {
        address: booking.pickup_address,
        lat: booking.pickup_lat != null ? Number(booking.pickup_lat) : null,
        lng: booking.pickup_lng != null ? Number(booking.pickup_lng) : null,
      },
      dropoff: {
        address: booking.dropoff_address,
        lat: booking.dropoff_lat != null ? Number(booking.dropoff_lat) : null,
        lng: booking.dropoff_lng != null ? Number(booking.dropoff_lng) : null,
      },
      trip: {
        distanceMiles: booking.distance_miles != null ? Number(booking.distance_miles) : null,
        durationMinutes: booking.duration_minutes,
        fare: booking.fare != null ? Number(booking.fare) : null,
        paymentMethod: booking.payment_method,
        routePolyline: booking.route_polyline,
      },
      driver,
      etaSeconds,
      timeline: {
        acceptedAt: booking.accepted_at,
        enRouteAt: booking.en_route_at,
        arrivedAt: booking.arrived_at,
        startedAt: booking.started_at,
        completedAt: booking.completed_at,
        canceledAt: booking.canceled_at,
      },
      // Tells the client how hard to poll. Idle bookings poll slowly;
      // live ones poll at 5s. Serving this from the server means the
      // cadence can be tuned later without shipping a new frontend.
      pollIntervalMs: isActive ? 5000 : 30000,
    });
  } catch (err) {
    console.error('track fetch error', err.message);
    res.status(500).json({ error: 'Could not load tracking info.' });
  }
});

// ============================================================
// POST /api/track/:token/rebind  { phone, deviceSecret }
// ============================================================
// Moves a locked tracking link to the device making this request. The
// caller must prove they hold the booking's phone number — the same
// number the confirmation and tracking texts were sent to — which is the
// one thing a random forwarder of the link does not have.
router.post('/:token/rebind', async (req, res) => {
  const { token } = req.params;
  if (!token || !/^[a-f0-9]{32}$/i.test(token)) {
    return res.status(404).json({ error: 'Tracking link not found.' });
  }

  const { phone, deviceSecret } = req.body || {};
  if (!phone || !deviceSecret) {
    return res.status(400).json({ error: 'Enter the phone number on this booking.' });
  }

  if (!rebindAllowed(token)) {
    return res.status(429).json({
      error: 'Too many attempts. Please wait a bit and try again.',
      code: 'rate_limited',
    });
  }

  try {
    const { data: booking, error } = await supabase
      .from('bookings')
      .select('id, rider_phone')
      .eq('track_token', token)
      .maybeSingle();

    // Migration 003 not run yet — the lock isn't active, so there is
    // nothing to move. Tell the client plainly rather than 500.
    if (error && isMissingColumn(error)) {
      return res.status(409).json({ error: 'Device locking is not enabled.', code: 'binding_disabled' });
    }
    if (error) throw error;
    if (!booking) return res.status(404).json({ error: 'Tracking link not found.' });

    if (!phonesMatch(phone, booking.rider_phone)) {
      // Deliberately vague: do not confirm or deny the number, just refuse.
      return res.status(403).json({
        error: 'That phone number does not match this booking.',
        code: 'phone_mismatch',
      });
    }

    const { error: updErr } = await supabase
      .from('bookings')
      .update({ track_device_hash: hashDevice(deviceSecret), track_bound_at: new Date().toISOString() })
      .eq('id', booking.id);
    if (updErr) throw updErr;

    res.json({ ok: true });
  } catch (err) {
    console.error('track rebind error', err.message);
    res.status(500).json({ error: 'Could not move tracking to this device.' });
  }
});

module.exports = router;
