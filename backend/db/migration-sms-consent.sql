-- Explicit SMS consent, recorded per booking.
--
-- The A2P 10DLC campaign was rejected under error 30923: consent to receive
-- messages was a condition of using the service. The booking form said "By
-- booking, you agree to receive text messages", with no checkbox and no way to
-- decline. Carriers require the opposite — a distinct, unchecked, skippable
-- opt-in — and they require the granting of it to be RECORDED, because a
-- campaign audit asks who agreed to what and when.
--
-- NULL means no consent, and that is load-bearing: sendSms refuses to message
-- a booking whose sms_consent_at is null. Every booking taken before this
-- migration is therefore treated as no-consent, which is the correct and
-- conservative reading — nobody was ever given the choice.
--
-- Additive and idempotent. Safe on a live database.
--   psql "$DATABASE_URL" -f backend/db/migration-sms-consent.sql

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS sms_consent_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sms_consent_version TEXT;

-- The audit question is "show me the consented bookings", so that is what is
-- indexed. Partial, because consented rows are the minority worth scanning.
CREATE INDEX IF NOT EXISTS idx_bookings_sms_consent
  ON bookings(sms_consent_at)
  WHERE sms_consent_at IS NOT NULL;

COMMENT ON COLUMN bookings.sms_consent_at IS
  'When the rider ticked the SMS opt-in box. NULL means no consent was given — no messages may be sent for this booking.';
COMMENT ON COLUMN bookings.sms_consent_version IS
  'Which opt-in wording was on screen, e.g. sms-2026-09-02.v1. Lets the text change without making older consents unexplainable.';
