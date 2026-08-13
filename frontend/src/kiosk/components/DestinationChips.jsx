import { KNOWN_SPOTS } from '../lib/spots';

export default function DestinationChips({ dropoff, onPick }) {
  return (
    <div className="k-chips">
      {KNOWN_SPOTS.map((spot) => (
        <button
          key={spot.label}
          className={`k-chip ${dropoff?.address === spot.address ? 'sel' : ''}`}
          onClick={() => onPick({ address: spot.address, lat: spot.lat, lng: spot.lng })}
        >
          {spot.label}
        </button>
      ))}
    </div>
  );
}
