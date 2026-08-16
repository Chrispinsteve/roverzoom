// Web Push (VAPID) sender. Lazy/dormant exactly like the Stripe and Twilio
// clients: if VAPID keys aren't set the API still boots and everything else
// works — push just reports not-configured and callers fall back to SMS.

let ready = false;
let webpush = null;

function ensure() {
  if (ready) return webpush;
  // Trim: env values pasted into a dashboard often carry a trailing newline or
  // space, which silently corrupts the key and makes the browser reject it with
  // "push service error".
  const pub = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const priv = (process.env.VAPID_PRIVATE_KEY || '').trim();
  if (!pub || !priv) return null;
  try {
    webpush = require('web-push');
    webpush.setVapidDetails(
      (process.env.VAPID_SUBJECT || 'mailto:support@roverzoom.com').trim(),
      pub,
      priv
    );
    ready = true;
  } catch (err) {
    console.error('web-push init failed:', err.message);
    webpush = null;
  }
  return webpush;
}

function isConfigured() {
  return !!ensure();
}

// The public key the browser needs to create a subscription. Safe to expose.
// Trimmed so a stray newline in the env var can't corrupt the applicationServerKey.
function publicKey() {
  const k = (process.env.VAPID_PUBLIC_KEY || '').trim();
  return k || null;
}

// Sends one notification. Returns { sent } or { sent:false, expired } — an
// `expired` result (HTTP 404/410) means the subscription is dead and the
// caller should delete it from the DB so we stop trying.
async function sendPush(subscription, payload) {
  const wp = ensure();
  if (!wp) return { sent: false, reason: 'not_configured' };
  try {
    await wp.sendNotification(subscription, JSON.stringify(payload));
    return { sent: true };
  } catch (err) {
    const code = err.statusCode;
    if (code === 404 || code === 410) return { sent: false, expired: true };
    console.error('push send failed:', code || '', err.message);
    return { sent: false, reason: 'send_failed' };
  }
}

module.exports = { isConfigured, publicKey, sendPush };
