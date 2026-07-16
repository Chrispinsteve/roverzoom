// Real map navigation via Google's universal deep-link URL — no API key, no
// new dependency, opens the native Maps app on iOS/Android or falls back to
// Google Maps in a browser tab. Replaces the previous fake RouteMap
// illustration (which drew a hardcoded SVG path — not a real map).
export function mapsUrl(lat, lng, address) {
  if (lat != null && lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}
