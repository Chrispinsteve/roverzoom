-- Seeds the single dev driver used by the stub-identity phase (no real
-- driver auth yet — see the driver architecture plan). Run once, after
-- schema.sql. Copy the returned `id` into frontend/.env as VITE_DEV_DRIVER_ID.
--
-- Safe to re-run: ON CONFLICT (phone) means re-running just returns the
-- existing row's id instead of erroring or duplicating.

INSERT INTO drivers (name, phone, email, vehicle_make, vehicle_model, vehicle_color, vehicle_plate, status, rating, rides_completed)
VALUES ('Michael Anderson', '+15555550100', 'michael.anderson@example.com', 'Genesis', 'G90', 'Black', 'RZ-0001', 'active', 4.98, 5)
ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
RETURNING id;
