const express = require('express');
const supabase = require('../db/supabase');
const { requireDriver, requireActiveDriver } = require('../middleware/requireDriver');

const router = express.Router();

const AVAILABLE_WINDOW_DAYS = 7;

// GET /api/driver/schedule — this driver's own upcoming + recent bookings.
// requireDriver only: a pending/suspended driver can see their own (likely
// empty) schedule — harmless, no need to also gate on active.
router.get('/schedule', requireDriver, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('driver_id', req.driver.id)
      .order('scheduled_at', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('driver schedule fetch error', err.message);
    res.status(500).json({ error: 'Could not fetch schedule.' });
  }
});

// GET /api/driver/available-trips — unclaimed upcoming bookings, browsable window.
// requireActiveDriver: a pending/suspended driver shouldn't be able to browse.
router.get('/available-trips', requireDriver, requireActiveDriver, async (req, res) => {
  try {
    const now = new Date().toISOString();
    const windowEnd = new Date(Date.now() + AVAILABLE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .is('driver_id', null)
      .in('status', ['confirmed', 'dispatching'])
      .gte('scheduled_at', now)
      .lte('scheduled_at', windowEnd)
      .order('scheduled_at', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('available trips fetch error', err.message);
    res.status(500).json({ error: 'Could not fetch available trips.' });
  }
});

// POST /api/driver/bookings/:bookingId/claim — instant guarded assignment, no offer/countdown.
// requireActiveDriver: a pending/suspended driver shouldn't be able to claim.
router.post('/bookings/:bookingId/claim', requireDriver, requireActiveDriver, async (req, res) => {
  const { bookingId } = req.params;

  try {
    const { data, error } = await supabase
      .from('bookings')
      .update({ driver_id: req.driver.id, status: 'driver_assigned', accepted_at: new Date().toISOString() })
      .eq('id', bookingId)
      .is('driver_id', null)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({ error: 'This trip was already claimed by another driver.' });
    res.json(data);
  } catch (err) {
    console.error('claim booking error', err.message);
    res.status(500).json({ error: 'Could not claim trip.' });
  }
});

module.exports = router;
