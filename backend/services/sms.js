// SMS notifications via Twilio. Two touch-points in the rider journey:
//   1. booking created  -> "your ride is scheduled" confirmation
//   2. a driver accepts  -> "your driver is coming" + a LIVE TRACKING LINK
//
// The second message is the whole point of the tracking work: the rider books
// on a shared back-seat tablet and walks away, so tracking has to reach them
// on their OWN phone. This text carries the deep link that opens it there.
//
// Lazy-initialized exactly like the Stripe client in routes/payments.js, and
// for the same reason: the API must still boot and every core flow (booking,
// claiming) must still work when Twilio isn't configured yet. sendSms() NEVER
// throws — a texting outage must not be able to fail a booking or a claim.

let twilioClient = null;
let twilioResolved = false;

function client() {
  if (twilioResolved) return twilioClient;
  twilioResolved = true;
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) return null;
  try {
    twilioClient = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  } catch (err) {
    console.error('twilio init failed:', err.message);
    twilioClient = null;
  }
  return twilioClient;
}

function isConfigured() {
  return !!client();
}

// US-centric E.164 normalization. Riders enter 10 digits on the kiosk keypad,
// stored formatted like "(555) 010-1234"; Twilio requires E.164 (+15550101234).
function toE164(phone) {
  if (!phone) return null;
  const raw = String(phone).trim();
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+') && digits.length >= 11) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null; // can't safely normalize — caller skips sending rather than guess
}

function baseUrl() {
  return (process.env.PUBLIC_BASE_URL || 'https://roverzooma.vercel.app').replace(/\/+$/, '');
}

// The tracking deep-link the rider opens on their own phone. Keyed by the
// short reference code (not the phone number) — safe to put in a URL.
function trackingUrl(reference) {
  return `${baseUrl()}/?track=${encodeURIComponent(reference)}`;
}

// Core send. Always resolves; the result object says what happened so callers
// (and logs) can tell "texted" from "not configured" without a try/catch.
async function sendSms(to, body) {
  const c = client();
  if (!c) {
    console.log(`[sms:skipped-unconfigured] would text ${to}: ${body}`);
    return { sent: false, reason: 'not_configured' };
  }
  const e164 = toE164(to);
  if (!e164) {
    console.warn(`[sms:skipped-bad-number] ${to}`);
    return { sent: false, reason: 'bad_number' };
  }
  try {
    const msg = await c.messages.create({ to: e164, from: process.env.TWILIO_FROM_NUMBER, body });
    return { sent: true, sid: msg.sid };
  } catch (err) {
    console.error('sms send failed:', err.message);
    return { sent: false, reason: 'send_failed', error: err.message };
  }
}

function formatWhen(iso) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

// --- The two rider-journey messages ----------------------------------------
// 1. Sent right after a booking is created.
async function sendBookingConfirmation(booking) {
  if (!booking?.rider_phone) return { sent: false, reason: 'no_phone' };
  const when = formatWhen(booking.scheduled_at);
  const body =
    `RoverZoom: Your ride is booked${when ? ` for ${when}` : ''}. ` +
    `Confirmation ${booking.reference}. ` +
    `We'll text a live tracking link the moment a driver accepts.`;
  return sendSms(booking.rider_phone, body);
}

// 2. Sent the instant a driver claims the ride — carries the tracking link.
async function sendDriverAcceptedNotification(booking, driver) {
  if (!booking?.rider_phone) return { sent: false, reason: 'no_phone' };
  const first = driver?.name ? String(driver.name).split(' ')[0] : 'A driver';
  const vehicle = driver && (driver.vehicle_color || driver.vehicle_make)
    ? ` (${[driver.vehicle_color, driver.vehicle_make, driver.vehicle_model].filter(Boolean).join(' ')})`
    : '';
  const body =
    `RoverZoom: ${first}${vehicle} accepted your ride! ` +
    `Track them live: ${trackingUrl(booking.reference)}`;
  return sendSms(booking.rider_phone, body);
}

module.exports = {
  sendSms,
  sendBookingConfirmation,
  sendDriverAcceptedNotification,
  trackingUrl,
  toE164,
  isConfigured,
};
