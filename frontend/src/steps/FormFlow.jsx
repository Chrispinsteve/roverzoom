import { useEffect, useMemo, useState } from 'react';
import Shell from '../components/Shell';
import AddressInput from '../components/AddressInput';
import DatePicker from '../components/DatePicker';
import TimePicker from '../components/TimePicker';
import RouteRail from '../components/RouteRail';
import PhoneInput from '../components/PhoneInput';
import Icon from '../components/Icon';
import { api } from '../lib/api';

const STEPS = ['locations', 'when', 'review', 'payment', 'details'];

function combineDateTime(date, time) {
  if (!date || !time) return null;
  const d = new Date(date);
  d.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return d;
}

export default function FormFlow({ onBack, onComplete }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [pickup, setPickup] = useState(null);
  const [dropoff, setDropoff] = useState(null);
  const [date, setDate] = useState(null);
  const [time, setTime] = useState(() => { const d = new Date(); d.setHours(8, 0, 0, 0); return d; });
  const [payment, setPayment] = useState('card');
  const [rider, setRider] = useState({ name: '', phone: '', email: '', dialCode: '+1' });
  const [quote, setQuote] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const step = STEPS[stepIdx];
  const scheduledAt = useMemo(() => combineDateTime(date, time), [date, time]);

  // Fetch fare when entering review
  useEffect(() => {
    if (step === 'review' && pickup && dropoff) {
      api.estimate(pickup, dropoff).then(setQuote).catch(() => setQuote(null));
    }
  }, [step, pickup, dropoff]);

  const next = () => { setError(''); setStepIdx((i) => Math.min(i + 1, STEPS.length - 1)); };
  const back = () => { setError(''); stepIdx === 0 ? onBack() : setStepIdx((i) => i - 1); };

  const canNext = () => {
    if (step === 'locations') return pickup && dropoff;
    if (step === 'when') return !!scheduledAt;
    if (step === 'review') return !!quote;
    if (step === 'payment') return !!payment;
    if (step === 'details') return rider.name.trim() && rider.phone.trim();
    return false;
  };

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const booking = await api.createBooking({
        pickup, dropoff,
        scheduledAt: scheduledAt.toISOString(),
        paymentMethod: payment,
        rider: { ...rider, phone: `${rider.dialCode} ${rider.phone}`.trim() },
        source: 'form',
      });
      onComplete(booking);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Shell step={stepIdx + 1} totalSteps={STEPS.length}>
      <div className="body">
        {step === 'locations' && (
          <>
            <h1 className="title">Set your route</h1>
            <p className="subtitle">Where should your chauffeur collect you, and where to?</p>
            <AddressInput label="Pickup" iconName="pin" placeholder="Search pickup address"
              value={pickup} onSelect={setPickup} />
            <AddressInput label="Destination" iconName="flag" placeholder="Search destination"
              value={dropoff} onSelect={setDropoff} />
          </>
        )}

        {step === 'when' && (
          <>
            <h1 className="title">Pick your time</h1>
            <p className="subtitle">Rides are scheduled in advance — choose the day and pickup time.</p>
            <div className="field">
              <label className="label">Date</label>
              <DatePicker value={date} onChange={setDate} />
            </div>
            <div className="field">
              <label className="label">Pickup time</label>
              <TimePicker value={time} onChange={setTime} />
            </div>
          </>
        )}

        {step === 'review' && (
          <>
            <h1 className="title rise">Review your ride</h1>
            <p className="subtitle rise-1">Here’s your estimated fare for this trip.</p>

            <div className="summary rise-1" style={{ padding: '18px 20px' }}>
              <RouteRail pickup={pickup?.address} dropoff={dropoff?.address} />
            </div>

            {quote ? (
              <>
                <div className="stat-strip rise-2">
                  <div className="stat"><div className="k">Distance</div><div className="v">{quote.distanceMiles} mi</div></div>
                  <div className="stat"><div className="k">Duration</div><div className="v">{quote.durationMinutes} min</div></div>
                  <div className="stat"><div className="k">Rate</div><div className="v">$50/hr</div></div>
                </div>
                <div className="fare-hero rise-3">
                  <div className="eyebrow" style={{ marginBottom: 6 }}>Estimated fare</div>
                  <div className="fare-amount">${quote.fare.toFixed(2)}</div>
                  <div className="fare-math">{quote.durationMinutes} min × $50 / hour</div>
                </div>
                <p className="muted rise-3" style={{ fontSize: 12.5, marginTop: 14 }}>Tolls and extra fees may apply.</p>
              </>
            ) : (
              <div className="summary"><div className="summary-row"><span className="summary-label">Calculating fare…</span></div></div>
            )}
          </>
        )}

        {step === 'payment' && (
          <>
            <h1 className="title">How would you like to pay?</h1>
            <p className="subtitle">You’re only charged after the ride is complete.</p>
            <button className={`option ${payment === 'card' ? 'selected' : ''}`} onClick={() => setPayment('card')}>
              <span className="option-icon"><Icon name="card" size={22} color="var(--ink)" /></span>
              <span className="option-body"><span className="option-title">Card</span>
                <span className="option-sub">Pay securely by card (Stripe)</span></span>
              <span className="option-check">{payment === 'card' && <Icon name="check" size={15} color="#fff" stroke={3} />}</span>
            </button>
            <button className={`option ${payment === 'cash' ? 'selected' : ''}`} onClick={() => setPayment('cash')}>
              <span className="option-icon"><Icon name="cash" size={22} color="var(--ink)" /></span>
              <span className="option-body"><span className="option-title">Cash</span>
                <span className="option-sub">Pay your chauffeur directly</span></span>
              <span className="option-check">{payment === 'cash' && <Icon name="check" size={15} color="#fff" stroke={3} />}</span>
            </button>
          </>
        )}

        {step === 'details' && (
          <>
            <h1 className="title">Almost there</h1>
            <p className="subtitle">Just your contact details to confirm the booking.</p>
            <div className="field">
              <label className="label">Full name</label>
              <input className="input" placeholder="Alex Rivera" value={rider.name}
                onChange={(e) => setRider({ ...rider, name: e.target.value })} />
            </div>
            <div className="field">
              <label className="label">Phone number</label>
              <PhoneInput
                value={rider.phone}
                onChange={(phone) => setRider({ ...rider, phone })}
                dialCode={rider.dialCode}
                onDialChange={(dialCode) => setRider({ ...rider, dialCode })}
              />
            </div>
            <div className="field">
              <label className="label">Email <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
              <input className="input" type="email" placeholder="alex@email.com" value={rider.email}
                onChange={(e) => setRider({ ...rider, email: e.target.value })} />
            </div>
          </>
        )}

        {error && <p className="error-text">{error}</p>}

        <div className="btn-row">
          <button className="btn btn-back" onClick={back} aria-label="Back">
            <Icon name="arrowLeft" size={20} color="var(--ink-2)" />
          </button>
          {step === 'details' ? (
            <button className="btn" disabled={!canNext() || submitting} onClick={submit}>
              {submitting ? 'Confirming…' : 'Confirm booking'}
            </button>
          ) : (
            <button className="btn" disabled={!canNext()} onClick={next}>Continue</button>
          )}
        </div>
      </div>
    </Shell>
  );
}
