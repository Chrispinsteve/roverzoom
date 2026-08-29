import { useEffect, useState } from 'react';
import Icon from '../../components/Icon';
import { api } from '../../lib/api';

// Only quotes once both ends have real coordinates — never prices off a
// half-typed address, so the "locked" price is always the real $50/hr fare.
export default function PriceSlab({ pickup, dropoff, when, quote, onQuote }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const ready = pickup?.lat != null && dropoff?.lat != null;

  // Re-quote when the pickup time changes too — the fare depends on it
  // (early-morning rides get the deeper discount).
  useEffect(() => {
    if (!ready) {
      setError(false);
      onQuote(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    api.estimate(pickup, dropoff, when)
      .then((q) => { if (!cancelled) onQuote(q); })
      .catch(() => { if (!cancelled) { setError(true); onQuote(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, when]);

  if (ready && quote) {
    const market = quote.market;
    return (
      <>
        <div className="k-price-slab locked">
          <div className="k-price-live">
            <Icon name="lock" size={22} color="var(--lock-deep)" />
            <div className="k-price-words">
              <span className="k-price-cap">Price locked{quote.discountPct ? ` · ${quote.discountPct}% off` : ''}</span>
              <span className="k-price-meta">{quote.durationLabel} drive · {quote.distanceMiles} mi</span>
            </div>
            <span className="k-price-num">${quote.fare.toFixed(2)}</span>
          </div>
        </div>

        {/* Sits OUTSIDE the locked slab and below it, in the quietest type on
            the screen. A footnote to the price, never a competitor for it —
            no colour, no badge, no exclamation.

            "Compare at" is the ordinary retail convention for a reference
            price on a comparable purchase, and it names nobody. Deliberately
            NOT struck through: a strikethrough would imply this was once OUR
            price, which it never was.

            Rendered only when the server had something honest to say; see
            backend/services/market.js. */}
        {market && (
          <span className="k-price-compare">
            {market.single
              ? `Compare at about $${market.low} for the same trip`
              : `Compare at $${market.low}–$${market.high} for the same trip`}
          </span>
        )}
      </>
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
