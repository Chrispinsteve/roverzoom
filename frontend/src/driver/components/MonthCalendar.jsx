import { useState } from 'react';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// Month-grid planning board: each date shows only its number, plus a green
// dot when the driver already has a confirmed trip that day and/or a yellow
// dot when there's a still-unclaimed (pending) trip that day. Empty days
// show nothing but the date, by design.
export default function MonthCalendar({ confirmedDates, pendingDates, selectedKey, onSelectDate }) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));

  const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const startWeekday = cursor.getDay();
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const today = new Date().toDateString();

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), day));

  return (
    <div className="drv-cal">
      <div className="drv-cal-header">
        <button className="drv-cal-nav" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} aria-label="Previous month">‹</button>
        <span className="drv-cal-title">{monthLabel}</span>
        <button className="drv-cal-nav" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} aria-label="Next month">›</button>
      </div>

      <div className="drv-cal-weekdays">
        {WEEKDAYS.map((w, i) => <span key={i}>{w}</span>)}
      </div>

      <div className="drv-cal-grid">
        {cells.map((d, i) => {
          if (!d) return <span key={i} className="drv-cal-cell empty" />;
          const key = d.toDateString();
          const isConfirmed = confirmedDates.has(key);
          const isPending = pendingDates.has(key);
          const classes = ['drv-cal-cell'];
          if (key === today) classes.push('today');
          if (key === selectedKey) classes.push('selected');
          return (
            <button
              key={i}
              type="button"
              className={classes.join(' ')}
              onClick={() => onSelectDate(key === selectedKey ? null : key)}
            >
              <span className="drv-cal-daynum">{d.getDate()}</span>
              {(isConfirmed || isPending) && (
                <span className="drv-cal-dots">
                  {isConfirmed && <span className="drv-cal-dot confirmed" />}
                  {isPending && <span className="drv-cal-dot pending" />}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="drv-cal-legend">
        <span><span className="drv-cal-dot confirmed" /> Confirmed</span>
        <span><span className="drv-cal-dot pending" /> Pending</span>
      </div>
    </div>
  );
}
