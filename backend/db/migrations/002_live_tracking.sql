-- ============================================================
-- 002_live_tracking.sql — real maps + live driver tracking
--
-- ADDITIVE ONLY. Unlike db/schema.sql (which opens with DROP TABLE
-- IF EXISTS bookings CASCADE and is therefore destructive on re-run),
-- every statement in this file is safe to run against a database that
-- already holds real bookings and driver rows. Run it AFTER schema.sql.
--
--   psql $DATABASE_URL -f db/migrations/002_live_tracking.sql
--
-- What it adds:
--   1. bookings.track_token   — the rider's unguessable live-tracking key
--   2. driver_locations       — append-only GPS breadcrumb trail per trip
--   3. drivers.heading/speed  — richer "latest known position" for fleet view
--   4. bookings.route_*       — cached Google route geometry + live ETA
--   5. RLS + retention policy for the above
-- ============================================================

-- ------------------------------------------------------------
-- 1. bookings.track_token
--
-- Why not just use bookings.reference for the tracking link?
-- `reference` is a 5-char code from a 32-symbol alphabet (RZ-8F3K2) —
-- ~33.5M possibilities. That is fine as a human-readable booking ID
-- spoken aloud in a car, and it is deliberately short for exactly that
-- reason. It is NOT enough entropy to protect a public URL: a scripted
-- crawler can walk the whole space. Since the tracking link is sent by
-- SMS and opened with no login at all, it needs its own high-entropy
-- secret. 32 hex chars = 128 bits.
--
-- This also cleanly separates the two concepts: `reference` identifies a
-- booking, `track_token` authorizes watching it. Revoking tracking later
-- (say, 2 hours after drop-off) is then a token rotation, not a booking
-- identity change.
-- ------------------------------------------------------------
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS track_token TEXT;

-- Backfill any pre-existing rows. gen_random_bytes() comes from pgcrypto,
-- already enabled by schema.sql.
UPDATE bookings
   SET track_token = encode(gen_random_bytes(16), 'hex')
 WHERE track_token IS NULL;

ALTER TABLE bookings
  ALTER COLUMN track_token SET DEFAULT encode(gen_random_bytes(16), 'hex');

ALTER TABLE bookings
  ALTER COLUMN track_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_track_token ON bookings(track_token);

-- ------------------------------------------------------------
-- 2. bookings: cached route geometry + live ETA
--
-- The Google Directions/Routes response for pickup -> dropoff is stable
-- for the life of a booking (the road network does not change between
-- the quote and the trip), so it is computed once and stored. Every map
-- render afterwards — rider tracking screen, driver navigation screen,
-- admin replay — draws from these columns instead of re-billing a
-- Directions request. At ~$5 per 1,000 requests that is the difference
-- between one call per booking and one call per screen render.
--
-- route_polyline holds Google's encoded polyline string (not GeoJSON):
-- it is ~10x smaller over the wire and decodes in one call client-side
-- via google.maps.geometry.encoding.decodePath().
-- ------------------------------------------------------------
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS route_polyline        TEXT,
  ADD COLUMN IF NOT EXISTS route_distance_meters INT,
  ADD COLUMN IF NOT EXISTS route_duration_seconds INT,
  ADD COLUMN IF NOT EXISTS route_source          TEXT,
  -- Live ETA to the *next* waypoint (pickup while en route, dropoff once
  -- in progress). Recomputed on a throttle, never on every location ping.
  ADD COLUMN IF NOT EXISTS eta_seconds           INT,
  ADD COLUMN IF NOT EXISTS eta_updated_at        TIMESTAMPTZ;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_route_source_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_route_source_check
  CHECK (route_source IS NULL OR route_source IN ('google', 'haversine'));

-- ------------------------------------------------------------
-- 3. drivers: richer live position
--
-- current_lat / current_lng / location_updated_at already exist from
-- schema.sql. Heading and speed are what make a map marker read as a
-- moving vehicle rather than a jumping dot — heading rotates the car
-- icon, speed lets the client decide whether to animate or hold still.
-- accuracy_m lets both the app and ops discard garbage fixes (a 2000m
-- accuracy reading from cell-tower triangulation should not move the car
-- across town).
-- ------------------------------------------------------------
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS current_heading  NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS current_speed_mph NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS current_accuracy_m NUMERIC(7,1);

-- Fleet view ("show me every online driver right now") filters on
-- is_online and a freshness cutoff. The existing composite index covers
-- that. This partial index additionally keeps the common case — online
-- drivers only — small and hot.
CREATE INDEX IF NOT EXISTS idx_drivers_online_only
  ON drivers(location_updated_at DESC) WHERE is_online = true;

-- ------------------------------------------------------------
-- 4. driver_locations — append-only breadcrumb trail
--
-- drivers.current_* answers "where is this driver now". This table
-- answers "where did this driver go during booking X", which is a
-- different question with different consumers:
--
--   * Admin trip replay and route auditing
--   * Fare/route disputes ("the driver took the long way")
--   * Proof of service for a no-show claim
--   * Safety review after an incident
--
-- None of those can be answered from a single mutable row that is
-- overwritten every five seconds, which is why this is a separate table
-- rather than more columns on drivers.
--
-- booking_id is nullable on purpose: a driver who is online but not yet
-- assigned still pings (that is how dispatch finds nearby drivers), and
-- those pings are not attributable to any trip.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS driver_locations (
  id           BIGSERIAL PRIMARY KEY,
  driver_id    UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  booking_id   UUID REFERENCES bookings(id) ON DELETE SET NULL,

  lat          NUMERIC(9,6) NOT NULL,
  lng          NUMERIC(9,6) NOT NULL,
  heading      NUMERIC(5,2),
  speed_mph    NUMERIC(5,1),
  accuracy_m   NUMERIC(7,1),

  -- The phone's own timestamp for the fix. Kept separate from
  -- created_at (server receive time) because pings are uploaded in
  -- batches and may arrive seconds-to-minutes after they were recorded,
  -- e.g. when a driver passes through a dead zone and the queue flushes
  -- on reconnect. Ordering a replay by created_at would scramble the
  -- route; ordering by recorded_at reconstructs it correctly.
  recorded_at  TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The two read patterns, each with its own index:
--   trip replay      -> WHERE booking_id = ? ORDER BY recorded_at
--   driver history   -> WHERE driver_id = ? AND recorded_at > ?
CREATE INDEX IF NOT EXISTS idx_driver_locations_booking ON driver_locations(booking_id, recorded_at)
  WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_driver_locations_driver_time ON driver_locations(driver_id, recorded_at DESC);

-- ------------------------------------------------------------
-- 5. Row Level Security
--
-- Same posture as every other table here: all writes go through the
-- service-role Express API, so no write policies exist (== denied to
-- anon/authenticated clients).
--
-- Reads: a driver may see their own trail. Riders are NOT covered by
-- RLS at all — riders have no Supabase Auth session (bookings are
-- anonymous, identified by reference + track_token), so auth.uid() is
-- always NULL for them. That is precisely why rider tracking is served
-- by GET /api/track/:token through the service-role backend rather than
-- by pointing the browser client at this table. Do not "fix" this by
-- adding a permissive SELECT policy here — a policy loose enough for an
-- anonymous rider to read their driver's position is loose enough for
-- anyone to read every driver's position.
-- ------------------------------------------------------------
ALTER TABLE driver_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_locations_select_own ON driver_locations;
CREATE POLICY driver_locations_select_own ON driver_locations FOR SELECT
  USING (driver_id IN (SELECT id FROM drivers WHERE auth_user_id = auth.uid()));

-- ------------------------------------------------------------
-- 6. Retention
--
-- At a 5-second ping cadence a single driver generates 720 rows/hour on
-- trip. Ten busy drivers at four hours a day is ~29k rows/day, ~10M/year
-- — comfortable for Postgres, but it grows forever and most of it has no
-- value after the dispute window closes.
--
-- This function is intentionally NOT scheduled here. Call it from a
-- pg_cron job or a Supabase scheduled Edge Function once retention
-- policy is decided with a real number, e.g.:
--
--   SELECT cron.schedule('prune-driver-locations', '0 4 * * *',
--                        $$SELECT prune_driver_locations(90)$$);
--
-- 90 days is a reasonable starting point: long enough to cover chargeback
-- and dispute windows, short enough to stay honest about retaining
-- continuous location history on human beings. Whatever number is chosen
-- must match what the privacy policy tells drivers.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION prune_driver_locations(p_keep_days INT DEFAULT 90)
RETURNS INT AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM driver_locations
   WHERE recorded_at < now() - (p_keep_days || ' days')::INTERVAL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
