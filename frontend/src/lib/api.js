import { getDeviceSecret, resetDeviceSecret } from './trackDevice';

const BASE = import.meta.env.VITE_API_URL || '';

export async function req(path, options = {}) {
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
  } catch {
    throw new Error('Can’t reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fallback = res.status === 404
      ? 'That service is unavailable right now. Please try again in a moment.'
      : 'Something went wrong. Please try again.';
    const err = new Error(data.error || fallback);
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

// ------------------------------------------------------------
// Places autocomplete session tokens
//
// Google bills autocomplete two ways. Without a session token every
// keystroke is a separate billable request, so one address typed with
// eight characters of debounced input costs eight. With a token, all the
// keystrokes for one address PLUS the final Place Details lookup are
// billed together as a single session.
//
// The rule that makes it work: one token per address the rider is
// entering, held across every keystroke, then thrown away the moment
// they pick a suggestion. Reusing a token after a pick, or minting a new
// one per keystroke, both quietly revert to per-request billing while
// appearing to work perfectly.
// ------------------------------------------------------------
export function newSessionToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Older Safari lacks randomUUID. The token only needs to be unique
  // within one user's session, not unguessable, so this is sufficient.
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const api = {
  geocode: (q, session) =>
    req(`/geocode?q=${encodeURIComponent(q)}${session ? `&session=${encodeURIComponent(session)}` : ''}`),

  // Second half of the autocomplete handshake — resolves the picked
  // suggestion into coordinates. See routes/quote.js.
  resolvePlace: (pick, session) =>
    req('/place', { method: 'POST', body: JSON.stringify({ ...pick, session }) }),

  estimate: (pickup, dropoff, scheduledAt) =>
    req('/estimate', { method: 'POST', body: JSON.stringify({ pickup, dropoff, scheduledAt }) }),

  createBooking: (payload) =>
    req('/bookings', { method: 'POST', body: JSON.stringify(payload) }),

  getBooking: (ref) => req(`/bookings/${ref}`),

  // Public rider tracking. Takes the 32-char track_token, NOT the
  // RZ-XXXXX reference. The device secret rides in a header so the server
  // can bind the link to this one device (see lib/trackDevice.js).
  track: (token) =>
    req(`/track/${encodeURIComponent(token)}`, {
      headers: { 'X-Track-Device': getDeviceSecret(token) || '' },
    }),

  // Move a locked tracking link to THIS device by proving the booking's
  // phone number. Rotates to a fresh secret first so we don't resubmit the
  // value the server just refused.
  rebindTrack: (token, phone) =>
    req(`/track/${encodeURIComponent(token)}/rebind`, {
      method: 'POST',
      body: JSON.stringify({ phone, deviceSecret: resetDeviceSecret(token) }),
    }),

  mapsStatus: () => req('/maps/status'),

  aiStatus: () => req('/ai/status'),
  aiChat: (history) => req('/ai/chat', { method: 'POST', body: JSON.stringify({ history }) }),

  // Card payments (Stripe). config reports whether card charging is live
  // and the publishable key; create-intent returns a clientSecret for the
  // booking. Both no-op gracefully when Stripe isn't configured server-side.
  paymentsConfig: () => req('/payments/config'),
  createPaymentIntent: (bookingId) =>
    req('/payments/create-intent', { method: 'POST', body: JSON.stringify({ bookingId }) }),
};
