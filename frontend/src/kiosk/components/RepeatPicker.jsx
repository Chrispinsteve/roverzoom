// ============================================================
// RepeatPicker — where a commuter says "every week"
// ============================================================
// Sits directly under the date and time, because that is the moment the
// question makes sense: the rider has just chosen a Monday at 07:30, and the
// only thing left to say is "and every Monday after that".
//
// Off by default. The overwhelming majority of bookings are one-off, and a
// recurring toggle that starts on would quietly commit people to twenty rides.
//
// The days are chips rather than a dropdown because working weeks are not
// contiguous. Someone on Monday, Wednesday, Thursday and Friday cannot express
// that with a range, and asking them to is how you end up with a rider who
// silently books a Tuesday they never work.

const DAYS = [
  { i: 0, s: 'S', full: 'Sunday' },
  { i: 1, s: 'M', full: 'Monday' },
  { i: 2, s: 'T', full: 'Tuesday' },
  { i: 3, s: 'W', full: 'Wednesday' },
  { i: 4, s: 'T', full: 'Thursday' },
  { i: 5, s: 'F', full: 'Friday' },
  { i: 6, s: 'S', full: 'Saturday' },
];

// The weekday of the chosen date, read from the DATE STRING. Parsing
// "2026-09-14" as a Date gives midnight UTC, which in New York is the evening
// before — the rider would see Sunday pre-selected for a Monday booking.
function weekdayOf(dayIso) {
  if (!dayIso) return null;
  const [y, m, d] = String(dayIso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export default function RepeatPicker({ dayIso, timeLabel, repeat, onChange }) {
  // Nothing to repeat until there is a day and a time to repeat.
  if (!dayIso || !timeLabel) return null;

  const on = Boolean(repeat?.on);
  const chosen = weekdayOf(dayIso);
  const days = repeat?.days?.length ? repeat.days : (chosen == null ? [] : [chosen]);

  const toggleOn = () => onChange({ on: !on, days });
  const toggleDay = (i) => {
    const next = days.includes(i) ? days.filter((d) => d !== i) : [...days, i].sort();
    // Never let them turn every day off — an empty series generates nothing and
    // the rider would be left with a schedule that silently never happens.
    if (!next.length) return;
    onChange({ on: true, days: next });
  };

  const named = DAYS.filter((d) => days.includes(d.i)).map((d) => d.full);
  const summary = named.length === 7 ? 'every day'
    : named.length === 5 && !days.includes(0) && !days.includes(6) ? 'every weekday'
      : named.length > 2 ? `${named.length} days a week`
        : named.join(' and ');

  return (
    <div className={`k-repeat${on ? ' k-repeat--on' : ''}`}>
      <div className="k-repeat-head">
        <div className="k-repeat-text">
          <div className="k-repeat-title">Make this a regular ride</div>
          <div className="k-repeat-sub">
            {on ? `Same trip at ${timeLabel}, ${summary}.` : 'Same trip, same time, every week.'}
          </div>
        </div>
        <button type="button" className="k-repeat-btn" onClick={toggleOn} aria-pressed={on}>
          {on ? 'On' : 'Turn on'}
        </button>
      </div>

      {on && (
        <>
          <div className="k-repeat-days">
            {DAYS.map((d) => (
              <button
                key={d.i}
                type="button"
                className={`k-repeat-day${days.includes(d.i) ? ' k-repeat-day--on' : ''}`}
                onClick={() => toggleDay(d.i)}
                aria-label={d.full}
                aria-pressed={days.includes(d.i)}
              >
                {d.s}
              </button>
            ))}
          </div>
          <div className="k-repeat-note">
            We book two weeks ahead. Not working one day? Skip it from your
            schedule link — no charge, no call.
          </div>
        </>
      )}
    </div>
  );
}
