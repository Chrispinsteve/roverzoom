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
  const dest = (lat != null && lng != null)
    ? `${lat},${lng}`
    : encodeURIComponent(address || '');
  // Apple Maps opens natively on iOS from a maps.apple.com link; daddr =
  // destination, dirflg=d = driving directions from the driver's location.
  if (isIOS()) return `https://maps.apple.com/?daddr=${dest}&dirflg=d`;
  // Google Maps universal directions link — opens the app on Android.
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
}
