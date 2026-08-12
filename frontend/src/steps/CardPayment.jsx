import { useEffect, useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import Shell from '../components/Shell';
import Icon from '../components/Icon';
import { api } from '../lib/api';

// The actual card form. Rendered inside <Elements> so the Stripe hooks work.
// confirmPayment with redirect:'if_required' keeps the rider in-app for the
// common card case (only redirect-based methods like some wallets navigate away).
function PayForm({ amount, onPaid, onSkip }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pay = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    setError('');
    const { error: err, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });
    if (err) {
      setError(err.message || 'Payment could not be completed.');
      setBusy(false);
      return;
    }
    if (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing')) {
      onPaid();
      return;
    }
    // Any other terminal state — surface it rather than silently continuing.
    setError('Payment was not completed. Please try another card.');
    setBusy(false);
  };

  return (
    <>
      <PaymentElement options={{ layout: 'tabs' }} />
      <div className="btn-row" style={{ marginTop: 20 }}>
        <button className="btn" disabled={busy || !stripe} onClick={pay}>
          {busy ? 'Processing…' : `Pay $${amount.toFixed(2)}`}
        </button>
      </div>
      {error && <p className="error-text" style={{ marginTop: 10 }}>{error}</p>}
      <button
        style={{
          marginTop: 14, display: 'block', width: '100%', textAlign: 'center',
          background: 'none', border: 'none', color: 'var(--ink-3)', fontSize: 14,
          fontWeight: 500, textDecoration: 'underline', cursor: busy ? 'default' : 'pointer',
        }}
        onClick={onSkip}
        disabled={busy}
      >
        Pay after the ride instead
      </button>
    </>
  );
}

// Sits between "booking created (card)" and the confirmation screen. When
// Stripe isn't configured server-side — or the intent can't be set up — it
// quietly calls onDone() so the flow behaves exactly like the old cash/stub
// path and the rider still reaches their confirmation.
export default function CardPayment({ booking, onDone }) {
  const [pk, setPk] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await api.paymentsConfig();
        if (!cfg.cardEnabled || !cfg.publishableKey) {
          if (!cancelled) onDone();
          return;
        }
        const { clientSecret: cs } = await api.createPaymentIntent(booking.id);
        if (!cs) {
          if (!cancelled) onDone();
          return;
        }
        if (!cancelled) {
          setPk(cfg.publishableKey);
          setClientSecret(cs);
        }
      } catch {
        // Couldn't reach payments / set up the intent — don't trap the rider.
        if (!cancelled) onDone();
      }
    })();
    return () => { cancelled = true; };
  }, [booking, onDone]);

  const stripePromise = useMemo(() => (pk ? loadStripe(pk) : null), [pk]);

  if (!clientSecret || !stripePromise) {
    return (
      <Shell step={0} totalSteps={0}>
        <div className="body">
          <p className="muted" style={{ textAlign: 'center', marginTop: 80 }}>
            Preparing secure payment…
          </p>
        </div>
      </Shell>
    );
  }

  const amount = Number(booking.fare) || 0;

  return (
    <Shell step={0} totalSteps={0}>
      <div className="body">
        <h1 className="title">Pay by card</h1>
        <p className="subtitle" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Icon name="shieldCheck" size={15} color="var(--ink-3)" />
          Secured by Stripe · Confirmation {booking.reference}
        </p>
        <Elements
          stripe={stripePromise}
          options={{ clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: '#111111' } } }}
        >
          <PayForm amount={amount} onPaid={onDone} onSkip={onDone} />
        </Elements>
      </div>
    </Shell>
  );
}
