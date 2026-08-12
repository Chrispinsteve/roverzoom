const crypto = require('crypto');

// ============================================================
// Admin authentication — INTERIM
// ============================================================
// A single shared secret in the `x-admin-key` header, checked against
// ADMIN_API_KEY.
//
// This is deliberately a stopgap, and it should be read as one. The
// admin dashboard is being built separately on its own domain, and
// blocking the tracking work on a full admin identity system would be
// the wrong order to do things in — but shipping fleet-wide live
// location behind nothing at all would be worse. So: one key, scoped to
// read-only endpoints, until real admin auth exists.
//
// What is genuinely weak about it, stated plainly rather than buried:
//
//   * One secret for every admin. No way to tell who ran a query, and
//     revoking one person's access means rotating it for everyone.
//   * No expiry, so a key that leaks into a screenshot, a shell history
//     or a frontend bundle stays valid until someone notices.
//   * No per-endpoint scoping, no rate limiting, no audit trail — and
//     these endpoints expose continuous location history for real
//     people, which is about the most sensitive data this platform holds.
//
// Replace it when the admin app lands. The natural fit is Supabase Auth
// with an `admins` table and an is_admin() check, mirroring how drivers
// already authenticate — at which point this file is deleted and the
// routes swap one middleware for another.
//
// Until then:
//   * Generate with `openssl rand -hex 32`. Never reuse another secret.
//   * Server-side only. The moment this key is needed in browser code,
//     the model has been outgrown — build real auth instead.
// ============================================================

function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_API_KEY || '';

  // Fail closed. An unset key means the admin surface is off, not open
  // — the opposite default would turn a forgotten environment variable
  // on a fresh deploy into public fleet tracking.
  if (expected.length < 32) {
    console.error('[requireAdmin] ADMIN_API_KEY is unset or too short — admin API disabled.');
    return res.status(503).json({ error: 'Admin API is not configured.' });
  }

  const provided = req.headers['x-admin-key'];
  if (typeof provided !== 'string' || provided.length === 0) {
    return res.status(401).json({ error: 'Missing admin key.' });
  }

  // Constant-time comparison. A plain === leaks the correct prefix
  // through response timing, letting an attacker recover the key one
  // character at a time instead of brute-forcing the whole space.
  //
  // timingSafeEqual throws on length mismatch, which would leak length
  // through the error path, so both sides are hashed to a fixed 32 bytes
  // first and the digests are compared.
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Invalid admin key.' });
  }

  next();
}

module.exports = { requireAdmin };
