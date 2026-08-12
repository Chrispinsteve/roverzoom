import { useEffect, useState } from 'react';
import AddressInput from '../components/AddressInput';
import BobOrb from '../components/BobOrb';

// The hero messages cycle through, then rest on "Where To?"
const SLIDES = [
  { text: 'Schedule your Ride', sub: '' },
  { text: 'Premium Chauffeur Service', sub: '' },
  { text: 'Fixed Pricing', sub: 'No Surge' },
  { text: 'Professional Drivers', sub: '' },
  { text: 'Where To?', sub: '', final: true },
];

const HOLD_MS = 2200; // how long each slide stays visible
const FADE_MS = 600;  // transition duration

export default function Landing({ aiEnabled, onContinue, onTalkToBob }) {
  const [pickup, setPickup] = useState(null);
  const [dropoff, setDropoff] = useState(null);
  const [slideIdx, setSlideIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  const slide = SLIDES[slideIdx];
  const isFinal = slide.final;
  const canContinue = !!(pickup?.address && dropoff?.address);

  // Cycle through slides, stop on the last one
  useEffect(() => {
    if (isFinal) return;
    const holdTimer = setTimeout(() => {
      setVisible(false); // fade out
      setTimeout(() => {
        setSlideIdx((i) => i + 1);
        setVisible(true); // fade in next
      }, FADE_MS);
    }, HOLD_MS);
    return () => clearTimeout(holdTimer);
  }, [slideIdx, isFinal]);

  return (
    <div className="body landing-body">
      {/* Cycling hero text */}
      <div className="hero-text-zone">
        <div
          className="hero-slide"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? 'none' : 'translateY(-8px)',
            transition: `opacity ${FADE_MS}ms var(--ease), transform ${FADE_MS}ms var(--ease)`,
          }}
        >
          <h1 className="hero-headline">{slide.text}</h1>
          {slide.sub && <p className="hero-subline">{slide.sub}</p>}
        </div>
        {/* Dots indicator */}
        <div className="hero-dots">
          {SLIDES.map((_, i) => (
            <span
              key={i}
              className={`hero-dot ${i === slideIdx ? 'active' : ''}`}
            />
          ))}
        </div>
      </div>

      {/* Car — blends into the canvas */}
      <div className="landing-car-wrap">
        <img src="/car.png" alt="" className="landing-car" draggable="false" />
      </div>

      {/* Inputs — always visible, ready when the hero lands on "Where To?" */}
      <div className="landing-form">
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
          className="btn"
          disabled={!canContinue}
          onClick={() => onContinue(pickup, dropoff)}
          style={{ marginTop: 8 }}
        >
          Continue
        </button>
      </div>

      {/* Divider + Bob */}
      <div className="landing-divider">
        <span className="landing-divider-line" />
        <span className="landing-divider-text">or</span>
        <span className="landing-divider-line" />
      </div>

      <div className="landing-bob">
        <BobOrb
          state="idle"
          onClick={aiEnabled ? onTalkToBob : undefined}
        />
        {aiEnabled ? (
          <p className="landing-bob-sub">
            "Pick me up at the office tomorrow at 8am, going to JFK"
          </p>
        ) : (
          <p className="landing-bob-sub" style={{ color: 'var(--ink-4)' }}>
            AI assistant requires setup
          </p>
        )}
      </div>

    </div>
  );
}
