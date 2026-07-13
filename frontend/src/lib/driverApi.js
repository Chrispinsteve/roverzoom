import { req } from './api';
import { supabase } from './supabaseClient';

// Attaches the current Supabase session's access token as a bearer token.
// If there's no token yet, the header is simply omitted and the backend's
// requireDriver middleware 401s naturally — "not authenticated" is handled
// in one place (the backend), not duplicated here.
async function authedReq(path, options = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return req(path, {
    ...options,
    headers: { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
}

export const driverApi = {
  getSchedule: () => authedReq('/driver/schedule'),
  getAvailableTrips: () => authedReq('/driver/available-trips'),
  claimBooking: (bookingId) => authedReq(`/driver/bookings/${bookingId}/claim`, { method: 'POST' }),
};
