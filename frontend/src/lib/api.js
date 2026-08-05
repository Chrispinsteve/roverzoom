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

export const api = {
  geocode: (q) => req(`/geocode?q=${encodeURIComponent(q)}`),
  // Commit-time lookup (on blur): prefers Google for house-number precision.
  geocodePrecise: (q) => req(`/geocode?q=${encodeURIComponent(q)}&precise=1`),
  reverseGeocode: (lat, lng) => req(`/reverse-geocode?lat=${lat}&lng=${lng}`),
  estimate: (pickup, dropoff, when) =>
    req('/estimate', { method: 'POST', body: JSON.stringify({ pickup, dropoff, when }) }),
  createBooking: (payload) =>
    req('/bookings', { method: 'POST', body: JSON.stringify(payload) }),
  getBooking: (ref) => req(`/bookings/${ref}`),
  cancelBooking: (ref) => req(`/bookings/${encodeURIComponent(ref)}/cancel`, { method: 'POST' }),
  getBookingsByPhone: (phone) => req(`/bookings/by-phone/${encodeURIComponent(phone)}`),
  getPaymentsConfig: () => req('/payments/config'),
  createPaymentIntent: (bookingId) =>
    req('/payments/create-intent', { method: 'POST', body: JSON.stringify({ bookingId }) }),
  assistant: (history, message, location) =>
    req('/assistant', { method: 'POST', body: JSON.stringify({ history, message, location }) }),
};
