// Remembers, on THIS device, which rides the rider still has in flight — so
// their live tracking is permanently reachable (booked days ahead, they can
// leave and come back any time until the ride completes). Stored as a list of
// reference codes in localStorage, newest first. TrackRide prunes a reference
// the moment its ride reaches a terminal state (completed/canceled).
//
// Note: on a SHARED kiosk tablet this would remember the previous rider's
// booking; a dedicated kiosk deployment should disable this (a future
// kiosk-mode flag). On the rider's own phone — the primary case, reached via
// the SMS/QR tracking link — it's exactly what's wanted.
const KEY = 'rz_active_rides';

export function getActiveRides() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function save(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable (private mode / disabled) — tracking still works via
       the live URL, it just isn't remembered for next time. Non-fatal. */
  }
}

export function addActiveRide(reference) {
  if (!reference) return;
  const next = [reference, ...getActiveRides().filter((r) => r !== reference)];
  save(next);
}

export function removeActiveRide(reference) {
  save(getActiveRides().filter((r) => r !== reference));
}
