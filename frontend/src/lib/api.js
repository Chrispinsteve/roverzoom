const BASE = import.meta.env.VITE_API_URL || '';

async function req(path, options = {}) {
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
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
  estimate: (pickup, dropoff) =>
    req('/estimate', { method: 'POST', body: JSON.stringify({ pickup, dropoff }) }),
  createBooking: (payload) =>
    req('/bookings', { method: 'POST', body: JSON.stringify(payload) }),
  getBooking: (ref) => req(`/bookings/${ref}`),
  aiStatus: () => req('/ai/status'),
  aiChat: (history) => req('/ai/chat', { method: 'POST', body: JSON.stringify({ history }) }),
};
