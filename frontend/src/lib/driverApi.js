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
  // Creates the driver profile row if the signup trigger never did. Safe to
  // call whenever a logged-in account has no profile — idempotent server-side.
  ensureProfile: () => authedReq('/driver/ensure-profile', { method: 'POST' }),

  getSchedule: () => authedReq('/driver/schedule'),
  getAvailableTrips: () => authedReq('/driver/available-trips'),
  claimBooking: (bookingId) => authedReq(`/driver/bookings/${bookingId}/claim`, { method: 'POST' }),

  // The trip this driver is currently on, if any. Called on app start so
  // a driver whose phone died mid-ride lands back in the right screen
  // instead of on the dashboard with a passenger in the car.
  getActiveTrip: () => authedReq('/driver/active-trip'),

  setStatus: (bookingId, status, reason) =>
    authedReq(`/driver/bookings/${bookingId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, reason }),
    }),

  // Batched GPS upload. See driver/useDriverLocation.js for why this
  // takes an array rather than a single fix.
  sendLocation: ({ bookingId, pings }) =>
    authedReq('/driver/location', {
      method: 'POST',
      body: JSON.stringify({ bookingId, pings }),
    }),

  setOnline: (online) =>
    authedReq('/driver/online', { method: 'POST', body: JSON.stringify({ online }) }),

  // Payouts (Stripe Connect Express) + background check (Checkr).
  getPayoutStatus: () => authedReq('/driver/payouts/status'),
  startPayoutOnboarding: () => authedReq('/driver/payouts/onboard', { method: 'POST' }),
  getScreeningStatus: () => authedReq('/driver/screening/status'),
  startScreening: () => authedReq('/driver/screening/start', { method: 'POST' }),
};
