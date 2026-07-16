import { useEffect, useState } from 'react';
import Icon from '../../components/Icon';
import { api } from '../../lib/api';

// Only quotes once both ends have real coordinates — never prices off a
// half-typed address, so the "locked" price is always the real $50/hr fare.
export default function PriceSlab({ pickup, dropoff, quote, onQuote }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const ready = pickup?.lat != null && dropoff?.lat != null;

  useEffect(() => {
    if (!ready) {
      setError(false);
      onQuote(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    api.estimate(pickup, dropoff)
      .then((q) => { if (!cancelled) onQuote(q); })
      .catch(() => { if (!cancelled) { setError(true); onQuote(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]);

  if (ready && quote) {
    return (
      <div className="k-price-slab locked">
        <div className="k-price-live">
          <Icon name="lock" size={22} color="var(--lock-deep)" />
          <div className="k-price-words">
            <span className="k-price-cap">Price locked</span>
            <span className="k-price-meta">{quote.durationLabel} drive · {quote.distanceMiles} mi</span>
          </div>
          <span className="k-price-num">${quote.fare.toFixed(2)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="k-price-slab">
      <span className="k-price-wait">
        {!ready ? "Enter pickup & destination to see your price"
          : loading ? 'Calculating your price…'
          : error ? "Couldn't calculate a price. Try again."
          : ''}
      </span>
    </div>
  );
}
