// Stub driver identity — no real driver auth/login yet. Every driver API
// call and Realtime subscription keys off whatever this returns, so this
// file is the ONLY thing that changes when real Supabase Auth replaces the
// stub: swap the body of getDriverId() for a real session lookup, and
// nothing downstream (driverApi.js, DriverApp.jsx, RLS policies) needs to
// change since they already key off "the current driver id".
const STORAGE_KEY = 'rz-driver-id';

export function getDriverId() {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  return stored || import.meta.env.VITE_DEV_DRIVER_ID || null;
}

export function setDriverId(id) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, id);
}
