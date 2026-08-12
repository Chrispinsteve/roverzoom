import { useState } from 'react';
import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';

export default function TripComplete({ ride, onBackToDashboard }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);

  return (
    <DriverShell rightSlot={
      <button className="drv-icon-btn" aria-label="Safety">
        <Icon name="shieldCheck" size={18} color="var(--ink)" />
      </button>
    }>
      <div className="body">
        <div style={{ textAlign: 'center', margin: '12px 0 20px' }}>
          <div className="drv-check-pop">
            <Icon name="check" size={32} color="#fff" stroke={2.5} />
          </div>
          <h1 className="title rise-1" style={{ fontSize: 25 }}>Trip Complete!</h1>
          <p className="subtitle rise-1" style={{ marginBottom: 0 }}>
            You earned <strong style={{ color: 'var(--ink)' }}>${ride.fare.toFixed(2)}</strong>
          </p>
        </div>

        <div className="summary rise-2">
          <div className="summary-row">
            <span className="summary-label">Base Fare</span>
            <span className="summary-value">${ride.baseFare.toFixed(2)}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Time ({ride.durationMin} min)</span>
            <span className="summary-value">${ride.timeFare.toFixed(2)}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label" style={{ fontWeight: 700, color: 'var(--ink)' }}>Total</span>
            <span className="summary-value big">${ride.fare.toFixed(2)}</span>
          </div>
        </div>

        <div className="rise-3" style={{ textAlign: 'center', marginTop: 24 }}>
          <p className="eyebrow" style={{ marginBottom: 12 }}>Rate your passenger</p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                aria-label={`${n} star`}
                onClick={() => setRating(n)}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                style={{ padding: 4 }}
              >
                <Icon
                  name="star"
                  size={30}
                  color={(hover || rating) >= n ? 'var(--ink)' : 'var(--line-2)'}
                  stroke={1.4}
                  filled={(hover || rating) >= n}
                />
              </button>
            ))}
          </div>
        </div>

        <div className="spacer" />

        <button className="btn rise-3" onClick={onBackToDashboard} style={{ marginTop: 24 }}>
          Back to Dashboard
        </button>
      </div>
    </DriverShell>
  );
}
