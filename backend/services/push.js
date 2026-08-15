// Web Push (VAPID) sender. Lazy/dormant exactly like the Stripe and Twilio
// clients: if VAPID keys aren't set the API still boots and everything else
// works — push just reports not-configured and callers fall back to SMS.

let ready = false;
let webpush = null;

function ensure() {
  if (ready) return webpush;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return null;
  try {
    webpush = require('web-push');
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:support@roverzoom.com',
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
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
function publicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
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
