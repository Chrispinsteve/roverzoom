-- Recurring rides: the commuter product.
--
-- A series is a TEMPLATE. It does not replace a booking, it produces them —
-- real rows in `bookings`, materialised ahead of time. That is the whole design
-- decision, and everything cheap about this phase follows from it: dispatch,
-- the driver's schedule, tracking links, fares, SMS and the admin console all
-- keep working untouched, because a generated ride is an ordinary booking that
-- happens to know where it came from.
--
-- WHY A LOCAL TIME AND A ZONE, NOT A TIMESTAMP
-- pickup_time is TIME and timezone is a name, so 07:30 stays 07:30 across the
-- March and November DST changes. Stored as a UTC time-of-day instead, every
-- ride after a changeover would fire an hour out — which for this product means
-- the rider is an hour late for work, twice a year, on a schedule they bought
-- precisely so that would never happen.
--
-- HOW A SKIPPED DAY WORKS
-- There is no exceptions table. "Skip tomorrow" cancels the generated booking,
-- using the cancellation machinery that already exists. The unique index on
-- (series_id, series_date) is what stops the generator resurrecting it: the
-- cancelled row still occupies that date.
--
-- Additive and idempotent. Safe on a live database.
--   psql "$DATABASE_URL" -f backend/db/migration-ride-series.sql

CREATE TABLE IF NOT EXISTS ride_series (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Same minimal identity as a booking: no rider accounts anywhere in this
  -- product, and a recurring ride is not a reason to introduce them.
  rider_name         TEXT NOT NULL,
  rider_phone        TEXT NOT NULL,
  rider_email        TEXT,

  pickup_address     TEXT NOT NULL,
  pickup_lat         NUMERIC(9,6),
  pickup_lng         NUMERIC(9,6),
  dropoff_address    TEXT NOT NULL,
  dropoff_lat        NUMERIC(9,6),
  dropoff_lng        NUMERIC(9,6),

  -- 0 = Sunday … 6 = Saturday, matching JavaScript's Date#getDay so the
  -- generator never has to convert between conventions — which is where
  -- off-by-one weekday bugs come from.
  days_of_week       SMALLINT[] NOT NULL,
  pickup_time        TIME NOT NULL,
  timezone           TEXT NOT NULL DEFAULT 'America/New_York',

  starts_on          DATE NOT NULL,
  ends_on            DATE,

  status             TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','paused','ended')),

  -- Commuters pre-pay on a saved card; that is the point of the product. Cash
  -- is allowed for a manually-run pilot but cannot be charged ahead.
  payment_method     TEXT NOT NULL DEFAULT 'card'
                       CHECK (payment_method IN ('card','cash')),

  -- Step 3. Nullable now: a series works without it, riders just do not get a
  -- guaranteed driver yet.
  preferred_driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,

  -- How far ahead bookings have been created. Lets the generator resume after a
  -- failure without rescanning, and makes "is this series healthy?" answerable
  -- with one column instead of a join.
  generated_through  DATE,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A weekday list must be real weekdays, and non-empty, or the generator
-- silently produces nothing and the rider is never picked up.
ALTER TABLE ride_series DROP CONSTRAINT IF EXISTS ride_series_days_valid;
ALTER TABLE ride_series ADD CONSTRAINT ride_series_days_valid CHECK (
  array_length(days_of_week, 1) BETWEEN 1 AND 7
  AND days_of_week <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]
);

ALTER TABLE ride_series DROP CONSTRAINT IF EXISTS ride_series_dates_valid;
ALTER TABLE ride_series ADD CONSTRAINT ride_series_dates_valid CHECK (
  ends_on IS NULL OR ends_on >= starts_on
);

-- The link back. series_date is the LOCAL calendar date the ride belongs to,
-- which is not always derivable from scheduled_at once time zones are involved
-- — a 00:30 pickup in New York is the previous day in UTC.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS series_id   UUID REFERENCES ride_series(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS series_date DATE;

-- The idempotency guarantee. The generator can run twice, overlap with itself,
-- or resume mid-failure and still never create a second ride for a date — and a
-- cancelled ride keeps its slot, so a skipped day stays skipped.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_series_date
  ON bookings(series_id, series_date)
  WHERE series_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ride_series_active
  ON ride_series(status, generated_through)
  WHERE status = 'active';

COMMENT ON TABLE  ride_series IS 'Template for a recurring ride. Produces real rows in bookings; never replaces them.';
COMMENT ON COLUMN ride_series.days_of_week IS '0=Sunday .. 6=Saturday, matching JavaScript Date#getDay.';
COMMENT ON COLUMN ride_series.pickup_time IS 'Local wall-clock time in `timezone`. Stored this way so 07:30 stays 07:30 across DST.';
COMMENT ON COLUMN ride_series.generated_through IS 'Last local date for which bookings have been materialised.';
COMMENT ON COLUMN bookings.series_id IS 'The recurring series this ride was generated from, if any.';
COMMENT ON COLUMN bookings.series_date IS 'Local calendar date this ride belongs to. Not always derivable from scheduled_at across time zones.';
