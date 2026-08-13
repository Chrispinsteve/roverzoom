// Real map navigation via each platform's native maps app — no API key, no
// dependency. Opens Apple Maps on iPhone/iPad and Google Maps on Android (and
// Google Maps on the web everywhere else), with driving directions to the stop.

function isIOS() {
  if (typeof navigator === 'undefined') return false;
  return /iP(hone|ad|od)/.test(navigator.userAgent)
    // iPadOS 13+ reports as "MacIntel" but has a touch screen.
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function mapsUrl(lat, lng, address) {
  // Prefer the rider's ADDRESS TEXT over our stored lat/lng. When a rider types
  // an address without picking a suggestion, we keep their exact text but the
  // coordinates come from the free geocoder, which can snap to a nearby block or
  // the street centroid — so navigating by coords sends the driver to the wrong
  // spot. Apple/Google geocode the address string precisely; fall back to coords
  // only when there's no address.
  const dest = (address && address.trim())
    ? encodeURIComponent(address.trim())
    : `${lat},${lng}`;
  // Apple Maps opens natively on iOS from a maps.apple.com link; daddr =
  // destination, dirflg=d = driving directions from the driver's location.
  if (isIOS()) return `https://maps.apple.com/?daddr=${dest}&dirflg=d`;
  // Google Maps universal directions link — opens the app on Android.
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
}
