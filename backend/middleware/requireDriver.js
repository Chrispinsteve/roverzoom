const supabase = require('../db/supabase');

// Verifies the bearer token against Supabase Auth and resolves the matching
// driver row, attaching it as req.driver. getUser(token) (not local
// JWT-signature verification) is deliberate: requireActiveDriver needs a live
// read of drivers.status from Postgres on every request regardless (status
// isn't and shouldn't be a JWT claim), so this architecture already pays one
// DB round-trip per authenticated request — getUser() just adds a second,
// smaller call to Supabase's Auth API, and it catches revocation/banning
// that a pure local signature check can't.
async function requireDriver(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token.' });

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Invalid or expired session.' });

    const { data: driver, error: driverErr } = await supabase
      .from('drivers')
      .select('*')
      .eq('auth_user_id', data.user.id)
      .maybeSingle();
    if (driverErr) throw driverErr;
    if (!driver) return res.status(403).json({ error: 'No driver profile found for this account.' });

    req.driver = driver;
    next();
  } catch (err) {
    console.error('requireDriver error', err.message);
    res.status(500).json({ error: 'Could not verify driver.' });
  }
}

// A pending/suspended driver can still read their own profile/schedule
// (requireDriver alone), but nothing that acts on their behalf — browsing
// or claiming trips, going online, etc.
function requireActiveDriver(req, res, next) {
  if (req.driver.status !== 'active') {
    return res.status(403).json({
      error: 'Your driver account is not yet active.',
      code: 'driver_not_active',
      driverStatus: req.driver.status,
    });
  }
  next();
}

// Gates ride-request access on profile completion (photo + license +
// insurance all uploaded) — the "open marketplace, but controlled" model:
// there's no online/offline toggle, so this is the one real access control
// on who can see/claim rides.
function requireCompleteProfile(req, res, next) {
  if (!req.driver.profile_completed_at) {
    return res.status(403).json({
      error: 'Complete your profile (photo, license, insurance) to see ride requests.',
      code: 'profile_incomplete',
    });
  }
  next();
}

module.exports = { requireDriver, requireActiveDriver, requireCompleteProfile };
