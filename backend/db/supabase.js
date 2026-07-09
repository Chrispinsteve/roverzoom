require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// The service_role key bypasses Row Level Security — required because this
// backend, not the browser, owns writes (bookings, and soon driver
// assignment/status). It must never be sent to the frontend, same rule as
// ANTHROPIC_API_KEY.
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — database calls will fail.');
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

module.exports = supabase;
