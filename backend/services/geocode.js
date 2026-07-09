// Server-side forward geocoding via OpenStreetMap Nominatim (no key).
// Doing this on the server keeps the frontend free of third-party calls and
// lets us add caching / a paid provider later in one place.
//
// Nominatim asks for a descriptive User-Agent and <=1 req/sec. For production
// scale, self-host Nominatim or use a paid geocoder.

const USER_AGENT = 'RoverZoom/0.1 (booking demo)';

async function geocode(query, limit = 5) {
  if (!query || query.trim().length < 3) return [];
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    addressdetails: '1',
    limit: String(limit),
    countrycodes: 'us',
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const rows = await res.json();
  return rows.map((r) => ({
    label: r.name || r.display_name.split(',')[0],
    sublabel: r.display_name.split(',').slice(1, 4).join(',').trim(),
    address: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
  }));
}

/** Best single match for a free-text address (used by AI parsing). */
async function geocodeOne(query) {
  const results = await geocode(query, 1);
  return results[0] || null;
}

module.exports = { geocode, geocodeOne };
