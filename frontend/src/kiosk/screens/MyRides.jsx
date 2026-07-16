import { useState } from 'react';
import FlowShell from '../components/FlowShell';
import PhoneKeypad from '../components/PhoneKeypad';
import { api } from '../../lib/api';
import { fmtPhone } from '../lib/phone';

function fmtWhen(iso) {
  const d = new Date(iso);
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Reschedule/Cancel are intentionally unimplemented stubs — matches the
// approved mockup's own scope for those two buttons.
const stub = (label) => () => alert(`${label} is coming in a future update.`);

export default function MyRides({ onBack }) {
  const [digits, setDigits] = useState('');
  const [rides, setRides] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const find = async () => {
    if (digits.length !== 10 || loading) return;
    setLoading(true);
    setError('');
    try {
      // Query with the same formatted string PayStep writes to rider_phone
      // (fmtPhone is deterministic, so this always matches what was stored).
      setRides(await api.getBookingsByPhone(fmtPhone(digits)));
    } catch (err) {
      setError(err.message || 'Could not look up your rides.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <FlowShell title="My Rides" step={0} totalSteps={0} onBack={onBack}>
      {!rides ? (
        <>
          <span className="k-q">Find your rides</span>
          <span className="k-q-sub">Enter the phone number you booked with</span>
          <PhoneKeypad digits={digits} onChange={setDigits} />
          {error && <span className="k-price-wait">{error}</span>}
          <div className="k-footer-bar">
            <div className="k-footer-inner">
              <button className="k-next-btn" disabled={digits.length !== 10 || loading} onClick={find}>
                {loading ? 'Looking…' : 'Find my rides'}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <span className="k-q">Your rides</span>
          <span className="k-q-sub">{fmtPhone(digits)}</span>

          {rides.length === 0 ? (
            <span className="k-price-wait">No rides found for this number.</span>
          ) : (
            <div className="k-rides-list">
              {rides.map((r) => (
                <div key={r.id} className="k-ride-card">
                  <div className="k-ride-when">{fmtWhen(r.scheduled_at)}</div>
                  <div className="k-ride-route">{r.pickup_address} → {r.dropoff_address}</div>
                  <div className="k-ride-tags">
                    <span className={`k-tag ${r.status === 'confirmed' ? 'green' : ''}`}>{r.status}</span>
                    <span className="k-tag">${Number(r.fare).toFixed(2)}</span>
                  </div>
                  <div className="k-ride-actions">
                    <button className="k-mini-btn" onClick={stub('Reschedule')}>Reschedule</button>
                    <button className="k-mini-btn" onClick={stub('Cancel')}>Cancel</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="k-footer-bar">
            <div className="k-footer-inner">
              <button className="k-next-btn" onClick={() => { setRides(null); setDigits(''); }}>Search again</button>
            </div>
          </div>
        </>
      )}
    </FlowShell>
  );
}
