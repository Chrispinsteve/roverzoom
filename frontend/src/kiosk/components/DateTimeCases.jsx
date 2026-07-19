import { useEffect } from 'react';
import { buildDayOptions, buildTimeOptions, combineDayTime } from '../lib/datetime';

const DAYS = buildDayOptions();
const ALL_TIMES = buildTimeOptions();
// Smallest lead time before a ride — you can't book a slot less than this many
// minutes away, so a "now-ish" booking always lands safely in the future.
const LEAD_MINUTES = 15;

export default function DateTimeCases({ dayIso, timeLabel, onDayChange, onTimeChange }) {
  const isToday = dayIso === DAYS[0].iso;

  // For "today", only offer slots still comfortably in the future. Without this
  // the kiosk would happily let a rider book a time that already passed — a
  // booking that saves but can never be seen or accepted by a driver.
  const times = isToday
    ? ALL_TIMES.filter((t) => combineDayTime(dayIso, t)?.getTime() >= Date.now() + LEAD_MINUTES * 60000)
    : ALL_TIMES;

  // If the day changes and the previously-picked time is no longer valid
  // (e.g. switched from Tomorrow to Today), clear it so the rider must pick a
  // real, future slot instead of silently keeping a past one.
  useEffect(() => {
    if (timeLabel && !times.includes(timeLabel)) onTimeChange('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayIso]);

  return (
    <>
      <span className="k-field-label">When would you like to ride?</span>
      <div className="k-dt-cases">
        <label className="k-dt-case">
          <select
            value={dayIso || ''}
            onChange={(e) => {
              const picked = DAYS.find((d) => d.iso === e.target.value);
              onDayChange(picked?.iso, picked?.label);
            }}
          >
            <option value="" disabled>Date</option>
            {DAYS.map((d) => (
              <option key={d.iso} value={d.iso}>{d.label}</option>
            ))}
          </select>
        </label>
        <label className="k-dt-case">
          <select value={timeLabel || ''} onChange={(e) => onTimeChange(e.target.value)}>
            <option value="" disabled>
              {isToday && times.length === 0 ? 'No more times today' : 'Time'}
            </option>
            {times.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}
