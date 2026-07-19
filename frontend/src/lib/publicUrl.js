// Canonical public origin for QR codes and shareable tracking links. Even if
// the kiosk happens to be loaded from another host (e.g. the raw Vercel URL),
// generated codes and links must always point at the real domain.
export const PUBLIC_ORIGIN = 'https://roverzoom.com';

// A private tracking deep-link. `token` is the booking's UUID id (unguessable),
// not the short human reference — so only whoever holds the link can view the ride.
export const trackUrl = (token) => `${PUBLIC_ORIGIN}/?track=${encodeURIComponent(token)}`;
