require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// The service_role key bypasses Row Level Security — required because this
// backend, not the browser, owns writes (bookings, and soon driver
// assignment/status). It must never be sent to the frontend, same rule as
// ANTHROPIC_API_KEY.
//
// createClient() throws synchronously if the URL is missing/malformed. On a
// serverless platform that would crash the whole function on every cold
// start over a config typo. Fall back to a syntactically-valid placeholder
// so the module always loads; a missing/wrong key then fails per-request
// with a normal caught error instead of taking the function down entirely.
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — database calls will fail.');
}

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://misconfigured.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'missing-service-role-key',
  { auth: { persistSession: false } }
);

module.exports = supabase;
