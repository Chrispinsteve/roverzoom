-- SMS consent for DRIVERS.
--
-- The rider side was fixed after A2P 10DLC rejection 30923, but the campaign is
-- MIXED and covers driver messages too — driverNotify sends "new ride request"
-- and "the rider canceled" texts, and both are listed as sample messages on the
-- registration. Drivers were being texted with no consent recorded anywhere, so
-- a reviewer asking "how did this recipient agree?" would find nothing.
--
-- Two parts, because a driver row is created by a TRIGGER on auth.users, not by
-- the API: the columns, and a replacement handle_new_driver() that carries the
-- consent across from signup metadata. Replacing the function is why this
-- migration is longer than the others; the body is otherwise unchanged.
--
-- NULL means no consent, and driverNotify refuses to text on it. Every driver
-- who signed up before today is therefore silent-by-default, which is correct —
-- none of them were asked.
--
-- Additive and idempotent. Safe on a live database.
--   psql "$DATABASE_URL" -f backend/db/migration-driver-sms-consent.sql

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS sms_consent_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sms_consent_version TEXT;

COMMENT ON COLUMN drivers.sms_consent_at IS
  'When the driver ticked the SMS opt-in box at signup. NULL means no consent — no operational texts may be sent to them.';
COMMENT ON COLUMN drivers.sms_consent_version IS
  'Which opt-in wording was on screen, e.g. driver-sms-2026-09-02.v1.';

-- Same function as schema.sql, plus the two consent columns. The timestamp is
-- taken from now() in the database rather than from the client, for the same
-- reason the rider's is taken on the server: a device clock must not be what
-- decides when consent happened.
CREATE OR REPLACE FUNCTION handle_new_driver()
RETURNS trigger AS $$
BEGIN
  INSERT INTO drivers (
    auth_user_id, name, phone, email,
    vehicle_make, vehicle_model, vehicle_color, vehicle_plate, status,
    sms_consent_at, sms_consent_version
  )
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'phone',
    NEW.email, -- from the real auth row, never from client-controlled metadata
    NEW.raw_user_meta_data->>'vehicle_make',
    NEW.raw_user_meta_data->>'vehicle_model',
    NEW.raw_user_meta_data->>'vehicle_color',
    NEW.raw_user_meta_data->>'vehicle_plate',
    'active',
    CASE WHEN NEW.raw_user_meta_data->>'sms_consent' = 'true' THEN now() ELSE NULL END,
    CASE WHEN NEW.raw_user_meta_data->>'sms_consent' = 'true'
         THEN NEW.raw_user_meta_data->>'sms_consent_version' ELSE NULL END
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
