-- Payments migration: Zelle as a payment method + Stripe intent tracking.
-- Additive and safe to run against a live database:
--   psql $DATABASE_URL -f db/migration-payments.sql

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_method_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_payment_method_check
  CHECK (payment_method IN ('card','cash','zelle'));

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;
CREATE INDEX IF NOT EXISTS idx_bookings_stripe_intent
  ON bookings(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
