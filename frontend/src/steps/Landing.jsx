import { useState } from 'react';
import AddressInput from '../components/AddressInput';
import BobOrb from '../components/BobOrb';
import Icon from '../components/Icon';

export default function Landing({ aiEnabled, onContinue, onTalkToBob }) {
  const [pickup, setPickup] = useState(null);
  const [dropoff, setDropoff] = useState(null);

  const canContinue = !!(pickup?.address && dropoff?.address);

  return (
    <div className="body landing-body">
      {/* Hero section with car */}
      <div className="landing-hero rise">
        <img src="/car.png" alt="" className="landing-car" />
        <h1 className="landing-title">Schedule your Ride</h1>
        <p className="landing-sub">Premium chauffeur service, on your time.</p>
      </div>

      {/* Where To — address inputs */}
      <div className="landing-form rise-1">
        <h2 className="landing-where">Where to?</h2>

        <AddressInput
          label="Pickup"
          iconName="pin"
          placeholder="Enter pickup address"
          value={pickup}
          onSelect={setPickup}
        />
        <AddressInput
          label="Destination"
          iconName="flag"
          placeholder="Enter destination"
          value={dropoff}
          onSelect={setDropoff}
        />

        <button
          className="btn rise-2"
          disabled={!canContinue}
          onClick={() => onContinue(pickup, dropoff)}
          style={{ marginTop: 8 }}
        >
          Continue
        </button>
      </div>

      {/* Divider */}
      <div className="landing-divider rise-2">
        <span className="landing-divider-line" />
        <span className="landing-divider-text">or</span>
        <span className="landing-divider-line" />
      </div>

      {/* Bob AI assistant */}
      <div className="landing-bob rise-3">
        <BobOrb
          state="idle"
          onClick={aiEnabled ? onTalkToBob : undefined}
        />
        <p className="landing-bob-sub">
          {aiEnabled
            ? '"Pick me up at the office tomorrow at 8am, going to JFK"'
            : 'AI assistant requires setup'}
        </p>
      </div>

      <p className="center muted" style={{ fontSize: 12.5, marginTop: 'auto', paddingTop: 12, paddingBottom: 8 }}>
        No account required · Fixed fare, no surge
      </p>
    </div>
  );
}
