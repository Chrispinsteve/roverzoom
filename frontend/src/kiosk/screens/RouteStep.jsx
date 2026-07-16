import { useState } from 'react';
import FlowShell from '../components/FlowShell';
import RouteCard from '../components/RouteCard';
import DestinationChips from '../components/DestinationChips';
import DateTimeCases from '../components/DateTimeCases';
import PriceSlab from '../components/PriceSlab';
import { api } from '../../lib/api';

export default function RouteStep({ booking, onChange, onNext, onBack }) {
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState(false);

  // Bumped only when pickup/dropoff is set from OUTSIDE the AddressInput
  // itself (a destination chip or "This trip" GPS) — forces RouteCard to
  // remount that field so it picks up the new text. AddressInput's own
  // dropdown picks flow straight through onChange without touching these,
  // so they don't trigger a remount (see RouteCard.jsx for why that matters).
  const [pickupKey, setPickupKey] = useState(0);
  const [dropoffKey, setDropoffKey] = useState(0);

  const useThisTrip = () => {
    if (!navigator.geolocation) {
      setLocateError(true);
      return;
    }
    setLocating(true);
    setLocateError(false);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude: lat, longitude: lng } = pos.coords;
          const result = await api.reverseGeocode(lat, lng);
          onChange({ pickup: { address: result.address, lat: result.lat, lng: result.lng } });
          setPickupKey((k) => k + 1);
        } catch {
          setLocateError(true);
        } finally {
          setLocating(false);
        }
      },
      () => { setLocating(false); setLocateError(true); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const pickDestination = (d) => {
    onChange({ dropoff: d });
    setDropoffKey((k) => k + 1);
  };

  const canContinue = !!(
    booking.pickup?.address && booking.dropoff?.address &&
    booking.dayIso && booking.timeLabel && booking.quote
  );

  return (
    <FlowShell title="Where to?" step={1} totalSteps={3} onBack={onBack}>
      <span className="k-q">Where are you headed?</span>
      <span className="k-q-sub">Enter your pickup and destination</span>

      <RouteCard
        pickup={booking.pickup}
        dropoff={booking.dropoff}
        onPickup={(p) => onChange({ pickup: p })}
        onDropoff={(d) => onChange({ dropoff: d })}
        onThisTrip={useThisTrip}
        locating={locating}
        pickupKey={pickupKey}
        dropoffKey={dropoffKey}
      />
      {locateError && <span className="k-price-wait">Couldn't get your location. Try entering it manually.</span>}

      <span className="k-field-label">Popular destinations</span>
      <DestinationChips dropoff={booking.dropoff} onPick={pickDestination} />

      <DateTimeCases
        dayIso={booking.dayIso}
        timeLabel={booking.timeLabel}
        onDayChange={(dayIso, dayLabel) => onChange({ dayIso, dayLabel })}
        onTimeChange={(timeLabel) => onChange({ timeLabel })}
      />

      <PriceSlab
        pickup={booking.pickup}
        dropoff={booking.dropoff}
        quote={booking.quote}
        onQuote={(quote) => onChange({ quote })}
      />

      <div className="k-footer-bar">
        <div className="k-footer-inner">
          <button className="k-next-btn" disabled={!canContinue} onClick={onNext}>
            Continue
            {booking.quote && <span className="k-next-price">${booking.quote.fare.toFixed(2)}</span>}
          </button>
        </div>
      </div>
    </FlowShell>
  );
}
