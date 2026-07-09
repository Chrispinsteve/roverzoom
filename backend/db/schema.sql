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
