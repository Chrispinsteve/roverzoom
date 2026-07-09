import { useState } from 'react';
import Icon from './Icon';

// Phone field with a country selector (flag + dial code). Small detail that
// signals a real product. Kept to a short common list; extend as needed.
const COUNTRIES = [
  { code: 'US', flag: '🇺🇸', dial: '+1' },
  { code: 'CA', flag: '🇨🇦', dial: '+1' },
  { code: 'GB', flag: '🇬🇧', dial: '+44' },
  { code: 'FR', flag: '🇫🇷', dial: '+33' },
  { code: 'DE', flag: '🇩🇪', dial: '+49' },
  { code: 'AE', flag: '🇦🇪', dial: '+971' },
  { code: 'IN', flag: '🇮🇳', dial: '+91' },
];

export default function PhoneInput({ value, onChange, dialCode, onDialChange }) {
  const [open, setOpen] = useState(false);
  const current = COUNTRIES.find((c) => c.dial === dialCode) || COUNTRIES[0];

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '0 12px', height: 54, flexShrink: 0,
            background: 'var(--card)', border: '1.5px solid var(--line-2)',
            borderRadius: 'var(--r-md)', fontSize: 15, fontWeight: 500,
          }}
          aria-label="Select country code"
        >
          <span style={{ fontSize: 18 }}>{current.flag}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{current.dial}</span>
          <Icon name="arrowRight" size={14} color="var(--ink-4)" stroke={2} />
        </button>
        <input
          className="input"
          type="tel"
          placeholder="(305) 123-4567"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>

      {open && (
        <div
          style={{
            position: 'absolute', top: 60, left: 0, zIndex: 30,
            width: 220, background: 'var(--card)', border: '1px solid var(--line-2)',
            borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-float)', overflow: 'hidden',
            animation: 'rz-scale-in 0.16s var(--ease) both',
          }}
        >
          {COUNTRIES.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => { onDialChange(c.dial); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '12px 14px', textAlign: 'left', fontSize: 14.5,
                borderBottom: '1px solid var(--line)',
                background: c.dial === dialCode ? 'var(--canvas)' : 'transparent',
              }}
            >
              <span style={{ fontSize: 18 }}>{c.flag}</span>
              <span style={{ flex: 1 }}>{c.code}</span>
              <span style={{ color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>{c.dial}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
