import { createClient } from '@supabase/supabase-js';

// Browser Supabase client — used for driver auth sessions (login/signup) and
// Realtime subscriptions (new ride offers, booking status changes). All
// writes to app tables still go through the Express API (lib/api.js ->
// driverApi.js), which uses the service-role key and is the only thing
// allowed to bypass RLS; this client only ever reads its own row (via
// drivers_select_own RLS) and manages auth. The anon key below is safe to
// expose to the browser by design — unlike SUPABASE_SERVICE_ROLE_KEY, it's
// meant to be public and is constrained entirely by RLS policies.
// Hardcoded fallbacks so a build where the VITE_ vars are missing (e.g. a
// Vercel deploy whose dashboard env vars were renamed/removed) still ships a
// WORKING frontend instead of a dead "misconfigured" placeholder. Safe
// precisely because both values are public by design: the URL is just the
// project address, and the anon key ships in every built bundle anyway.
// VITE_ env vars still win when present.
const FALLBACK_URL = 'https://mktoysczpgibaokqivwv.supabase.co';
const FALLBACK_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rdG95c2N6cGdpYmFva3Fpdnd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MTg3MTUsImV4cCI6MjA5OTE5NDcxNX0.iEgTSPhsR0eVO85nbiYzM4ezfQniT3GPjvXkePUzggI';

const url = import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_ANON_KEY;

export const supabase = createClient(
  url,
  anonKey,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);
