// Client-side haversine for "X mi from you" on request cards. Uses the
// browser's geolocation once (no tracking, no watch) — purely to help the
// driver judge deadhead distance before accepting. Fails silently: no
// permission means the chip simply doesn't render.
const EARTH_MILES = 3958.8;
const toRad = (d) => (d * Math.PI) / 180;

export function haversineMiles(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function getPositionOnce() {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 120000 }
    );
  });
}

// Two trips conflict if their time windows (scheduled_at .. +duration, with a
// buffer for getting between them) overlap.
export function overlaps(aStartIso, aMins, bStartIso, bMins, bufferMins = 30) {
  const aStart = new Date(aStartIso).getTime();
  const aEnd = aStart + ((aMins || 30) + bufferMins) * 60000;
  const bStart = new Date(bStartIso).getTime();
  const bEnd = bStart + ((bMins || 30) + bufferMins) * 60000;
  return aStart < bEnd && bStart < aEnd;
}
