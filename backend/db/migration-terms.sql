-- Rider age attestation, captured at booking.
--
-- The booking flow has never had any age concept: a name over one character
-- and an unverified 10-digit phone number is the whole identity check, and
-- cash is an accepted payment method, so nothing in the system could tell an
-- adult from a 13-year-old. This records the rider's confirmation that they
-- are 18+ (or the parent/guardian of the rider) at the moment they book.
-- Displaying the term is not the point — RECORDING it is. An attestation with
-- no record of who accepted what, and when, is not evidence of anything.
-- terms_version pins WHICH wording was shown, so the text can be revised later
-- without making older bookings unexplainable.
--
-- Additive and idempotent. Safe on a live database.
--   psql "$DATABASE_URL" -f backend/db/migration-terms.sql

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_version     TEXT;

CREATE INDEX IF NOT EXISTS idx_bookings_terms_accepted
  ON bookings(terms_accepted_at)
  WHERE terms_accepted_at IS NULL;

COMMENT ON COLUMN bookings.terms_accepted_at IS
  'When the rider confirmed they are 18+ or the parent/guardian of the rider. NULL on bookings taken before this was introduced.';
COMMENT ON COLUMN bookings.terms_version IS
  'Which wording was shown, e.g. age-2026-08-29.v1. Lets the text change without making older bookings unexplainable.';
