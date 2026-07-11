import { createClient } from '@supabase/supabase-js';

// Browser Supabase client — used ONLY for Realtime subscriptions (new ride
// offers, booking status changes). All writes go through the Express API
// (backend/lib/api.js -> driverApi.js), which uses the service-role key and
// is the only thing allowed to bypass RLS. The anon key below is safe to
// expose to the browser by design — unlike SUPABASE_SERVICE_ROLE_KEY, it's
// meant to be public and is constrained entirely by RLS policies.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — driver realtime features will not work.');
}

export const supabase = createClient(
  url || 'https://misconfigured.supabase.co',
  anonKey || 'missing-anon-key',
  { auth: { persistSession: false } }
);
