-- ============================================================
-- sync-prod.sql — bring an existing PRODUCTION database up to date
-- ============================================================
-- Purpose: prod was set up from an older schema and is missing pieces the
-- app depends on (the signup trigger, driver profile-photo columns, the full
-- booking lifecycle columns + status constraint, functions, RLS). Those gaps
-- are what caused "no driver profile", "could not save document", and would
-- have blocked claiming/using EXISTING ride requests.
--
-- This file is the additive, idempotent subset of schema.sql:
--   * NON-DESTRUCTIVE — it never DROPs a table, so every existing booking,
--     driver, earning and payout row is preserved. Your ride requests made
--     before the bugs stay exactly where they are; this only makes the schema
--     able to read and act on them again.
--   * IDEMPOTENT — everything is IF NOT EXISTS / CREATE OR REPLACE / DROP+ADD
--     CONSTRAINT, so it is safe to run now and safe to run again later.
--
-- Run once against prod:
--   psql "$DATABASE_URL" -f backend/db/sync-prod.sql
-- (or paste it into the Supabase SQL editor and run).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------
-- Base tables — created only if entirely absent. If they already exist (the
-- normal case on prod) these are skipped and the ALTERs below reconcile any
-- missing columns. NOTE: no DROP TABLE anywhere in this file.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  rider_name         TEXT NOT NULL,
  rider_phone        TEXT NOT NULL,
  rider_email        TEXT,
  source             TEXT NOT NULL DEFAULT 'form' CHECK (source IN ('form','ai')),
  status             TEXT NOT NULL DEFAULT 'confirmed',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bookings_scheduled_at ON bookings(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_bookings_reference ON bookings(reference);

CREATE TABLE IF NOT EXISTS drivers (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

-- Defensive: ensure driver columns added over time exist even on an older
-- drivers table that CREATE TABLE IF NOT EXISTS would have skipped.
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS auth_user_id         UUID,
  ADD COLUMN IF NOT EXISTS is_online            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS current_lat          NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS current_lng          NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS location_updated_at  TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_drivers_online_location ON drivers(is_online, location_updated_at);

-- ------------------------------------------------------------
-- Driver profile-photo columns (fixes "Could not save document")
-- ------------------------------------------------------------
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS photo_url            TEXT,
  ADD COLUMN IF NOT EXISTS license_photo_url    TEXT,
  ADD COLUMN IF NOT EXISTS insurance_photo_url  TEXT,
  ADD COLUMN IF NOT EXISTS profile_completed_at TIMESTAMPTZ;

-- ------------------------------------------------------------
-- Live tracking: richer live position on drivers + append-only breadcrumb
-- trail. drivers.current_lat/lng/location_updated_at already exist; these add
-- heading/speed/accuracy so a marker reads as a moving vehicle.
-- ------------------------------------------------------------
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS current_heading    NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS current_speed_mph  NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS current_accuracy_m NUMERIC(7,1);

CREATE TABLE IF NOT EXISTS driver_locations (
  id           BIGSERIAL PRIMARY KEY,
  driver_id    UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  booking_id   UUID REFERENCES bookings(id) ON DELETE SET NULL,
  lat          NUMERIC(9,6) NOT NULL,
  lng          NUMERIC(9,6) NOT NULL,
  heading      NUMERIC(5,2),
  speed_mph    NUMERIC(5,1),
  accuracy_m   NUMERIC(7,1),
  recorded_at  TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_driver_locations_booking
  ON driver_locations(booking_id, recorded_at) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_driver_locations_driver_time
  ON driver_locations(driver_id, recorded_at DESC);

ALTER TABLE driver_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_locations_select_own ON driver_locations;
CREATE POLICY driver_locations_select_own ON driver_locations FOR SELECT
  USING (driver_id IN (SELECT id FROM drivers WHERE auth_user_id = auth.uid()));

-- ------------------------------------------------------------
-- Web Push subscriptions — one row per device a driver enabled ride-request
-- notifications on. endpoint is unique so re-subscribing the same device
-- upserts rather than duplicating.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          BIGSERIAL PRIMARY KEY,
  driver_id   UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_driver ON push_subscriptions(driver_id);
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- Booking lifecycle columns + constraints
-- THIS is what makes existing ride requests retrievable AND actionable:
-- the driver_id, the per-stage timestamps, and the widened status CHECK so a
-- booking can move confirmed -> driver_assigned -> ... -> completed. Without
-- the widened CHECK, claiming an existing request fails.
-- ------------------------------------------------------------
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS driver_id              UUID REFERENCES drivers(id),
  ADD COLUMN IF NOT EXISTS dispatch_round         INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispatched_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS en_route_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrived_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS canceled_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS canceled_by            TEXT,
  ADD COLUMN IF NOT EXISTS cancel_reason          TEXT,
  ADD COLUMN IF NOT EXISTS driver_rating_of_rider INT;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_canceled_by_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_canceled_by_check
  CHECK (canceled_by IS NULL OR canceled_by IN ('rider','driver','system'));

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_driver_rating_of_rider_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_driver_rating_of_rider_check
  CHECK (driver_rating_of_rider IS NULL OR driver_rating_of_rider BETWEEN 1 AND 5);

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN (
    'confirmed', 'dispatching', 'driver_assigned', 'driver_en_route',
    'arrived', 'in_progress', 'completed', 'canceled', 'manual_dispatch_required'
  ));

CREATE INDEX IF NOT EXISTS idx_bookings_status_scheduled_at ON bookings(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_bookings_driver_id ON bookings(driver_id);

-- ------------------------------------------------------------
-- Card payments (Stripe): intent tracking + zelle method.
-- A MISSING stripe_payment_intent_id is what makes /payments/create-intent
-- fail (500) even when the Stripe keys ARE set — the query selects this
-- column, so its absence breaks card payment before Stripe is ever called.
-- ------------------------------------------------------------
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;
CREATE INDEX IF NOT EXISTS idx_bookings_stripe_intent
  ON bookings(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_method_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_payment_method_check
  CHECK (payment_method IN ('card','cash','zelle'));

-- ------------------------------------------------------------
-- Dispatch / earnings / payout tables (created only if missing — existing
-- rows preserved; NO drop)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ride_offers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       UUID NOT NULL REFERENCES bookings(id),
  driver_id        UUID NOT NULL REFERENCES drivers(id),
  round            INT NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','accepted','declined','expired','superseded')),
  offered_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at     TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ NOT NULL,
  pickup_address   TEXT NOT NULL,
  dropoff_address  TEXT NOT NULL,
  distance_miles   NUMERIC(6,2),
  duration_minutes INT,
  fare             NUMERIC(8,2)
);
CREATE INDEX IF NOT EXISTS idx_ride_offers_driver_pending ON ride_offers(driver_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_ride_offers_booking_id ON ride_offers(booking_id);

CREATE TABLE IF NOT EXISTS driver_earnings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   UUID NOT NULL REFERENCES drivers(id),
  booking_id  UUID REFERENCES bookings(id),
  amount      NUMERIC(8,2) NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('fare','tip','bonus','adjustment')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_driver_earnings_driver_id ON driver_earnings(driver_id, created_at);
-- How the fare was paid, so cash-out pays CARD earnings only: on a cash ride
-- the driver already collected the fare in hand, so it must never be paid out
-- again. 'cash' earnings are settled at the ride; 'card' earnings are payable.
ALTER TABLE driver_earnings ADD COLUMN IF NOT EXISTS payment_method TEXT;

CREATE TABLE IF NOT EXISTS driver_payouts (
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
CREATE INDEX IF NOT EXISTS idx_driver_payouts_driver_id ON driver_payouts(driver_id);

-- ------------------------------------------------------------
-- Row Level Security (idempotent)
-- ------------------------------------------------------------
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ride_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS drivers_select_own ON drivers;
CREATE POLICY drivers_select_own ON drivers FOR SELECT
  USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS bookings_select_stub ON bookings;
DROP POLICY IF EXISTS bookings_select_own ON bookings;
CREATE POLICY bookings_select_own ON bookings FOR SELECT
  USING (driver_id IN (SELECT id FROM drivers WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS ride_offers_select_stub ON ride_offers;
DROP POLICY IF EXISTS ride_offers_select_own ON ride_offers;
CREATE POLICY ride_offers_select_own ON ride_offers FOR SELECT
  USING (driver_id IN (SELECT id FROM drivers WHERE auth_user_id = auth.uid()));

-- ------------------------------------------------------------
-- Transactional functions
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- Auth: FK + the signup trigger (fixes "no driver profile"). The trigger
-- creates the drivers row atomically with the auth account and sets it
-- 'active' (temporary stance until verification/admin exists).
-- ------------------------------------------------------------
ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_auth_user_id_fkey;
ALTER TABLE drivers ADD CONSTRAINT drivers_auth_user_id_fkey
  FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION handle_new_driver()
RETURNS trigger AS $$
BEGIN
  INSERT INTO drivers (auth_user_id, name, phone, email, vehicle_make, vehicle_model, vehicle_color, vehicle_plate, status)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'phone',
    NEW.email,
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
    RAISE EXCEPTION 'driver_creation_failed: % (%)', SQLERRM, SQLSTATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_driver();

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

  -- Tag the earning with how the ride was paid. Cash fares are money the
  -- driver already has in hand, so cash-out must exclude them (see the
  -- earnings endpoint's cashOutBalance).
  INSERT INTO driver_earnings (driver_id, booking_id, amount, type, payment_method)
    VALUES (p_driver_id, p_booking_id, p_earnings_amount, 'fare', v_booking.payment_method);

  -- Cash ride: the driver collected the WHOLE fare from the rider, so they hold
  -- the platform's commission (fare - driver share). Record it as a negative
  -- adjustment that reduces their card cash-out — the platform recovers its cut
  -- from the driver's card earnings (standard rideshare cash handling).
  IF v_booking.payment_method = 'cash' THEN
    INSERT INTO driver_earnings (driver_id, booking_id, amount, type, payment_method)
      VALUES (p_driver_id, p_booking_id, -GREATEST(v_booking.fare - p_earnings_amount, 0), 'adjustment', 'cash');
  END IF;

  UPDATE drivers SET rides_completed = rides_completed + 1 WHERE id = p_driver_id;

  RETURN v_booking;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- One-time data repair: activate any driver still stuck on the default
-- 'pending_verification' from before the trigger existed (matches the
-- trigger's 'active' stance). Comment this block out if you WANT the gate.
-- ------------------------------------------------------------
UPDATE drivers SET status = 'active' WHERE status = 'pending_verification';

-- Backfill: create driver rows for any auth account that never got one (the
-- trigger wasn't installed when they signed up). Uses their own signup data;
-- skips accounts missing the required name/phone.
INSERT INTO drivers (auth_user_id, name, phone, email, vehicle_make, vehicle_model, vehicle_color, vehicle_plate, status)
SELECT u.id,
       u.raw_user_meta_data->>'name',
       u.raw_user_meta_data->>'phone',
       u.email,
       u.raw_user_meta_data->>'vehicle_make',
       u.raw_user_meta_data->>'vehicle_model',
       u.raw_user_meta_data->>'vehicle_color',
       u.raw_user_meta_data->>'vehicle_plate',
       'active'
FROM auth.users u
LEFT JOIN drivers d ON d.auth_user_id = u.id
WHERE d.id IS NULL
  AND u.raw_user_meta_data->>'name'  IS NOT NULL
  AND u.raw_user_meta_data->>'phone' IS NOT NULL
ON CONFLICT DO NOTHING;
