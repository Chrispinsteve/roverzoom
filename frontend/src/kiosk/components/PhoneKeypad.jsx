import { fmtPhone } from '../lib/phone';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

// `digits` is the raw (unformatted) phone string, owned by the parent.
export default function PhoneKeypad({ digits, onChange }) {
  const press = (key) => {
    if (key === 'clear') return onChange('');
    if (key === 'back') return onChange(digits.slice(0, -1));
    if (digits.length < 10) onChange(digits + key);
  };

  return (
    <div>
      <div className="k-phone-display">{fmtPhone(digits) || 'Your phone number'}</div>
      <div className="k-keypad">
        {KEYS.map((key) => (
          <button
            key={key}
            className={`k-key ${key === 'clear' || key === 'back' ? 'util' : ''}`}
            onClick={() => press(key)}
          >
            {key === 'clear' ? 'Clear' : key === 'back' ? '⌫' : key}
          </button>
        ))}
      </div>
    </div>
  );
}
