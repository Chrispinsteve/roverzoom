// Google Ads conversion reporting. The base gtag.js is loaded in index.html;
// this fires the "booking completed" conversion so Google Ads can optimise for
// (and value) real bookings, keyed to the fare.
//
// IMPORTANT — only count bookings that came FROM an ad:
// Google already only *attributes* a conversion to a campaign when the visitor
// clicked a Google Ad (a gclid is on record). On top of that, we don't even
// *fire* the conversion unless this visitor arrived from an ad click. So kiosk
// walk-ups and organic/direct bookings never generate a conversion signal.
//
// CONVERSION_LABEL comes from the Google Ads "Purchases" conversion action
// (looks like 'AbC-D_1efGhIjkLmN'). Until it's filled in, the base tag still
// tracks the account and the conversion event no-ops.
const CONVERSION_ID = import.meta.env.VITE_ADS_CONVERSION_ID || 'AW-18393777489';

// Set VITE_ADS_CONVERSION_LABEL in the Vercel environment rather than editing
// this file. It is configuration, not code: an operator can correct it without
// a commit, and it cannot be lost in a merge.
const CONVERSION_LABEL = import.meta.env.VITE_ADS_CONVERSION_LABEL || '';

// Without a label, reportBookingConversion() silently does nothing — which is
// exactly how this went unnoticed while the campaign spent money with no
// signal at all. Say so once, loudly, in the console.
if (typeof window !== 'undefined' && !CONVERSION_LABEL) {
  console.warn(
    '[ads] VITE_ADS_CONVERSION_LABEL is not set — booking conversions are NOT being ' +
    'reported to Google Ads. Performance Max is optimising blind. Get the label from ' +
    'Google Ads > Goals > Conversions > (your action) > Tag setup.'
  );
}

// Google click identifiers: gclid (web), gbraid/wbraid (iOS app/limited).
const CLICK_KEYS = ['gclid', 'gbraid', 'wbraid'];
const STORE_KEY = 'rz_ad_click';
const CLICK_WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // 90-day click-through window

// Capture an ad click the moment the visitor lands (?gclid=... etc.) and keep
// it for the conversion window. Runs on load, before any in-app navigation
// rewrites the URL.
function captureAdClick() {
  try {
    const q = new URLSearchParams(window.location.search);
    for (const k of CLICK_KEYS) {
      const v = q.get(k);
      if (v) {
        localStorage.setItem(STORE_KEY, JSON.stringify({ id: v, at: Date.now() }));
        return;
      }
    }
  } catch {
    /* storage/URL unavailable — treat as no ad click */
  }
}

function cameFromAd() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const { at } = JSON.parse(raw);
    return typeof at === 'number' && Date.now() - at < CLICK_WINDOW_MS;
  } catch {
    return false;
  }
}

if (typeof window !== 'undefined') captureAdClick();

// Report a completed booking as a conversion — ONLY if the visitor came from a
// Google Ad. Best-effort and defensive: never throws into the booking flow, and
// transaction_id de-dupes so a re-render of the confirmation can't double-count.
export function reportBookingConversion(booking) {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  if (!CONVERSION_LABEL) return;     // warned about at load; stay quiet per booking
  // Not an ad-driven booking. Kiosk walk-ups and organic visitors must never
  // generate a conversion signal, or the campaign learns from traffic it did
  // not buy.
  if (!cameFromAd()) return;
  try {
    window.gtag('event', 'conversion', {
      send_to: `${CONVERSION_ID}/${CONVERSION_LABEL}`,
      value: Number(booking?.fare) || undefined,
      currency: 'USD',
      transaction_id: booking?.reference || booking?.id || undefined,
    });
  } catch {
    /* analytics must never break a booking */
  }
}
