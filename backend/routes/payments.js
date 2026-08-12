const express = require('express');
const supabase = require('../db/supabase');
const { stripe } = require('../services/stripe');

const router = express.Router();

// GET /api/payments/config — what the frontend needs to offer card payment.
// The publishable key is public by design. Card is only offered when Stripe
// is wired; otherwise the rider just pays cash.
router.get('/config', (req, res) => {
  res.json({
    cardEnabled: !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PUBLISHABLE_KEY),
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
  });
});

// POST /api/payments/create-intent — { bookingId } -> { clientSecret }
// The amount always comes from the booking row the server wrote, never the
// client. An idempotency key keyed to the booking means a retry reuses the same
// PaymentIntent instead of creating a duplicate — and we key the webhook off
// the intent's metadata.booking_id, so no extra DB column is needed.
router.post('/create-intent', async (req, res) => {
  const s = stripe();
  if (!s) return res.status(503).json({ error: 'Card payments are not configured yet.' });

  const { bookingId } = req.body || {};
  if (!bookingId) return res.status(400).json({ error: 'bookingId is required.' });

  try {
    const { data: booking, error } = await supabase
      .from('bookings')
      .select('id, reference, fare, payment_method, payment_status, rider_email')
      .eq('id', bookingId)
      .maybeSingle();
    if (error) throw error;
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.payment_method !== 'card') {
      return res.status(400).json({ error: 'This booking is not set to card payment.' });
    }
    if (booking.payment_status === 'paid') {
      return res.status(409).json({ error: 'This booking is already paid.' });
    }

    const intent = await s.paymentIntents.create({
      amount: Math.round(Number(booking.fare) * 100),
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      description: `RoverZoom ride ${booking.reference}`,
      receipt_email: booking.rider_email || undefined,
      metadata: { booking_id: booking.id, reference: booking.reference },
    }, { idempotencyKey: `pi_${booking.id}` });

    res.json({ clientSecret: intent.client_secret });
  } catch (err) {
    console.error('create-intent error', err.message);
    res.status(500).json({ error: 'Could not start card payment.' });
  }
});

// POST /api/payments/webhook — Stripe is the source of truth for "paid".
// Mounted with express.raw() in server.js (signature verification needs the
// untouched body). Flips the booking's payment_status by the intent metadata.
router.post('/webhook', async (req, res) => {
  const s = stripe();
  if (!s) return res.status(503).end();

  let event;
  try {
    event = s.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('stripe webhook signature verification failed', err.message);
    return res.status(400).json({ error: 'Invalid signature.' });
  }

  try {
    if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object;
      const bookingId = intent.metadata && intent.metadata.booking_id;
      const status = event.type === 'payment_intent.succeeded' ? 'paid' : 'failed';
      if (bookingId) {
        const { error } = await supabase.from('bookings').update({ payment_status: status }).eq('id', bookingId);
        if (error) throw error;
      }
    }
    res.json({ received: true });
  } catch (err) {
    // Non-2xx makes Stripe retry — what we want if the DB write failed.
    console.error('stripe webhook handling error', err.message);
    res.status(500).json({ error: 'Webhook handling failed.' });
  }
});

module.exports = router;
