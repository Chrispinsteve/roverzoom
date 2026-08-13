// Canonical public origin for QR codes and shareable tracking links. Even if
// the kiosk happens to be loaded from another host (e.g. the raw Vercel URL),
// generated codes and links must always point at the real domain.
//
// Uses the www host because it serves 200 DIRECTLY — the bare apex only works
// via a 308 redirect to www, and that extra hop is what makes some QR scanners
// / in-app browsers land on a Vercel 404. Pointing straight at the 200 host
// removes that failure mode. (If the apex is ever made the primary domain in
// Vercel — serving 200 itself — switch this back to https://roverzoom.com.)
export const PUBLIC_ORIGIN = 'https://www.roverzoom.com';

// A private tracking deep-link. `token` is the booking's UUID id (unguessable),
// not the short human reference — so only whoever holds the link can view the ride.
export const trackUrl = (token) => `${PUBLIC_ORIGIN}/?track=${encodeURIComponent(token)}`;
