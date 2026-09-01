-- Airport ride details, captured from the rider at booking time.
--
-- Without these the driver finds out which terminal by asking through the
-- window at the kerb. That fails exactly when it matters most: a driver who is
-- deaf, a driver and rider with no shared language, or a rider off a red-eye —
-- and it fails in the one place there is nowhere to stop and work it out.
--
-- airport_role is DERIVED at booking time, never asked: if the airport is the
-- drop-off the rider is flying out, if it is the pickup they have landed.
--
-- Every column is nullable. Almost no ride is an airport ride, and a rider who
-- skips the question still gets a booking — the driver simply falls back to
-- asking, which is exactly where things stand today.
--
-- Additive and idempotent. Safe on a live database.
--   psql "$DATABASE_URL" -f backend/db/migration-airport.sql

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS airport_role    TEXT,
  ADD COLUMN IF NOT EXISTS airport_code    TEXT,
  ADD COLUMN IF NOT EXISTS airport_zone    TEXT,
  ADD COLUMN IF NOT EXISTS airport_airline TEXT,
  ADD COLUMN IF NOT EXISTS airport_flight  TEXT;

-- Only two values are meaningful; anything else is a bug upstream.
ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_airport_role_check;
ALTER TABLE bookings
  ADD CONSTRAINT bookings_airport_role_check
  CHECK (airport_role IS NULL OR airport_role IN ('departure', 'arrival'));

COMMENT ON COLUMN bookings.airport_role IS
  'departure = rider is flying out (airport is the drop-off); arrival = rider has landed (airport is the pickup). Derived from which end of the trip is the airport, never asked.';
COMMENT ON COLUMN bookings.airport_code IS 'IATA code of the airport on this trip, e.g. PBI, FLL, MIA.';
COMMENT ON COLUMN bookings.airport_zone IS 'Terminal or concourse the rider gave, e.g. "Terminal 3", "Concourse B".';
COMMENT ON COLUMN bookings.airport_airline IS 'Airline, which is what a rider reliably knows and what signage at the kerb is organised by.';
COMMENT ON COLUMN bookings.airport_flight IS 'Flight number, optional. Lets a driver confirm the terminal independently.';
