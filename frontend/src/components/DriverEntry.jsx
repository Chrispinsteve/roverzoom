import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

// Fixed gear icon, bottom-right, everywhere in the rider app. Opens a small
// menu with the (only, for now) option to switch into the driver experience.
export default function DriverEntry({ onSelectDriverMode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 1000 }}>
      {open && (
        <div
          className="rise"
          style={{
            position: 'absolute', bottom: 56, right: 0, minWidth: 190,
            background: 'var(--card)', border: '1.5px solid var(--line-2)',
            borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-pop)',
            padding: 6, animationDuration: '0.18s',
          }}
        >
          <button
            onClick={() => { setOpen(false); onSelectDriverMode(); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '10px 12px', borderRadius: 'var(--r-sm)', fontSize: 14.5,
              fontWeight: 500, color: 'var(--ink)', textAlign: 'left',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--canvas)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <Icon name="car" size={18} color="var(--ink-2)" />
            Driver Mode
          </button>
        </div>
      )}
      <button
        aria-label="Settings"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 48, height: 48, borderRadius: '50%',
          background: 'var(--card)', border: '1.5px solid var(--line-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: 'var(--shadow-float)',
        }}
      >
        <Icon name="gear" size={21} color="var(--ink-2)" stroke={1.8} />
      </button>
    </div>
  );
}
