const express = require('express');
const supabase = require('../db/supabase');

const router = express.Router();

const AVAILABLE_WINDOW_DAYS = 7;

// GET /api/driver/schedule?driverId= — this driver's own upcoming + recent bookings
router.get('/schedule', async (req, res) => {
  const { driverId } = req.query;
  if (!driverId) return res.status(400).json({ error: 'driverId is required.' });

  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('driver_id', driverId)
      .order('scheduled_at', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('driver schedule fetch error', err.message);
    res.status(500).json({ error: 'Could not fetch schedule.' });
  }
});

// GET /api/driver/available-trips?driverId= — unclaimed upcoming bookings, browsable window
router.get('/available-trips', async (req, res) => {
  const { driverId } = req.query;
  if (!driverId) return res.status(400).json({ error: 'driverId is required.' });

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

// POST /api/driver/bookings/:bookingId/claim — instant guarded assignment, no offer/countdown
router.post('/bookings/:bookingId/claim', async (req, res) => {
  const { bookingId } = req.params;
  const { driverId } = req.body || {};
  if (!driverId) return res.status(400).json({ error: 'driverId is required.' });

  try {
    const { data, error } = await supabase
      .from('bookings')
      .update({ driver_id: driverId, status: 'driver_assigned', accepted_at: new Date().toISOString() })
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
