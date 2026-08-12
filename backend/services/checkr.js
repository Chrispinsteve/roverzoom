// Checkr background checks (criminal + motor-vehicle report) for drivers.
//
// Uses Checkr's HOSTED invitation flow: the driver enters their SSN / DOB /
// license directly on Checkr's secure page, so that sensitive data never touches
// our servers — we keep only a candidate id + report status. Gated on
// CHECKR_API_KEY: when unset the whole feature is dormant and the existing
// manual admin-approval flow stays in effect (same lazy pattern as Stripe/Twilio).
//
// One-time operator setup: create a Checkr account and complete their FCRA
// credentialing/approval, then set in the environment:
//   CHECKR_API_KEY        live secret key
//   CHECKR_PACKAGE        a package slug that includes a criminal search +
//                         motor_vehicle_report (created in the Checkr dashboard)
//   CHECKR_WORK_STATE     driver work state, e.g. FL
//   CHECKR_WEBHOOK_SECRET (optional) to verify webhook signatures
// and point a Checkr webhook at  <your-domain>/api/checkr/webhook .
const crypto = require('crypto');

const API = 'https://api.checkr.com/v1';

function apiKey() { return process.env.CHECKR_API_KEY || ''; }
function isConfigured() { return !!apiKey(); }

// Checkr uses HTTP Basic auth: the API key as the username, empty password.
function authHeader() {
  return 'Basic ' + Buffer.from(`${apiKey()}:`).toString('base64');
}

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || (Array.isArray(data.errors) && data.errors.join(', ')) || `Checkr ${res.status}`;
    const e = new Error(msg); e.status = res.status; throw e;
  }
  return data;
}

// Create a Checkr candidate. custom_id = our driver id, so a completed report's
// webhook can be mapped back to the driver (their app_metadata isn't queryable).
async function createCandidate({ email, firstName, lastName, driverId }) {
  const form = new URLSearchParams();
  if (email) form.append('email', email);
  if (firstName) form.append('first_name', firstName);
  if (lastName) form.append('last_name', lastName);
  if (driverId) form.append('custom_id', driverId);
  return call('/candidates', { method: 'POST', body: form.toString() });
}

// Hosted invitation — returns { invitation_url } the driver completes on Checkr.
async function createInvitation({ candidateId, pkg, state }) {
  const form = new URLSearchParams();
  form.append('candidate_id', candidateId);
  form.append('package', pkg);
  form.append('work_locations[][country]', 'US');
  form.append('work_locations[][state]', state || 'FL');
  return call('/invitations', { method: 'POST', body: form.toString() });
}

async function getCandidate(id) { return call(`/candidates/${id}`); }
async function getReport(id) { return call(`/reports/${id}`); }

// Optional webhook signature check: Checkr signs the raw body (HMAC-SHA256) with
// the webhook secret in the X-Checkr-Signature header. No secret configured →
// accept (configure it in production).
function verifyWebhook(rawBody, signature) {
  const secret = process.env.CHECKR_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature))); }
  catch { return false; }
}

module.exports = { isConfigured, createCandidate, createInvitation, getCandidate, getReport, verifyWebhook };
