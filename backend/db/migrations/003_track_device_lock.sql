-- ============================================================
-- 003_track_device_lock.sql — bind a tracking link to one device
--
-- ADDITIVE ONLY. Safe to run against a live database. Run AFTER
-- 002_live_tracking.sql:
--
--   psql $DATABASE_URL -f db/migrations/003_track_device_lock.sql
--
-- WHY
-- The tracking link (/track/<track_token>) is a bearer credential: whoever
-- holds it can watch the driver during a live trip. That is by design —
-- riders have no accounts — but it means a forwarded or shoulder-surfed
-- link lets a stranger watch a driver approach. This migration adds
-- trust-on-first-use device binding: the FIRST device to open a link
-- claims it, and other devices are refused. A rider who switches phones
-- re-claims the link by proving they hold the booking's phone number
-- (POST /api/track/:token/rebind) — so the phone number becomes the
-- recovery key, not a second thing to leak.
--
-- The backend treats these columns as OPTIONAL: until this migration is
-- run, GET /api/track/:token detects their absence and serves tracking
-- exactly as before (no lock). Running the migration is what turns the
-- feature on.
-- ============================================================

ALTER TABLE bookings
  -- SHA-256 hex of the device's random secret. We store the hash, never
  -- the secret itself — same reason passwords are hashed: a leaked DB row
  -- must not hand someone the credential. The secret is 128 bits of client
  -- randomness, so a plain fast hash is fine (no bcrypt/salt needed — there
  -- is nothing low-entropy to brute-force).
  ADD COLUMN IF NOT EXISTS track_device_hash TEXT,
  -- When the current device claimed the link. Purely for support/audit
  -- ("this link was moved to a new device at 3:14pm").
  ADD COLUMN IF NOT EXISTS track_bound_at    TIMESTAMPTZ;
