import { buildDayOptions, buildTimeOptions } from '../lib/datetime';

const DAYS = buildDayOptions();
const TIMES = buildTimeOptions();

export default function DateTimeCases({ dayIso, timeLabel, onDayChange, onTimeChange }) {
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
            <option value="" disabled>Time</option>
            {TIMES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}
