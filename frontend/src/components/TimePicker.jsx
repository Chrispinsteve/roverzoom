import { useMemo } from 'react';

// Contemporary time picker: fast preset chips plus fine control via three
// segmented columns (hour / minute / AM-PM). No native <input type=time>,
// no dropdowns — big tap targets, tablet-friendly.

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = [0, 15, 30, 45];

function decompose(date) {
  if (!date) return { h12: 8, min: 0, ampm: 'AM' };
  const h = date.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  const min = MINUTES.reduce((prev, m) => (Math.abs(m - date.getMinutes()) < Math.abs(prev - date.getMinutes()) ? m : prev), 0);
  return { h12, min, ampm };
}

function compose(base, h12, min, ampm) {
  const d = base ? new Date(base) : new Date();
  let h = h12 % 12;
  if (ampm === 'PM') h += 12;
  d.setHours(h, min, 0, 0);
  return d;
}

export default function TimePicker({ value, onChange }) {
  const { h12, min, ampm } = useMemo(() => decompose(value), [value]);

  const set = (nh, nm, na) => onChange(compose(value, nh, nm, na));

  const col = (items, current, fmt, onPick) => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto', padding: 4 }}>
      {items.map((it) => {
        const on = it === current;
        return (
          <button key={it} onClick={() => onPick(it)}
            style={{
              padding: '12px 0', borderRadius: 10, fontSize: 16,
              fontWeight: on ? 700 : 500, fontVariantNumeric: 'tabular-nums',
              background: on ? 'var(--ink)' : 'var(--canvas)',
              color: on ? '#fff' : 'var(--ink)',
            }}>
            {fmt(it)}
          </button>
        );
      })}
    </div>
  );

  return (
    <div style={{ background: 'var(--card)', border: '1.5px solid var(--line-2)', borderRadius: 'var(--r-md)', padding: 16 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {col(HOURS, h12, (v) => String(v), (v) => set(v, min, ampm))}
        {col(MINUTES, min, (v) => String(v).padStart(2, '0'), (v) => set(h12, v, ampm))}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, padding: 4 }}>
          {['AM', 'PM'].map((a) => {
            const on = a === ampm;
            return (
              <button key={a} onClick={() => set(h12, min, a)}
                style={{
                  padding: '12px 0', borderRadius: 10, fontSize: 16,
                  fontWeight: on ? 700 : 500,
                  background: on ? 'var(--ink)' : 'var(--canvas)',
                  color: on ? '#fff' : 'var(--ink)',
                }}>
                {a}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
