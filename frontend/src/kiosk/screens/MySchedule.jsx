import { useCallback, useEffect, useState } from 'react';
import FlowShell from '../components/FlowShell';
import { api } from '../../lib/api';

// ============================================================
// MySchedule — a commuter's next two weeks, and a way out of any one of them
// ============================================================
// Reached from `…/?series=<uuid>`. The series id is the token: unguessable, in
// the rider's own confirmation, no account and no password to reset at 6am when
// someone wakes up not working today. Same bargain the tracking link already
// makes.
//
// The list shows every ride the generator has created, including the ones
// already called off — a skipped day has to stay visible, or a rider cannot
// tell "I skipped that" from "the system lost it", and the only way to find out
// is to stand outside at 07:30.

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Formatted from the DATE STRING, never from a Date object. `2026-09-10` parsed
// as a Date is midnight UTC, which in New York is the evening of the 9th — the
// rider would be shown the wrong day for their own ride.
function dayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { weekday: DAY[wd], date: `${MONTH[m - 1]} ${d}` };
}

// The pickup time as the rider's own device would show it. scheduled_at is a
// real instant, so this is the one place a Date is the right tool.
function timeLabel(iso, timezone) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: timezone || undefined,
    }).format(new Date(iso));
  } catch { return ''; }
}

// Why a day cannot be changed, said in the rider's terms. A disabled button
// with no explanation reads as broken.
const BLOCKED = {
  too_close_to_pickup: 'Too close to pickup — call us',
  ride_already_started: 'Your driver is on the way',
  already_skipped: '',
  not_skipped: '',
  canceled_by_someone_else: 'Cancelled by us — call to rebook',
};

export default function MySchedule({ seriesId, onExit }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busyDate, setBusyDate] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.getSeries(seriesId));
      setError('');
    } catch {
      setError('We could not find that schedule. Check the link, or call us.');
    }
  }, [seriesId]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (ride) => {
    setBusyDate(ride.date);
    setError('');
    try {
      if (ride.skipped) await api.unskipSeriesDate(seriesId, ride.date);
      else await api.skipSeriesDate(seriesId, ride.date);
      // Re-read rather than patching locally: the cutoff moves with the clock,
      // and dispatch may have changed something while this page sat open.
      await load();
    } catch (e) {
      // req() puts the server's reason string in err.message, not on a body
      // object — so this maps the reason code the route returned.
      setError(BLOCKED[e?.message] || 'That did not go through. Try again, or call us.');
      await load();
    } finally {
      setBusyDate(null);
    }
  };

  const footer = (
    <div className="k-footer-bar">
      <div className="k-footer-inner">
        <button className="k-next-btn" onClick={onExit}>Done</button>
      </div>
    </div>
  );

  if (error && !data) {
    return (
      <FlowShell title="Your schedule" step={0} totalSteps={0} onBack={onExit} footer={footer}>
        <p className="error-text center">{error}</p>
      </FlowShell>
    );
  }
  if (!data) {
    return (
      <FlowShell title="Your schedule" step={0} totalSteps={0} onBack={onExit} footer={footer}>
        <span className="k-q-sub">Loading your rides…</span>
      </FlowShell>
    );
  }

  const { series, rides } = data;

  return (
    <FlowShell title="Your schedule" step={0} totalSteps={0} onBack={onExit} footer={footer}>
      <span className="k-q">Your regular ride</span>
      <span className="k-q-sub">
        {series.pickup_address} → {series.dropoff_address}
      </span>

      {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}

      {!rides.length && (
        <p className="k-q-sub" style={{ marginTop: 18 }}>
          No rides scheduled yet. They appear here about two weeks ahead.
        </p>
      )}

      <div className="k-sched">
        {rides.map((r) => {
          const { weekday, date } = dayLabel(r.date);
          const blockedWhy = r.skipped
            ? BLOCKED[r.restorable.reason]
            : BLOCKED[r.skippable.reason];
          const canAct = r.skipped ? r.restorable.ok : r.skippable.ok;
          return (
            <div key={r.date} className={`k-sched-row${r.skipped ? ' k-sched-row--off' : ''}`}>
              <div className="k-sched-when">
                <div className="k-sched-day">{weekday}</div>
                <div className="k-sched-date">{date} · {timeLabel(r.scheduled_at, series.timezone)}</div>
                {r.skipped && <div className="k-sched-tag">Not riding</div>}
              </div>
              {canAct ? (
                <button
                  className="k-sched-btn"
                  onClick={() => toggle(r)}
                  disabled={busyDate === r.date}
                >
                  {busyDate === r.date ? '…' : r.skipped ? 'Ride' : 'Skip'}
                </button>
              ) : (
                <span className="k-sched-locked">{blockedWhy}</span>
              )}
            </div>
          );
        })}
      </div>

      <p className="k-q-sub" style={{ marginTop: 18 }}>
        Skipping is free and you can change your mind up to an hour before pickup.
      </p>
    </FlowShell>
  );
}
