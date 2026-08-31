#!/usr/bin/env node
//
// Twilio preflight.
//
// sendSms() never throws — a texting outage must not be able to fail a booking
// or a claim. The cost of that choice is that a broken Twilio setup is SILENT:
// riders simply never get their confirmation or their tracking link, and
// nothing surfaces. This script is the counterweight. Run it after configuring
// Twilio, and any time texts stop arriving.
//
//   node backend/scripts/twilio-check.js
//   node backend/scripts/twilio-check.js +15615550123   # also send a real test
//
// The optional number sends ONE real message and costs a fraction of a cent.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { toE164 } = require('../services/sms');

const ok = (m) => console.log('  \x1b[32m✓\x1b[0m ' + m);
const bad = (m) => console.log('  \x1b[31m✗\x1b[0m ' + m);
const warn = (m) => console.log('  \x1b[33m!\x1b[0m ' + m);
const info = (m) => console.log('    ' + m);

(async () => {
  // Delivery lookup for a message already sent. "queued" only means Twilio
  // accepted it; carrier filtering shows up minutes later as "undelivered".
  if (process.argv[2] === '--status') {
    const target = process.argv[3];
    if (!target) { console.error('\nUsage: twilio-check.js --status <message SID>\n'); process.exit(1); }
    const c = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const m = await c.messages(target).fetch();
    console.log(`\n  status: ${m.status}`);
    if (m.errorCode) {
      console.log(`  error : ${m.errorCode} — ${m.errorMessage || ''}`);
      if (String(m.errorCode) === '30034') {
        console.log('  cause : the sending number is not registered for A2P 10DLC.');
      }
    }
    console.log('');
    return;
  }

  console.log('\nTwilio preflight\n');

  // --- 1. Credentials present -------------------------------------------
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM_NUMBER: from } = process.env;

  let fatal = false;
  for (const [name, value] of [
    ['TWILIO_ACCOUNT_SID', sid], ['TWILIO_AUTH_TOKEN', token], ['TWILIO_FROM_NUMBER', from],
  ]) {
    if (value) ok(`${name} is set`);
    else { bad(`${name} is NOT set`); fatal = true; }
  }
  if (fatal) {
    info('\n    Without all three, sendSms() returns { sent:false, reason:"not_configured" }');
    info('    and logs what it WOULD have sent. No text is ever attempted.\n');
    process.exit(1);
  }
  if (!/^AC[0-9a-f]{32}$/i.test(sid)) {
    warn('TWILIO_ACCOUNT_SID does not look like an Account SID (expected AC + 32 hex).');
    info('An API Key SID starts with SK and will not work here.');
  }

  const client = require('twilio')(sid, token);

  // --- 2. Credentials actually work -------------------------------------
  let account;
  try {
    account = await client.api.v2010.accounts(sid).fetch();
    ok(`Authenticated as "${account.friendlyName}" (${account.status})`);
    if (account.type === 'Trial') {
      warn('This is a TRIAL account.');
      info('Trial accounts can only text numbers you have verified in the console,');
      info('and every message is prefixed with a trial notice. Upgrade before launch.');
    }
  } catch (err) {
    bad(`Could not authenticate: ${err.message}`);
    info('Check the Account SID and Auth Token are from the same account, and');
    info('that the token has not been rotated.');
    process.exit(1);
  }

  // --- 3. The sending number ---------------------------------------------
  const fromE164 = toE164(from) || from;
  if (fromE164 !== from) warn(`TWILIO_FROM_NUMBER "${from}" normalises to ${fromE164}. Store it in E.164 form.`);

  try {
    const numbers = await client.incomingPhoneNumbers.list({ phoneNumber: fromE164, limit: 1 });
    if (!numbers.length) {
      bad(`${fromE164} is not a number on this account.`);
      info('Buy it under Phone Numbers > Manage > Buy a number, or correct the variable.');
    } else {
      const n = numbers[0];
      ok(`${fromE164} belongs to this account (${n.friendlyName})`);
      if (n.capabilities && n.capabilities.sms === false) {
        bad('That number is NOT SMS-capable. Riders will never receive anything.');
      } else {
        ok('The number is SMS-capable');
      }
    }
  } catch (err) {
    warn(`Could not verify the number: ${err.message}`);
  }

  // --- 4. US registration — the thing that silently blocks everything -----
  // A US 10-digit number sending application traffic MUST be registered for
  // A2P 10DLC. Unregistered traffic is filtered by the carriers, not by
  // Twilio: the API returns success and the message never arrives.
  try {
    const isUS10DLC = /^\+1\d{10}$/.test(fromE164) && !/^\+18(00|33|44|55|66|77|88)/.test(fromE164);
    const isTollFree = /^\+18(00|33|44|55|66|77|88)/.test(fromE164);

    if (isTollFree) {
      info('');
      warn('This is a TOLL-FREE number. It needs Toll-Free Verification, not 10DLC.');
      info('Unverified toll-free traffic is heavily filtered. Submit under');
      info('Messaging > Compliance > Toll-Free Verification.');
    } else if (isUS10DLC) {
      const brands = await client.messaging.v1.brandRegistrations.list({ limit: 5 }).catch(() => []);
      if (!brands.length) {
        info('');
        bad('No A2P 10DLC brand is registered on this account.');
        info('This is the single most common reason texts vanish. US carriers');
        info('FILTER unregistered application traffic — the API reports success');
        info('and the message is never delivered.');
        info('Register under Messaging > Regulatory Compliance > A2P 10DLC.');
        info('Brands approve in minutes; campaigns take several days.');
      } else {
        const approved = brands.filter((b) => b.status === 'APPROVED');
        if (approved.length) ok(`A2P 10DLC brand registered (${approved[0].status})`);
        else warn(`A2P 10DLC brand status: ${brands.map((b) => b.status).join(', ')} — not yet approved.`);

        const campaigns = await client.messaging.v1.services.list({ limit: 20 }).catch(() => []);
        if (campaigns.length) ok(`${campaigns.length} messaging service(s) configured`);
        else warn('No messaging service found. A campaign must be attached to one to send.');
      }
    }
  } catch (err) {
    warn(`Could not check A2P registration: ${err.message}`);
  }

  // --- 5. Optional live send ---------------------------------------------
  const target = process.argv[2];
  if (target) {
    const to = toE164(target);
    if (!to) {
      bad(`"${target}" is not a number sendSms() can normalise. It would be skipped as bad_number.`);
      process.exit(1);
    }
    console.log('');
    info(`Sending a real test message to ${to}…`);
    try {
      const msg = await client.messages.create({
        to, from: fromE164,
        body: 'RoverZoom: Twilio is wired up correctly. This is a test.',
      });
      ok(`Accepted by Twilio — SID ${msg.sid}, status "${msg.status}"`);
      info('');
      info('"queued" or "accepted" means Twilio took it, NOT that it arrived.');
      info('Wait a few seconds, then check delivery:');
      info(`  node backend/scripts/twilio-check.js --status ${msg.sid}`);
      info('A status of "undelivered" or "failed" with error 30034 means the');
      info('number is not A2P-registered.');
    } catch (err) {
      bad(`Send failed: ${err.message}`);
      if (err.code) info(`Twilio error code ${err.code} — look it up at twilio.com/docs/api/errors/${err.code}`);
    }
  } else {
    console.log('');
    info('Pass a phone number to send a real test message:');
    info('  node backend/scripts/twilio-check.js +15615550123');
  }

  console.log('');
})().catch((err) => { console.error('\n' + err.message + '\n'); process.exit(1); });
