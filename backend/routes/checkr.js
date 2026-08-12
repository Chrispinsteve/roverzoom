const express = require('express');
const checkr = require('../services/checkr');
const { setScreening, findDriverById, activateIfPending } = require('../services/screening');

const router = express.Router();

// POST /api/checkr/webhook — Checkr calls this when a report finishes. Mounted
// with express.raw() in server.js so the signature can be verified over the raw
// body. A cleared report activates a pending driver; a "consider" result is left
// pending for a human to review.
router.post('/webhook', async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
  if (!checkr.verifyWebhook(raw, req.headers['x-checkr-signature'])) {
    return res.status(400).json({ error: 'bad signature' });
  }
  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'bad json' }); }

  // Ack immediately so Checkr doesn't retry while we process.
  res.json({ received: true });

  try {
    if (!/^report\.(completed|upgraded|resumed)$/.test(event.type || '')) return;
    const report = event.data && event.data.object;
    if (!report || !report.candidate_id) return;

    // Map report → candidate → our driver via the candidate's custom_id.
    const candidate = await checkr.getCandidate(report.candidate_id);
    const driverId = candidate && candidate.custom_id;
    if (!driverId) return;
    const driver = await findDriverById(driverId);
    if (!driver || !driver.auth_user_id) return;

    const clear = report.status === 'clear';
    await setScreening(driver.auth_user_id, { status: clear ? 'clear' : 'consider', reportId: report.id });
    if (clear) await activateIfPending(driver);
  } catch (err) {
    console.error('checkr webhook processing error', err.message);
  }
});

module.exports = router;
