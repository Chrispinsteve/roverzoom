// Google Ads conversion reporting. The base gtag.js is loaded in index.html;
// this fires the "booking completed" conversion so Google Ads can optimise for
// (and value) real bookings, keyed to the fare.
//
// CONVERSION_LABEL comes from the Google Ads conversion action (the "Purchases"
// action). It looks like a short token, e.g. 'AbC-D_1efGhIjkLmN'. Until it's
// filled in, the base tag still tracks the account — the conversion event just
// no-ops (better than sending an unattributed event).
const CONVERSION_ID = 'AW-18393777489';
const CONVERSION_LABEL = ''; // <-- paste the Purchases conversion label here

// Report a completed booking as a conversion. Best-effort and defensive: it
// must never throw into the booking flow, and transaction_id de-dupes so a
// re-render of the confirmation screen can't double-count.
export function reportBookingConversion(booking) {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  if (!CONVERSION_LABEL) return;
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
