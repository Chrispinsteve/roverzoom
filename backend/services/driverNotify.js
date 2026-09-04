// Fan out a "new ride request" to drivers who can claim it. Push-first: a
// driver who enabled notifications gets a free Web Push; a driver without a
// push subscription gets an SMS instead (covers uninstalled iPhones, which
// Apple does not allow to receive web push). SMS is throttled per driver so a
// burst of bookings can't spam anyone.
//
// Entirely best-effort — this is called fire-and-forget from booking creation
// and must never affect whether the booking itself succeeds.

const supabase = require('../db/supabase');
const push = require('./push');
const { sendSms } = require('./sms');
const { briefAddress } = require('./address');

const SMS_THROTTLE_MS = Number(process.env.NOTIFY_SMS_THROTTLE_MS) || 3 * 60 * 1000;
// Per-driver last-SMS timestamps. In-memory and per serverless instance, so
// this is a soft cap, not a hard guarantee — good enough to stop obvious spam.
const lastSmsAt = new Map();

// Deep link into the driver app. `tab` decides where it opens: a ride-request
// alert that dumps the driver on the dashboard makes them hunt for the thing
// they were just told about, while every other driver who got the same alert is
// racing them to claim it.
function appUrl(tab = '1') {
  const base = (process.env.PUBLIC_APP_URL || process.env.PUBLIC_BASE_URL || 'https://www.roverzoom.com').replace(/\/+$/, '');
  return `${base}/?driver=${tab}`;
}

async function notifyDriversOfNewRequest(booking) {
  if (!booking) return;
  try {
    // Eligible = active drivers (the pool that can claim in the open marketplace).
    const { data: drivers, error } = await supabase
      .from('drivers')
      .select('id, phone, sms_consent_at')
      .eq('status', 'active');
    if (error || !drivers || drivers.length === 0) return;

    const ids = drivers.map((d) => d.id);
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('id, driver_id, endpoint, p256dh, auth')
      .in('driver_id', ids);

    const byDriver = new Map();
    for (const s of subs || []) {
      if (!byDriver.has(s.driver_id)) byDriver.set(s.driver_id, []);
      byDriver.get(s.driver_id).push(s);
    }

    const area = briefAddress(booking.pickup_address) || 'a nearby location';
    const fare = booking.fare != null ? `$${Number(booking.fare).toFixed(2)}` : '';
    const payload = {
      title: 'New ride request',
      body: `${area}${fare ? ' · ' + fare : ''} — tap to view`,
      url: appUrl('requests'),
      tag: 'ride-request',
    };

    const now = Date.now();
    for (const d of drivers) {
      const driverSubs = byDriver.get(d.id) || [];

      if (driverSubs.length > 0) {
        for (const s of driverSubs) {
          const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
          const r = await push.sendPush(sub, payload);
          // Prune dead subscriptions so we stop trying them.
          if (r.expired) {
            await supabase.from('push_subscriptions').delete().eq('id', s.id).then(() => {}, () => {});
          }
        }
        continue;
      }

      // No push subscription: SMS fallback, throttled per driver, and only
      // for drivers who opted in. The A2P campaign covers these messages, so
      // a driver is a recipient like a rider is and needs the same
      // demonstrable consent. NULL means no.
      if (d.phone && d.sms_consent_at) {
        const last = lastSmsAt.get(d.id) || 0;
        if (now - last >= SMS_THROTTLE_MS) {
          lastSmsAt.set(d.id, now);
          sendSms(d.phone, `RoverZoom: New ride request (${area}). Open to claim: ${appUrl('requests')} Reply STOP to opt out.`)
            .catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error('notifyDriversOfNewRequest failed (non-fatal):', err.message);
  }
}

// Tell the ASSIGNED driver their claimed ride was canceled by the rider. Push
// where they have it, SMS otherwise. Best-effort — never affects the cancel.
async function notifyDriverOfCancellation(booking) {
  if (!booking || !booking.driver_id) return; // nobody was assigned yet
  try {
    const { data: driver } = await supabase
      .from('drivers')
      .select('id, phone, sms_consent_at')
      .eq('id', booking.driver_id)
      .maybeSingle();
    if (!driver) return;

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('driver_id', driver.id);

    const area = briefAddress(booking.pickup_address) || 'your pickup';
    const payload = {
      title: 'Ride canceled',
      body: `The rider canceled the ${area} ride. It’s off your schedule.`,
      url: appUrl('schedule'),
      tag: `cancel-${booking.id}`,
    };

    if (subs && subs.length > 0) {
      for (const s of subs) {
        const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
        const r = await push.sendPush(sub, payload);
        if (r.expired) await supabase.from('push_subscriptions').delete().eq('id', s.id).then(() => {}, () => {});
      }
    } else if (driver.phone) {
      driver.sms_consent_at
        ? sendSms(driver.phone, `RoverZoom: The rider canceled the ${area} ride you had. It's been removed from your schedule.`)
        : Promise.resolve({ sent: false, reason: 'no_consent' })
        .catch(() => {});
    }
  } catch (err) {
    console.error('notifyDriverOfCancellation failed (non-fatal):', err.message);
  }
}

module.exports = { notifyDriversOfNewRequest, notifyDriverOfCancellation };
