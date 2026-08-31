// What happened when the driver arrived here.
//
// A driver confirming their email lands back on the site with the outcome
// encoded in the URL, and until now nothing read it. A confirmed driver landed
// on the RIDER kiosk (the redirect had no ?driver flag), and a driver with an
// expired link landed on a bare login form with no hint that anything had gone
// wrong. Both look, to the driver, like the email did nothing.
//
// Read ONCE at module load, before React renders and before anything rewrites
// the URL. Supabase's detectSessionInUrl consumes the success token from the
// hash, but it leaves the error parameters behind, so both are still readable
// here.

function readLanding() {
  if (typeof window === 'undefined') return { status: null };

  try {
    const query = new URLSearchParams(window.location.search);
    // Supabase returns failures in the hash, not the query string.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));

    const error = hash.get('error') || query.get('error');
    if (error) {
      const code = hash.get('error_code') || query.get('error_code') || '';
      const raw = hash.get('error_description') || query.get('error_description') || '';
      return { status: 'error', code, message: friendlyError(code, raw) };
    }

    // Set by us on the confirmation link, so it survives Supabase appending
    // its own token to the hash.
    if (query.get('confirmed') === '1') return { status: 'confirmed' };

    return { status: null };
  } catch {
    return { status: null };
  }
}

// Supabase's own wording is written for developers ("Email link is invalid or
// has expired"). A driver needs to know what to DO.
function friendlyError(code, raw) {
  const text = String(raw).replace(/\+/g, ' ');

  if (/expired/i.test(code) || /expired/i.test(text)) {
    return 'That confirmation link has expired. Sign up again with the same email and we’ll send a fresh one.';
  }
  if (/already/i.test(text) || code === 'user_already_exists') {
    return 'That email is already confirmed. Just log in below.';
  }
  if (/invalid/i.test(code) || /invalid/i.test(text)) {
    return 'That confirmation link is not valid. It may have already been used — try logging in, or sign up again for a new link.';
  }
  return text || 'Something went wrong confirming your email. Try logging in, or sign up again.';
}

// Captured at import time. The URL is rewritten by Supabase and by the app
// itself moments later, so reading it lazily would find nothing.
export const AUTH_LANDING = readLanding();

// Clears the markers from the address bar once they have been shown, so a
// refresh does not replay the same banner.
export function clearAuthLanding() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('confirmed');
    url.hash = '';
    window.history.replaceState({}, '', url.pathname + url.search);
  } catch {
    /* history unavailable — the banner simply shows again on refresh */
  }
}
