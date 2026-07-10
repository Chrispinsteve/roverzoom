import { useMemo, useState } from 'react';
import Icon from './Icon';

// Step 2 (Variation B): a compact, premium schedule picker.
// A paginated week row (S M T W T F S) + a big time readout with quick presets
// + a black confirmation summary. Replaces the old full-month calendar that
// ate the whole screen.

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DOW_FULL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const PRESETS = ['6:30 AM', '8:00 AM', '12:00 PM', '5:30 PM', '9:00 PM'];

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

function parsePreset(base, preset) {
  const [hm, ap] = preset.split(' ');
  let [h, m] = hm.split(':').map(Number);
  h = h % 12;
  if (ap === 'PM') h += 12;
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

function formatTime(d) {
  if (!d) return '8:00 AM';
  const h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
}

// "HH:MM" (24h) <-> Date helpers for the native time input, which lets the
// rider pick any time instead of being limited to the quick presets.
function toTimeInputValue(d) {
  if (!d) return '08:00';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function applyTimeInput(base, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

// value/onChange operate on a single combined Date (date + time).
export default function ScheduleStep({ value, onChange }) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const defaultTime = useMemo(() => { const d = new Date(); d.setHours(8, 0, 0, 0); return d; }, []);
  const time = value || defaultTime;
  const selectedDay = value ? startOfDay(value) : startOfDay(new Date(today.getTime() + 86400000));
  const [weekOffset, setWeekOffset] = useState(0);
  const timeLabel = formatTime(time);
  const [customOpen, setCustomOpen] = useState(() => !PRESETS.includes(timeLabel));

  const weekStart = useMemo(() => {
    const d = new Date(today);
    d.setDate(today.getDate() + weekOffset * 7 - d.getDay());
    return d;
  }, [today, weekOffset]);

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + 6);
    return d;
  }, [weekStart]);

  const days = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      arr.push(startOfDay(d));
    }
    return arr;
  }, [weekStart]);

  const pickDay = (d) => {
    if (d < today) return;
    // keep the current time-of-day, move the date
    const next = new Date(d);
    next.setHours(time.getHours(), time.getMinutes(), 0, 0);
    onChange(next);
  };

  const pickTime = (p) => {
    setCustomOpen(false);
    onChange(parsePreset(selectedDay, p));
  };

  const pickCustomTime = (hhmm) => {
    onChange(applyTimeInput(selectedDay, hhmm));
  };

  // Concrete month + date range (e.g. "Jul 6–12") instead of a relative
  // "This week / Next week / In N weeks" counter, which reads as a
  // meaningless "week 13" once the rider pages forward a few times.
  const weekLabel = useMemo(() => {
    const startMon = MON[weekStart.getMonth()];
    const endMon = MON[weekEnd.getMonth()];
    const yearSuffix = weekEnd.getFullYear() !== today.getFullYear() ? `, ${weekEnd.getFullYear()}` : '';
    return startMon === endMon
      ? `${startMon} ${weekStart.getDate()}–${weekEnd.getDate()}${yearSuffix}`
      : `${startMon} ${weekStart.getDate()} – ${endMon} ${weekEnd.getDate()}${yearSuffix}`;
  }, [weekStart, weekEnd, today]);

  const summaryLabel = () => {
    const isToday = selectedDay.getTime() === today.getTime();
    const isTmrw = selectedDay.getTime() === today.getTime() + 86400000;
    const day = isToday ? 'Today' : isTmrw ? 'Tomorrow'
      : `${DOW_FULL[selectedDay.getDay()]}, ${MON[selectedDay.getMonth()]} ${selectedDay.getDate()}`;
    return `${day}, ${timeLabel}`;
  };

  return (
    <>
      <h1 className="title rise">When do you ride?</h1>
      <p className="subtitle rise-1">Choose your day and pickup time.</p>

      {/* Week card */}
      <div className="rise-1" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 20, padding: 6, boxShadow: 'var(--shadow-card)', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px 8px' }}>
          <button onClick={() => weekOffset > 0 && setWeekOffset((w) => w - 1)} disabled={weekOffset === 0}
            style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--card)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: weekOffset === 0 ? 0.35 : 1 }} aria-label="Previous week">
            <Icon name="arrowLeft" size={17} color="var(--ink-3)" />
          </button>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{weekLabel}</span>
          <button onClick={() => setWeekOffset((w) => w + 1)}
            style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--card)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="Next week">
            <Icon name="arrowRight" size={17} color="var(--ink-3)" />
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, padding: 4 }}>
          {days.map((d, i) => {
            const past = d < today;
            const on = d.getTime() === selectedDay.getTime();
            const isToday = d.getTime() === today.getTime();
            return (
              <button key={i} disabled={past} onClick={() => pickDay(d)}
                style={{
                  padding: '9px 0', borderRadius: 12, border: 'none',
                  background: on ? 'var(--ink)' : 'transparent',
                  cursor: past ? 'default' : 'pointer', opacity: past ? 0.3 : 1,
                }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: on ? 'rgba(255,255,255,0.55)' : 'var(--ink-4)' }}>{DOW[d.getDay()]}</div>
                <div style={{
                  fontSize: 16, fontWeight: 700, marginTop: 3,
                  color: on ? '#fff' : isToday ? 'var(--ink)' : 'var(--ink-2)',
                  textDecoration: isToday && !on ? 'underline' : 'none', textUnderlineOffset: 3,
                }}>{d.getDate()}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Time card */}
      <div className="rise-2" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 20, padding: 18, boxShadow: 'var(--shadow-card)', marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
          <span className="eyebrow">Pickup time</span>
          <span style={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{timeLabel}</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {PRESETS.map((p) => {
            const on = !customOpen && p === timeLabel;
            return (
              <button key={p} onClick={() => pickTime(p)}
                style={{
                  flex: '1 1 72px', padding: '10px 4px', borderRadius: 11,
                  border: on ? '1.5px solid var(--ink)' : '1.5px solid var(--line)',
                  background: on ? 'var(--ink)' : 'var(--card)',
                  color: on ? '#fff' : 'var(--ink-3)',
                  fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap',
                }}>
                {p.replace(' ', '\u00A0')}
              </button>
            );
          })}
        </div>
        <button onClick={() => setCustomOpen((o) => !o)}
          style={{
            width: '100%', marginTop: 8, padding: '9px 4px', borderRadius: 11,
            border: customOpen ? '1.5px solid var(--ink)' : '1.5px dashed var(--line)',
            background: customOpen ? 'var(--ink)' : 'transparent',
            color: customOpen ? '#fff' : 'var(--ink-3)',
            fontSize: 12.5, fontWeight: 600,
          }}>
          {customOpen ? 'Using a custom time' : 'Pick a different time'}
        </button>
        {customOpen && (
          <div style={{ marginTop: 12 }}>
            <input
              type="time"
              className="input"
              value={toTimeInputValue(time)}
              onChange={(e) => e.target.value && pickCustomTime(e.target.value)}
              aria-label="Custom pickup time"
            />
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Not limited to the presets above \u2014 pick whatever works for your schedule.</p>
          </div>
        )}
      </div>

      {/* Summary bar */}
      <div className="rise-3" style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--ink)', borderRadius: 16, padding: '15px 18px' }}>
        <Icon name="calendar" size={20} color="#fff" />
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}>Scheduled pickup</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#fff', marginTop: 1 }}>{summaryLabel()}</div>
        </div>
      </div>
    </>
  );
}
