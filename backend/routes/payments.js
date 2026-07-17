const express = require('express');
const supabase = require('../db/supabase');

const router = express.Router();

// Lazy Stripe init so the whole API still boots (cash/Zelle keep working)
// when STRIPE_SECRET_KEY isn't configured yet.
let stripeClient = null;
function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!stripeClient) stripeClient = require('stripe')(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}

// GET /api/payments/config — everything the frontend needs to offer payment
// methods. The publishable key is public by design; the Zelle recipient is
// what riders need to send to. Card is only offered when Stripe is wired.
router.get('/config', (req, res) => {
  res.json({
    cardEnabled: !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PUBLISHABLE_KEY),
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
    zelle: process.env.ZELLE_RECIPIENT
      ? { recipient: process.env.ZELLE_RECIPIENT, name: process.env.ZELLE_RECIPIENT_NAME || 'RoverZoom' }
      : null,
  });
});

// POST /api/payments/create-intent — { bookingId } -> { clientSecret }
// Creates (or reuses) the PaymentIntent for a pending card booking. Amount
// always comes from the booking row the server wrote — never from the client.
router.post('/create-intent', async (req, res) => {
  const s = stripe();
  if (!s) return res.status(503).json({ error: 'Card payments are not configured yet.' });

  const { bookingId } = req.body || {};
  if (!bookingId) return res.status(400).json({ error: 'bookingId is required.' });

  try {
    const { data: booking, error } = await supabase
      .from('bookings')
      .select('id, reference, fare, payment_method, payment_status, stripe_payment_intent_id, rider_email')
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

    // Reuse an existing intent (e.g. rider retried after a declined card) so
    // we never double-charge; Stripe intents are retryable by design.
    if (booking.stripe_payment_intent_id) {
      const existing = await s.paymentIntents.retrieve(booking.stripe_payment_intent_id);
      if (existing && existing.status !== 'canceled') {
        return res.json({ clientSecret: existing.client_secret });
      }
    }

    const intent = await s.paymentIntents.create({
      amount: Math.round(Number(booking.fare) * 100),
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      description: `RoverZoom ride ${booking.reference}`,
      receipt_email: booking.rider_email || undefined,
      metadata: { booking_id: booking.id, reference: booking.reference },
    });

    const { error: saveErr } = await supabase
      .from('bookings')
      .update({ stripe_payment_intent_id: intent.id })
      .eq('id', booking.id);
    if (saveErr) throw saveErr;

    res.json({ clientSecret: intent.client_secret });
  } catch (err) {
    console.error('create-intent error', err.message);
    res.status(500).json({ error: 'Could not start card payment.' });
  }
});

// POST /api/payments/webhook — Stripe is the source of truth for "paid".
// Mounted with express.raw() in server.js (signature verification requires
// the untouched request body). The client-side confirmPayment success is
// treated as optimistic UI only; this is what actually flips the row.
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
    console.error('webhook signature verification failed', err.message);
    return res.status(400).json({ error: 'Invalid signature.' });
  }

  try {
    if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object;
      const status = event.type === 'payment_intent.succeeded' ? 'paid' : 'failed';
      const { error } = await supabase
        .from('bookings')
        .update({ payment_status: status })
        .eq('stripe_payment_intent_id', intent.id);
      if (error) throw error;
    }
    res.json({ received: true });
  } catch (err) {
    // Non-2xx makes Stripe retry — exactly what we want if the DB write failed.
    console.error('webhook handling error', err.message);
    res.status(500).json({ error: 'Webhook handling failed.' });
  }
});

module.exports = router;
