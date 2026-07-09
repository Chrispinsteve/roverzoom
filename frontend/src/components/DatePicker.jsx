import { useState } from 'react';
import Icon from './Icon';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW = ['S','M','T','W','T','F','S'];

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }

export default function DatePicker({ value, onChange }) {
  const today = startOfDay(new Date());
  const selected = value ? startOfDay(value) : null;
  const [view, setView] = useState(() => {
    const base = selected || today;
    return { year: base.getFullYear(), month: base.getMonth() };
  });

  const firstOfMonth = new Date(view.year, view.month, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(view.year, view.month, d));

  const canGoBack = view.year > today.getFullYear() || view.month > today.getMonth() || view.year > today.getFullYear();
  const prevDisabled = new Date(view.year, view.month, 1) <= new Date(today.getFullYear(), today.getMonth(), 1);

  const shift = (delta) => {
    let m = view.month + delta;
    let y = view.year;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setView({ year: y, month: m });
  };

  return (
    <div style={{ background: 'var(--card)', border: '1.5px solid var(--line-2)', borderRadius: 'var(--r-md)', padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{MONTHS[view.month]} {view.year}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => shift(-1)} disabled={prevDisabled}
            style={{ width: 36, height: 36, borderRadius: 10, border: '1.5px solid var(--line-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: prevDisabled ? 0.35 : 1 }} aria-label="Previous month">
            <Icon name="arrowLeft" size={18} color="var(--ink-2)" />
          </button>
          <button onClick={() => shift(1)}
            style={{ width: 36, height: 36, borderRadius: 10, border: '1.5px solid var(--line-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="Next month">
            <Icon name="arrowRight" size={18} color="var(--ink-2)" />
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 6 }}>
        {DOW.map((d, i) => (
          <div key={i} style={{ textAlign: 'center', fontSize: 12, fontWeight: 600, color: 'var(--ink-4)', padding: '4px 0' }}>{d}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const isPast = date < today;
          const isSelected = selected && date.getTime() === selected.getTime();
          const isToday = date.getTime() === today.getTime();
          return (
            <button key={i} disabled={isPast} onClick={() => onChange(date)}
              style={{
                aspectRatio: '1', borderRadius: 10, fontSize: 15,
                fontWeight: isSelected ? 700 : 500,
                fontVariantNumeric: 'tabular-nums',
                background: isSelected ? 'var(--ink)' : 'transparent',
                color: isSelected ? '#fff' : isPast ? 'var(--ink-4)' : 'var(--ink)',
                opacity: isPast ? 0.4 : 1,
                cursor: isPast ? 'default' : 'pointer',
                border: isToday && !isSelected ? '1.5px solid var(--line-2)' : '1.5px solid transparent',
                position: 'relative',
              }}>
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
