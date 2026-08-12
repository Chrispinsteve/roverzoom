// ============================================================
// Admin API — read-only fleet + trip oversight
// ============================================================
// Built to be consumed by the separate admin dashboard on its own
// domain. Nothing here renders UI; these are the data endpoints that
// dashboard will call.
//
// Read-only on purpose. Every endpoint is a GET, and none of them
// mutate a booking, reassign a driver or cancel a trip. Those actions
// are exactly the ones that need real per-admin identity and an audit
// trail, so they are intentionally out of scope until the shared-key
// stopgap in requireAdmin.js is replaced.
//
// Add the admin dashboard's origin to CORS_ORIGINS (see server.js) once
// the domain exists, and set ADMIN_API_KEY on the API.
// ============================================================

const express = require('express');
const supabase = require('../db/supabase');
const { requireAdmin } = require('../middleware/requireAdmin');

const router = express.Router();

router.use(requireAdmin);

const ACTIVE_TRIP_STATUSES = ['driver_assigned', 'driver_en_route', 'arrived', 'in_progress'];

// A position older than this is shown as stale rather than plotted as
// though it were current. Five minutes of silence from a driver app
// usually means a dead battery, a killed background tab or no signal.
const STALE_LOCATION_MS = 5 * 60 * 1000;

// GET /api/admin/fleet — every online driver and what they are doing.
//
// The live map view. Answers "who is out there, where are they, and are
// they on a trip" in one request.
router.get('/fleet', async (req, res) => {
  try {
    const { data: drivers, error } = await supabase
      .from('drivers')
      .select('id, name, phone, status, is_online, rating, rides_completed, vehicle_make, vehicle_model, vehicle_color, vehicle_plate, current_lat, current_lng, current_heading, current_speed_mph, current_accuracy_m, location_updated_at')
      .eq('is_online', true)
      .order('location_updated_at', { ascending: false });
    if (error) throw error;

    const driverIds = (drivers || []).map((d) => d.id);

    // One query for all active trips, then matched in memory. The
    // alternative — a trip lookup per driver — is the N+1 that turns a
    // 40-driver fleet map into 41 round trips on a polling endpoint.
    let tripsByDriver = {};
    if (driverIds.length) {
      const { data: trips, error: tErr } = await supabase
        .from('bookings')
        .select('id, reference, status, driver_id, pickup_address, dropoff_address, scheduled_at, eta_seconds, fare')
        .in('driver_id', driverIds)
        .in('status', ACTIVE_TRIP_STATUSES);
      if (tErr) throw tErr;
      tripsByDriver = Object.fromEntries((trips || []).map((t) => [t.driver_id, t]));
    }

    const now = Date.now();
    res.json({
      count: drivers?.length || 0,
      drivers: (drivers || []).map((d) => {
        const ageMs = d.location_updated_at ? now - new Date(d.location_updated_at).getTime() : null;
        return {
          id: d.id,
          name: d.name,
          phone: d.phone,
          status: d.status,
          rating: d.rating != null ? Number(d.rating) : null,
          ridesCompleted: d.rides_completed,
          vehicle: {
            make: d.vehicle_make,
            model: d.vehicle_model,
            color: d.vehicle_color,
            plate: d.vehicle_plate,
          },
          location: d.current_lat != null
            ? {
                lat: Number(d.current_lat),
                lng: Number(d.current_lng),
                heading: d.current_heading != null ? Number(d.current_heading) : null,
                speedMph: d.current_speed_mph != null ? Number(d.current_speed_mph) : null,
                accuracyM: d.current_accuracy_m != null ? Number(d.current_accuracy_m) : null,
                updatedAt: d.location_updated_at,
                ageSeconds: ageMs != null ? Math.round(ageMs / 1000) : null,
                stale: ageMs == null || ageMs > STALE_LOCATION_MS,
              }
            : null,
          activeTrip: tripsByDriver[d.id] || null,
        };
      }),
    });
  } catch (err) {
    console.error('admin fleet error', err.message);
    res.status(500).json({ error: 'Could not load fleet.' });
  }
});

// GET /api/admin/trips/active — every trip currently in motion.
router.get('/trips/active', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('id, reference, status, driver_id, rider_name, rider_phone, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, scheduled_at, accepted_at, en_route_at, arrived_at, started_at, fare, eta_seconds, route_polyline')
      .in('status', ACTIVE_TRIP_STATUSES)
      .order('scheduled_at', { ascending: true });
    if (error) throw error;
    res.json({ count: data?.length || 0, trips: data || [] });
  } catch (err) {
    console.error('admin active trips error', err.message);
    res.status(500).json({ error: 'Could not load active trips.' });
  }
});

// GET /api/admin/bookings/:bookingId/trail?maxPoints=500
//
// The GPS breadcrumb trail for one trip — the replay view. This is what
// settles "the driver took the long way", "the passenger never showed",
// and any question about what actually happened during a ride.
router.get('/bookings/:bookingId/trail', async (req, res) => {
  const { bookingId } = req.params;
  const maxPoints = Math.min(Number(req.query.maxPoints) || 500, 5000);

  try {
    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .select('id, reference, status, driver_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, route_polyline, started_at, completed_at')
      .eq('id', bookingId)
      .maybeSingle();
    if (bErr) throw bErr;
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });

    const { data: points, error: pErr } = await supabase
      .from('driver_locations')
      .select('lat, lng, heading, speed_mph, accuracy_m, recorded_at')
      .eq('booking_id', bookingId)
      .order('recorded_at', { ascending: true });
    if (pErr) throw pErr;

    const all = points || [];

    // Downsample by taking every Nth point rather than truncating. A
    // long trip can hold thousands of fixes and a map cannot usefully
    // draw them all, but cutting the tail off would show a route that
    // stops halfway — the shape of the whole journey is what matters,
    // not full resolution. First and last are always kept so the trail
    // starts and ends where the trip did.
    let trail = all;
    if (all.length > maxPoints) {
      const step = Math.ceil(all.length / maxPoints);
      trail = all.filter((_, i) => i % step === 0);
      if (trail[trail.length - 1] !== all[all.length - 1]) trail.push(all[all.length - 1]);
    }

    res.json({
      booking: {
        id: booking.id,
        reference: booking.reference,
        status: booking.status,
        plannedRoutePolyline: booking.route_polyline,
        pickup: { lat: Number(booking.pickup_lat), lng: Number(booking.pickup_lng) },
        dropoff: { lat: Number(booking.dropoff_lat), lng: Number(booking.dropoff_lng) },
        startedAt: booking.started_at,
        completedAt: booking.completed_at,
      },
      totalPoints: all.length,
      returnedPoints: trail.length,
      trail: trail.map((p) => ({
        lat: Number(p.lat),
        lng: Number(p.lng),
        heading: p.heading != null ? Number(p.heading) : null,
        speedMph: p.speed_mph != null ? Number(p.speed_mph) : null,
        accuracyM: p.accuracy_m != null ? Number(p.accuracy_m) : null,
        at: p.recorded_at,
      })),
    });
  } catch (err) {
    console.error('admin trail error', err.message);
    res.status(500).json({ error: 'Could not load trip trail.' });
  }
});

module.exports = router;
