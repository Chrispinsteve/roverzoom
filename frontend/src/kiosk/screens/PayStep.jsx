import { useEffect, useRef, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import FlowShell from '../components/FlowShell';
import PaymentCards from '../components/PaymentCards';
import { api } from '../../lib/api';
import { combineDayTime } from '../lib/datetime';

// Two-phase step. Phase "choose": pick card / Zelle / cash. Cash and Zelle
// book immediately (money moves outside the app — driver's hand, bank app).
// Card books first (payment_status stays pending), then Stripe's Payment
// Element mounts inline and the rider pays without ever leaving the flow.
// The webhook — not this client — is what finally marks the booking paid.
export default function PayStep({ booking, onChange, onConfirmed, onBack }) {
  const [phase, setPhase] = useState('choose'); // 'choose' | 'card'
  const [submitting, setSubmitting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState(null);
  const [pendingBooking, setPendingBooking] = useState(null); // created, awaiting card payment

  const stripeRef = useRef(null);
  const elementsRef = useRef(null);
  const mountRef = useRef(null);

  useEffect(() => {
    api.getPaymentsConfig().then(setConfig).catch(() => setConfig({ cardEnabled: false, zelle: null }));
  }, []);

  const createBookingOnce = async () => {
    if (pendingBooking) return pendingBooking;
    const scheduledAt = combineDayTime(booking.dayIso, booking.timeLabel).toISOString();
    const result = await api.createBooking({
      pickup: booking.pickup,
      dropoff: booking.dropoff,
      scheduledAt,
      paymentMethod: booking.payment,
      rider: { name: booking.name, phone: booking.phone },
    });
    setPendingBooking(result);
    return result;
  };

  const submit = async () => {
    if (!booking.payment || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await createBookingOnce();
      if (booking.payment !== 'card') {
        onConfirmed({ ...result, paymentsConfig: config });
        return;
      }
      // Card: stay in the flow, mount Stripe's Payment Element inline.
      const { clientSecret } = await api.createPaymentIntent(result.id);
      const stripe = await loadStripe(config.publishableKey);
      stripeRef.current = stripe;
      elementsRef.current = stripe.elements({
        clientSecret,
        appearance: {
          theme: 'stripe',
          variables: { colorPrimary: '#0B0B0B', borderRadius: '12px', fontSizeBase: '16px' },
        },
      });
      setPhase('card');
    } catch (err) {
      setError(err.message || 'Could not confirm your booking. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Mount the element once the card phase's container exists in the DOM.
  useEffect(() => {
    if (phase !== 'card' || !elementsRef.current || !mountRef.current) return;
    const el = elementsRef.current.create('payment', { layout: 'tabs' });
    el.mount(mountRef.current);
    return () => el.destroy();
  }, [phase]);

  const payNow = async () => {
    if (paying) return;
    setPaying(true);
    setError('');
    try {
      const { error: payErr } = await stripeRef.current.confirmPayment({
        elements: elementsRef.current,
        redirect: 'if_required',
      });
      if (payErr) {
        setError(payErr.message || 'Payment didn\u2019t go through. Please try again.');
        return;
      }
      onConfirmed({ ...pendingBooking, payment_status: 'paid', paymentsConfig: config });
    } catch {
      setError('Payment didn\u2019t go through. Please try again.');
    } finally {
      setPaying(false);
    }
  };

  const fareLabel = booking.quote ? `$${booking.quote.fare.toFixed(2)}` : '';

  if (phase === 'card') {
    return (
      <FlowShell
        title="Card payment"
        step={3}
        totalSteps={3}
        onBack={() => setPhase('choose')}
        footer={(
          <div className="k-footer-bar">
            <div className="k-footer-inner">
              <button className="k-next-btn" disabled={paying} onClick={payNow}>
                {paying ? 'Processing\u2026' : `Pay ${fareLabel} \u2014 lock my ride`}
              </button>
            </div>
          </div>
        )}
      >
        <span className="k-q">Pay securely</span>
        <span className="k-q-sub">Handled by Stripe — your card details never touch our servers.</span>
        <div ref={mountRef} className="k-stripe-mount" />
        {error && <span className="k-price-wait" role="alert">{error}</span>}
      </FlowShell>
    );
  }

  return (
    <FlowShell
      title="Payment"
      step={3}
      totalSteps={3}
      onBack={onBack}
      footer={(
        <div className="k-footer-bar">
          <div className="k-footer-inner">
            <button className="k-next-btn" disabled={!booking.payment || submitting || !config} onClick={submit}>
              {submitting
                ? 'Confirming\u2026'
                : booking.payment === 'card'
                  ? 'Continue to card payment'
                  : 'Confirm booking'}
            </button>
          </div>
        </div>
      )}
    >
      <span className="k-q">How would you like to pay?</span>
      <span className="k-q-sub">
        {booking.quote ? `${fareLabel} \u00b7 ${booking.quote.durationLabel} drive \u00b7 price locked` : ''}
      </span>

      {config === null
        ? <span className="k-price-wait">Loading payment options\u2026</span>
        : <PaymentCards method={booking.payment} onSelect={(m) => onChange({ payment: m })} config={config} />}

      {error && <span className="k-price-wait" role="alert">{error}</span>}
    </FlowShell>
  );
}
