// Driver background-screening state, stored in the driver's Supabase Auth
// app_metadata (server-controlled, not user-editable) — the same place the
// Stripe Connect pointer lives, since this environment can't run DDL to add a
// drivers column. Statuses: not_started | pending | clear | consider.
const supabase = require('../db/supabase');

async function getScreening(driver) {
  if (!driver.auth_user_id) return { status: 'not_started' };
  const { data, error } = await supabase.auth.admin.getUserById(driver.auth_user_id);
  if (error) throw error;
  const m = (data && data.user && data.user.app_metadata) || {};
  return {
    candidateId: m.checkr_candidate_id || null,
    reportId: m.checkr_report_id || null,
    status: m.screening_status || 'not_started',
    invitationUrl: m.checkr_invitation_url || null,
  };
}

const FIELD_TO_META = {
  candidateId: 'checkr_candidate_id',
  reportId: 'checkr_report_id',
  status: 'screening_status',
  invitationUrl: 'checkr_invitation_url',
};

async function setScreening(authUserId, fields) {
  const { data, error: getErr } = await supabase.auth.admin.getUserById(authUserId);
  if (getErr) throw getErr;
  const app_metadata = { ...((data && data.user && data.user.app_metadata) || {}) };
  for (const [key, col] of Object.entries(FIELD_TO_META)) {
    if (key in fields) app_metadata[col] = fields[key];
  }
  const { error } = await supabase.auth.admin.updateUserById(authUserId, { app_metadata });
  if (error) throw error;
}

async function findDriverById(driverId) {
  const { data } = await supabase.from('drivers').select('*').eq('id', driverId).maybeSingle();
  return data || null;
}

// A cleared background check activates a still-pending driver.
async function activateIfPending(driver) {
  if (driver.status === 'pending_verification') {
    await supabase.from('drivers').update({ status: 'active' }).eq('id', driver.id);
  }
}

module.exports = { getScreening, setScreening, findDriverById, activateIfPending };
