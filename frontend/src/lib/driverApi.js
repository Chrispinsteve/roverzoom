import { req } from './api';
import { supabase } from './supabaseClient';

// Attaches the current Supabase session's access token as a bearer token.
// If there's no token yet, the header is simply omitted and the backend's
// requireDriver middleware 401s naturally — "not authenticated" is handled
// in one place (the backend), not duplicated here.
function withAuth(options, token) {
  return {
    ...options,
    headers: { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  };
}

// localStorage can hold a session whose server-side record no longer exists
// (revoked, or the auth user was deleted/recreated). That zombie session
// still passes local checks, so the app renders — but every backend call
// 401s, with no way out short of clearing storage by hand. On a 401: force
// one token refresh and retry; if the session truly can't be revived, sign
// out (locally — the server no longer knows this session anyway) so the app
// lands back on Login instead of showing the same dead-session error on
// every tab.
async function signOutExpired() {
  await supabase.auth.signOut({ scope: 'local' });
  throw new Error('Your session expired. Please log in again.');
}

async function authedReq(path, options = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  try {
    return await req(path, withAuth(options, token));
  } catch (err) {
    if (err.status !== 401) throw err;
    const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
    const newToken = refreshed?.session?.access_token;
    if (refreshErr || !newToken) return signOutExpired();
    try {
      return await req(path, withAuth(options, newToken));
    } catch (err2) {
      if (err2.status === 401) return signOutExpired();
      throw err2;
    }
  }
}

export const driverApi = {
  getSchedule: () => authedReq('/driver/schedule'),
  getAvailableTrips: () => authedReq('/driver/available-trips'),
  claimBooking: (bookingId) => authedReq(`/driver/bookings/${bookingId}/claim`, { method: 'POST' }),
  releaseBooking: (bookingId) => authedReq(`/driver/bookings/${bookingId}/release`, { method: 'POST' }),
  setBookingStatus: (bookingId, event) =>
    authedReq(`/driver/bookings/${bookingId}/status`, { method: 'POST', body: JSON.stringify({ event }) }),
  getEarnings: () => authedReq('/driver/earnings'),
  getUploadUrl: (type) =>
    authedReq('/driver/profile/upload-url', { method: 'POST', body: JSON.stringify({ type }) }),
  saveDocument: (type, path) =>
    authedReq('/driver/profile/documents', { method: 'POST', body: JSON.stringify({ type, path }) }),
  rateRider: (bookingId, rating) =>
    authedReq(`/driver/bookings/${bookingId}/rate-rider`, { method: 'POST', body: JSON.stringify({ rating }) }),
};
