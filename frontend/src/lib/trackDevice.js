// ============================================================
// trackDevice — the per-device secret that binds a tracking link
// ============================================================
// The tracking link works on any phone on its own. To limit a live trip
// to the one device the rider is actually using, each browser generates a
// random 128-bit secret the first time it opens a given link, stores it,
// and sends it with every tracking request. The server keeps only a hash
// of it (see routes/track.js) and refuses other devices.
//
// The secret is per-token, so one browser can legitimately track two
// different bookings, and clearing one never disturbs another.
//
// localStorage can be unavailable (private mode, storage disabled). When
// it is, we fall back to a secret that lives only for this page's lifetime
// in memory — tracking still works for the session, the rider just has to
// re-verify with their phone number if they reload. That is a strictly
// better failure than throwing.

const PREFIX = 'rz_track_dev_';
const memory = new Map(); // token -> secret, fallback when storage is blocked

function randomSecret() {
  try {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // No Web Crypto — uniqueness is all that matters here, not secrecy
    // against the holder of this very browser.
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  }
}

function read(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function write(key, value) {
  try { window.localStorage.setItem(key, value); return true; } catch { return false; }
}

// Returns this device's secret for a token, minting and persisting one on
// first use.
export function getDeviceSecret(token) {
  if (!token) return null;
  const key = PREFIX + token;

  const stored = read(key);
  if (stored) return stored;
  if (memory.has(token)) return memory.get(token);

  const secret = randomSecret();
  if (!write(key, secret)) memory.set(token, secret);
  return secret;
}

// Used by the recovery flow: the rider proved the phone number, so this
// device should now become the bound one. We rotate to a fresh secret so
// the value that was refused a moment ago is not the value we re-submit.
export function resetDeviceSecret(token) {
  if (!token) return null;
  const key = PREFIX + token;
  const secret = randomSecret();
  if (!write(key, secret)) memory.set(token, secret);
  return secret;
}
