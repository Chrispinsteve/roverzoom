// SMS notifications via Twilio. Two touch-points in the rider journey:
//   1. booking created  -> "your ride is scheduled" confirmation
//   2. a driver accepts  -> "your driver is coming" + a LIVE TRACKING LINK
//
// The tracking text carries the deep link that opens live tracking on the
// rider's OWN phone (they may have booked on a shared tablet). It uses the
// booking's unguessable `track_token` and the new /track/<token> route.
//
// Lazy-initialized like the Stripe client: the API must still boot and every
// core flow (booking, claiming) must still work when Twilio isn't configured.
// sendSms() NEVER throws — a texting outage must not fail a booking or a claim.

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

// US-centric E.164 normalization. Riders enter 10 digits; Twilio needs E.164.
function toE164(phone) {
  if (!phone) return null;
  const raw = String(phone).trim();
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+') && digits.length >= 11) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}

function baseUrl() {
  return (process.env.PUBLIC_APP_URL || process.env.PUBLIC_BASE_URL || 'https://www.roverzoom.com').replace(/\/+$/, '');
}

// The private live-tracking deep-link, keyed by the booking's unguessable
// track_token (128-bit) on the /track/<token> route.
function trackingUrl(token) {
  return `${baseUrl()}/track/${encodeURIComponent(token)}`;
}

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
  const link = booking.track_token ? ` Track them live: ${trackingUrl(booking.track_token)}` : '';
  const body = `RoverZoom: ${first}${vehicle} accepted your ride!${link}`;
  return sendSms(booking.rider_phone, body);
}

// 3. Sent when the driver marks "arrived" — the moment the rider most
// wants a nudge, since they may have put the phone down after booking.
async function sendArrivalNotification(booking) {
  if (!booking?.rider_phone) return { sent: false, reason: 'no_phone' };
  const link = booking.track_token ? ` ${trackingUrl(booking.track_token)}` : '';
  const body = `RoverZoom: Your driver has arrived at the pickup. Head out when you're ready.${link}`;
  return sendSms(booking.rider_phone, body);
}

module.exports = {
  sendSms,
  sendBookingConfirmation,
  sendDriverAcceptedNotification,
  sendArrivalNotification,
  trackingUrl,
  toE164,
  isConfigured,
};
