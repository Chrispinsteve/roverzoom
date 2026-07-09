const BASE = import.meta.env.VITE_API_URL || '';

async function req(path, options = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
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
