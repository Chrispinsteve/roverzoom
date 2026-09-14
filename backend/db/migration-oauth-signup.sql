-- Let a driver sign in with Google.
--
-- THE PROBLEM THIS SOLVES
-- drivers.phone is UNIQUE NOT NULL, and handle_new_driver() builds the row from
-- raw_user_meta_data the moment an auth.users row appears. An email/password
-- signup carries name, phone and vehicle in that metadata, so it works.
--
-- Google carries an email and a name and NEVER a phone. So the insert hits a
-- not_null_violation, the trigger raises, and because the trigger runs inside
-- the same transaction THE AUTH USER IS ROLLED BACK TOO. The driver would tap
-- "Sign in with Google", bounce through Google, and land back on an error with
-- no account created and nothing to explain why.
--
-- THE FIX
-- No phone in the metadata means this is an OAuth signup, and the profile is
-- not ours to invent. The trigger returns without creating a row; the driver
-- lands on a "finish your profile" screen, gives their phone and vehicle, and
-- the app creates the row through ensure-profile — which already exists for
-- exactly this "authenticated but no profile" case.
--
-- Email/password signup is completely unchanged: that metadata always has a
-- phone, so it takes the same path it does today.
--
-- Idempotent. Safe on a live database.
--   psql "$DATABASE_URL" -f backend/db/migration-oauth-signup.sql

CREATE OR REPLACE FUNCTION handle_new_driver()
RETURNS trigger AS $$
BEGIN
  -- OAuth: the identity is real, the profile is not filled in yet. Creating a
  -- half row here would either fail outright or produce a driver with no phone
  -- that dispatch cannot contact.
  IF COALESCE(NEW.raw_user_meta_data->>'phone', '') = '' THEN
    RETURN NEW;
  END IF;

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
