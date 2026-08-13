-- RoverZoom schema (wizard-flow booking version)
-- Run: psql $DATABASE_URL -f db/schema.sql  (or npm run db:setup)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS bookings CASCADE;

CREATE TABLE bookings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human-facing short code, e.g. RZ-8F3K2. Generated in app code.
  reference          TEXT UNIQUE NOT NULL,

  pickup_address     TEXT NOT NULL,
  pickup_lat         NUMERIC(9,6),
  pickup_lng         NUMERIC(9,6),
  dropoff_address    TEXT NOT NULL,
  dropoff_lat        NUMERIC(9,6),
  dropoff_lng        NUMERIC(9,6),

  scheduled_at       TIMESTAMPTZ NOT NULL,

  distance_miles     NUMERIC(6,2),
  duration_minutes   INT,
  fare               NUMERIC(8,2) NOT NULL,

  payment_method     TEXT NOT NULL CHECK (payment_method IN ('card','cash')),
  payment_status     TEXT NOT NULL DEFAULT 'pending'
                       CHECK (payment_status IN ('pending','paid','failed')),

  -- Minimal contact info (no account)
  rider_name         TEXT NOT NULL,
  rider_phone        TEXT NOT NULL,
  rider_email        TEXT,

  -- How the booking was created
  source             TEXT NOT NULL DEFAULT 'form' CHECK (source IN ('form','ai')),

  status             TEXT NOT NULL DEFAULT 'confirmed'
                       CHECK (status IN ('confirmed','canceled','completed')),

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bookings_scheduled_at ON bookings(scheduled_at);
CREATE INDEX idx_bookings_reference ON bookings(reference);

-- ============================================================
-- Driver side (Phase 1: foundations)
--
-- Adds driver accounts, the ride_offers broadcast-dispatch table, and an
-- earnings/payout ledger. Driver-facing matching has two paths: drivers can
-- browse and instantly claim any unclaimed upcoming booking (a simple guarded
-- UPDATE, no table needed beyond bookings itself), and a reactive broadcast
-- job offers still-unclaimed bookings to nearby online drivers shortly
-- before scheduled_at (ride_offers, with a 15s accept window per driver,
-- arbitrated by accept_ride_offer() below).
--
-- Unlike the block above, this section does NOT drop `bookings` — it's
-- additive (ALTER + new tables) so it's safe to re-run against a database
-- that already has real booking rows. The new tables below are brand new,
-- so DROP IF EXISTS on them is a no-op safety net, not a data-loss risk.
-- ============================================================

DROP TABLE IF EXISTS ride_offers CASCADE;
DROP TABLE IF EXISTS driver_earnings CASCADE;
DROP TABLE IF EXISTS driver_payouts CASCADE;
DROP TABLE IF EXISTS drivers CASCADE;

CREATE TABLE drivers (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- FK to auth.users(id) once real Supabase Auth lands for drivers; NULL
  -- during the stub-identity phase. RLS policies below are written against
  -- this column now so nothing needs to change when auth arrives — it just
  -- starts evaluating true instead of always false.
  auth_user_id         UUID UNIQUE,

  name                 TEXT NOT NULL,
  phone                TEXT UNIQUE NOT NULL,
  email                TEXT UNIQUE,

  vehicle_make         TEXT,
  vehicle_model        TEXT,
  vehicle_color        TEXT,
  vehicle_plate        TEXT,

  rating               NUMERIC(3,2) NOT NULL DEFAULT 5.00,
  rides_completed      INT NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'pending_verification'
                         CHECK (status IN ('pending_verification','active','suspended')),

  is_online            BOOLEAN NOT NULL DEFAULT false,
  current_lat          NUMERIC(9,6),
  current_lng          NUMERIC(9,6),
  location_updated_at  TIMESTAMPTZ,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_drivers_online_location ON drivers(is_online, location_updated_at);

-- --- bookings: driver-lifecycle additions ---------------------------------
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS driver_id              UUID REFERENCES drivers(id),
  ADD COLUMN IF NOT EXISTS dispatch_round          INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispatched_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS en_route_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrived_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS canceled_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS canceled_by             TEXT,
  ADD COLUMN IF NOT EXISTS cancel_reason           TEXT,
  ADD COLUMN IF NOT EXISTS driver_rating_of_rider  INT;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_canceled_by_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_canceled_by_check
  CHECK (canceled_by IS NULL OR canceled_by IN ('rider','driver','system'));

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_driver_rating_of_rider_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_driver_rating_of_rider_check
  CHECK (driver_rating_of_rider IS NULL OR driver_rating_of_rider BETWEEN 1 AND 5);

-- Widen status to the full driver lifecycle. Named 'driver_assigned' (not
-- 'accepted') to avoid colliding with ride_offers.status='accepted' below —
-- the two are conceptually different events (an offer being accepted vs.
-- the booking itself becoming assigned).
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN (
    'confirmed', 'dispatching', 'driver_assigned', 'driver_en_route',
    'arrived', 'in_progress', 'completed', 'canceled', 'manual_dispatch_required'
  ));

CREATE INDEX IF NOT EXISTS idx_bookings_status_scheduled_at ON bookings(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_bookings_driver_id ON bookings(driver_id);

-- --- ride_offers: reactive broadcast-dispatch offers ----------------------
CREATE TABLE ride_offers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       UUID NOT NULL REFERENCES bookings(id),
  driver_id        UUID NOT NULL REFERENCES drivers(id),
  round            INT NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','accepted','declined','expired','superseded')),
  offered_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at     TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ NOT NULL,

  -- Denormalized snapshot so a driver with only a pending offer (not yet
  -- assigned driver_id on the booking) has a legal way to see ride details
  -- under the RLS boundary below, without widening bookings SELECT access.
  pickup_address   TEXT NOT NULL,
  dropoff_address  TEXT NOT NULL,
  distance_miles   NUMERIC(6,2),
  duration_minutes INT,
  fare             NUMERIC(8,2)
);

CREATE INDEX idx_ride_offers_driver_pending ON ride_offers(driver_id) WHERE status = 'pending';
CREATE INDEX idx_ride_offers_booking_id ON ride_offers(booking_id);

-- --- driver_earnings: append-only ledger ----------------------------------
CREATE TABLE driver_earnings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   UUID NOT NULL REFERENCES drivers(id),
  booking_id  UUID REFERENCES bookings(id),
  amount      NUMERIC(8,2) NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('fare','tip','bonus','adjustment')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_driver_earnings_driver_id ON driver_earnings(driver_id, created_at);

-- --- driver_payouts: periodic payout records ------------------------------
CREATE TABLE driver_payouts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id          UUID NOT NULL REFERENCES drivers(id),
  amount             NUMERIC(8,2) NOT NULL,
  period_start       DATE NOT NULL,
  period_end         DATE NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  paid_at            TIMESTAMPTZ,
  external_payout_id TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_driver_payouts_driver_id ON driver_payouts(driver_id);

-- --- Row Level Security ----------------------------------------------------
-- All writes go through the service-role Express API, which bypasses RLS
-- entirely, so client-side write policies are intentionally omitted on every
-- table below (== denied). SELECT policies are real auth now — see the
-- "Driver side (Phase: authentication)" section further down for the
-- auth_user_id FK and the trigger that populates it on signup.

ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ride_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_payouts ENABLE ROW LEVEL SECURITY;

-- drivers: the frontend's useDriverAuth() hook queries this table directly
-- (anon key) to resolve "who am I" right after login — this is the one
-- legitimate client read path for driver profile data, scoped to the caller's
-- own row via auth_user_id.
DROP POLICY IF EXISTS drivers_select_own ON drivers;
CREATE POLICY drivers_select_own ON drivers FOR SELECT
  USING (auth_user_id = auth.uid());

-- bookings/ride_offers: scoped to the requesting driver's own rows. Realtime
-- postgres_changes only ever needs to reach "my own ride_offers" and "my own
-- assigned booking" — never a browse-all-bookings view (that's the
-- service-role-backed GET /api/driver/available-trips instead).
DROP POLICY IF EXISTS bookings_select_stub ON bookings;
DROP POLICY IF EXISTS bookings_select_own ON bookings;
CREATE POLICY bookings_select_own ON bookings FOR SELECT
  USING (driver_id IN (SELECT id FROM drivers WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS ride_offers_select_stub ON ride_offers;
DROP POLICY IF EXISTS ride_offers_select_own ON ride_offers;
CREATE POLICY ride_offers_select_own ON ride_offers FOR SELECT
  USING (driver_id IN (SELECT id FROM drivers WHERE auth_user_id = auth.uid()));

-- --- accept_ride_offer(): the one place that needs a real transaction ------
-- Atomically: claim the offer, assign the booking, supersede sibling offers.
-- If another driver already won the booking between steps, the second
-- exception rolls back the whole call (including the first update), so this
-- driver's own offer never ends up stuck "accepted" for a ride they didn't
-- get. SECURITY DEFINER so it can run as the table owner regardless of the
-- caller's RLS-visible rows. SET search_path = public is required alongside
-- SECURITY DEFINER — without it, unqualified table names resolve using the
-- caller's search_path, not the owner's, which can fail outright or (worse)
-- resolve to the wrong object; this is standard Postgres/Supabase guidance
-- for SECURITY DEFINER functions, not optional hardening.
CREATE OR REPLACE FUNCTION accept_ride_offer(p_offer_id UUID, p_driver_id UUID)
RETURNS bookings AS $$
DECLARE
  v_booking_id UUID;
  v_booking bookings;
BEGIN
  UPDATE ride_offers SET status = 'accepted', responded_at = now()
    WHERE id = p_offer_id AND driver_id = p_driver_id
      AND status = 'pending' AND expires_at > now()
    RETURNING booking_id INTO v_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_unavailable';
  END IF;

  UPDATE bookings SET driver_id = p_driver_id, status = 'driver_assigned', accepted_at = now()
    WHERE id = v_booking_id AND driver_id IS NULL
    RETURNING * INTO v_booking;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_already_assigned';
  END IF;

  UPDATE ride_offers SET status = 'superseded'
    WHERE booking_id = v_booking_id AND id <> p_offer_id AND status = 'pending';

  RETURN v_booking;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- Driver side (Phase: authentication)
--
-- Real Supabase Auth (email+password) for drivers, replacing the stub
-- identity. Self-registration lands as pending_verification; ops flips to
-- active/suspended manually until an admin dashboard exists.
-- ============================================================

ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_auth_user_id_fkey;
ALTER TABLE drivers ADD CONSTRAINT drivers_auth_user_id_fkey
  FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
-- ON DELETE SET NULL, not CASCADE — deleting an auth account shouldn't take
-- a driver's earnings/booking history with it.

-- Creates the drivers row atomically with the auth.users row on signup, so
-- there's never an auth account with no matching driver profile. Reads
-- name/phone/vehicle_* from raw_user_meta_data (populated via
-- supabase.auth.signUp({ options: { data: {...} } })) — but NEVER rating,
-- rides_completed, or is_online from there: that field is entirely
-- client-controlled via the public signUp() API, so those columns must
-- always take their DEFAULTs (explicit whitelist below), or anyone could
-- pass arbitrary values at signup.
--
-- status is explicitly set to 'active' (not left at its pending_verification
-- DEFAULT) — TEMPORARY stance: there's no admin dashboard yet to approve
-- anyone, so gating signup on manual review would just block the stated
-- goal of "sign up and see the calendar" with no way to unblock it. Revisit
-- once an admin dashboard exists to actually do the approving.
CREATE OR REPLACE FUNCTION handle_new_driver()
RETURNS trigger AS $$
BEGIN
  INSERT INTO drivers (auth_user_id, name, phone, email, vehicle_make, vehicle_model, vehicle_color, vehicle_plate, status)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'phone',
    NEW.email, -- from the real auth row, never from client-controlled metadata
    NEW.raw_user_meta_data->>'vehicle_make',
    NEW.raw_user_meta_data->>'vehicle_model',
    NEW.raw_user_meta_data->>'vehicle_color',
    NEW.raw_user_meta_data->>'vehicle_plate',
    'active'
  );
  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'phone_or_email_already_registered';
  WHEN not_null_violation THEN
    RAISE EXCEPTION 'missing_required_driver_field';
  WHEN OTHERS THEN
    -- Catch-all so a failure NEVER again surfaces as an anonymous "database
    -- error saving new user" with no way to tell what actually broke — the
    -- real SQLSTATE/message is now always in the Postgres log next to this
    -- trigger's own name, whatever the cause turns out to be.
    RAISE EXCEPTION 'driver_creation_failed: % (%)', SQLERRM, SQLSTATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- An exception here rolls back the WHOLE transaction, including the
-- auth.users insert — correct (no orphaned auth account with no driver
-- row), but it surfaces to signUp() as a generic error unless the frontend
-- validates required fields client-side first and maps these two codes to
-- real copy.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_driver();

-- ============================================================
-- Driver side (Phase: profile completion + real trip lifecycle)
--
-- Additive only — safe to run against a live database with existing driver/
-- booking rows. Does NOT touch the DROP TABLE statements earlier in this
-- file; those are for fresh installs only and must never be re-run here.
-- ============================================================

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS photo_url            TEXT,
  ADD COLUMN IF NOT EXISTS license_photo_url     TEXT,
  ADD COLUMN IF NOT EXISTS insurance_photo_url   TEXT,
  -- Set (by the application) once all three of the above are non-null;
  -- cleared if any is removed. This is the "profile complete" gate that
  -- controls access to ride requests — see requireCompleteProfile.
  ADD COLUMN IF NOT EXISTS profile_completed_at  TIMESTAMPTZ;

-- complete_booking(): atomically finishes a trip — flips status, records the
-- driver's earnings ledger entry, and increments rides_completed in one
-- transaction, so a failure partway through never leaves the booking marked
-- completed with no matching earnings row (or vice versa). The payout
-- amount is computed by the caller (backend/services/payout.js is the one
-- source of truth for the 60% cut) and passed in, rather than duplicating
-- that constant here in SQL.
CREATE OR REPLACE FUNCTION complete_booking(p_booking_id UUID, p_driver_id UUID, p_earnings_amount NUMERIC)
RETURNS bookings AS $$
DECLARE
  v_booking bookings;
BEGIN
  UPDATE bookings SET status = 'completed', completed_at = now()
    WHERE id = p_booking_id AND driver_id = p_driver_id AND status = 'in_progress'
    RETURNING * INTO v_booking;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_not_in_progress';
  END IF;

  INSERT INTO driver_earnings (driver_id, booking_id, amount, type)
    VALUES (p_driver_id, p_booking_id, p_earnings_amount, 'fare');

  UPDATE drivers SET rides_completed = rides_completed + 1 WHERE id = p_driver_id;

  RETURN v_booking;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
