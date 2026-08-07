import { useEffect, useState } from 'react';
import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import MonthCalendar from '../components/MonthCalendar';
import { driverApi } from '../../lib/driverApi';
import { shortAddress } from '../lib/address';

const STATUS_LABEL = {
  confirmed: 'Pending dispatch',
  dispatching: 'Pending dispatch',
  driver_assigned: 'Assigned',
  driver_en_route: 'En route',
  arrived: 'Arrived',
  in_progress: 'In progress',
  completed: 'Completed',
  canceled: 'Canceled',
  manual_dispatch_required: 'Needs dispatch',
};

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function groupByDay(bookings) {
  const groups = [];
  const indexByDay = new Map();
  for (const b of bookings) {
    const key = new Date(b.scheduled_at).toDateString();
    if (!indexByDay.has(key)) {
      indexByDay.set(key, groups.length);
      groups.push({ key, items: [] });
    }
    groups[indexByDay.get(key)].items.push(b);
  }
  return groups;
}

function TripRowBody({ booking }) {
  const canceled = booking.status === 'canceled';
  const done = booking.status === 'completed';
  return (
    <div className="drv-trip-body">
      <div className="drv-trip-time">{timeLabel(booking.scheduled_at)}</div>
      <div className="drv-trip-route">{shortAddress(booking.pickup_address)} → {shortAddress(booking.dropoff_address)}</div>
      <div className="drv-trip-meta">
        {booking.distance_miles} mi
        {canceled ? '' : ` · you ${done ? 'earned' : 'earn'} $${booking.driver_payout.toFixed(2)}`}
      </div>
    </div>
  );
}

export default function Schedule({ driver, onClaimed, activeTab, onChangeTab }) {
  const [tab, setTab] = useState('mine'); // 'mine' (Upcoming) | 'available' | 'history'
  const [mine, setMine] = useState(null);
  const [available, setAvailable] = useState(null);
  const [error, setError] = useState('');
  const [claimingId, setClaimingId] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null); // date key from MonthCalendar, or null
  const [calOpen, setCalOpen] = useState(false);

  const profileComplete = !!driver.profile_completed_at;

  const load = async () => {
    setError('');
    try {
      const requests = [driverApi.getSchedule()];
      if (profileComplete) requests.push(driverApi.getAvailableTrips());
      const [schedule, trips] = await Promise.all(requests);
      setMine(schedule);
      if (profileComplete) setAvailable(trips);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const release = async (booking) => {
    const ok = window.confirm(
      'Release this ride back to other drivers?\n\n' +
      'You can release up to 2 hours before pickup. After that the rider is counting on you.'
    );
    if (!ok) return;
    setError('');
    try {
      await driverApi.releaseBooking(booking.id);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const claim = async (bookingId) => {
    setClaimingId(bookingId);
    setError('');
    try {
      const claimed = await driverApi.claimBooking(bookingId);
      onClaimed(claimed);
    } catch (e) {
      setError(e.message);
      await load();
    } finally {
      setClaimingId(null);
    }
  };

  // Split the driver's own bookings into the active pipeline (Upcoming) and
  // finished ones (History). Upcoming is soonest-first; History is most-recent-first.
  const isPast = (b) => b.status === 'completed' || b.status === 'canceled';
  const mineActive = mine ? mine.filter((b) => !isPast(b)) : null;
  const mineHistory = mine
    ? mine.filter(isPast).sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at))
    : null;

  const baseList = tab === 'available' ? available : tab === 'history' ? mineHistory : mineActive;
  const list = selectedDate ? (baseList || []).filter((b) => new Date(b.scheduled_at).toDateString() === selectedDate) : baseList;

  // Calendar dots: green = confirmed (mine, not canceled), yellow = pending (available).
  const confirmedDates = new Set((mine || []).filter((b) => b.status !== 'canceled').map((b) => new Date(b.scheduled_at).toDateString()));
  const pendingDates = new Set((available || []).map((b) => new Date(b.scheduled_at).toDateString()));

  const selectedLabel = selectedDate
    ? new Date(selectedDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    : null;

  const emptyText = selectedDate ? 'No trips on this date.'
    : tab === 'mine' ? 'No upcoming trips yet.'
    : tab === 'history' ? 'No past rides yet.'
    : 'No trips available right now.';

  return (
    <DriverShell activeTab={activeTab} onChangeTab={onChangeTab}>
      <div className="body drv-schedule-body">
        <h1 className="drv-sched-title">Schedule</h1>

        {/* Pinned tabs — always at the top. */}
        <div className="drv-tabs">
          <button className={`drv-tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>Upcoming</button>
          <button className={`drv-tab ${tab === 'available' ? 'active' : ''}`} onClick={() => setTab('available')}>Available</button>
          <button className={`drv-tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>History</button>
        </div>

        {/* Compact date filter — the full calendar tucks behind this so the trip
            list is the hero. Picking a day closes it and filters the list. */}
        <div className="drv-cal-bar">
          <button className={`drv-cal-toggle ${calOpen ? 'open' : ''} ${selectedDate ? 'active' : ''}`} onClick={() => setCalOpen((o) => !o)} aria-expanded={calOpen}>
            <Icon name="calendar" size={16} color="var(--ink-3)" />
            <span>{selectedLabel || 'Filter by date'}</span>
            <span className="drv-cal-chev">{calOpen ? '▲' : '▼'}</span>
          </button>
          {selectedDate && <button className="drv-cal-clear" onClick={() => { setSelectedDate(null); }}>Clear</button>}
        </div>

        {error && <p className="error-text">{error}</p>}

        {/* Only the list (and, when open, the calendar) scrolls. */}
        <div className="drv-schedule-scroll">
          {calOpen && (
            <MonthCalendar
              confirmedDates={confirmedDates}
              pendingDates={pendingDates}
              selectedKey={selectedDate}
              onSelectDate={(d) => { setSelectedDate(d); setCalOpen(false); }}
            />
          )}

          {tab === 'available' && !profileComplete ? (
            <div className="drv-empty-state">
              <Icon name="shieldCheck" size={32} color="var(--ink-4)" />
              <p>Complete your profile to claim available trips.</p>
              <button className="btn" style={{ marginTop: 16 }} onClick={() => onChangeTab('profile')}>
                Complete Profile
              </button>
            </div>
          ) : (
            <>
              {list === null && !error && <p className="muted center" style={{ marginTop: 24 }}>Loading…</p>}

              {list && list.length === 0 && (
                <p className="muted center" style={{ marginTop: 24 }}>{emptyText}</p>
              )}

              {list && groupByDay(list).map((group) => (
                <div key={group.key} className="drv-trip-group">
                  <div className="drv-trip-daylabel">{dayLabel(group.items[0].scheduled_at)}</div>
                  {group.items.map((b) => (
                    tab === 'available' ? (
                      <button
                        key={b.id}
                        className="drv-trip-row"
                        onClick={() => claim(b.id)}
                        disabled={claimingId === b.id}
                      >
                        <TripRowBody booking={b} />
                        <span className="drv-trip-claim">{claimingId === b.id ? '…' : 'Claim'}</span>
                      </button>
                    ) : (
                      <div key={b.id} className="drv-trip-row">
                        <TripRowBody booking={b} />
                        <div className="drv-trip-side">
                          <span className="drv-trip-status">{STATUS_LABEL[b.status] || b.status}</span>
                          {b.status === 'driver_assigned' && (new Date(b.scheduled_at) - Date.now()) > 2 * 36e5 && (
                            <button className="drv-release" onClick={() => release(b)}>Release</button>
                          )}
                        </div>
                      </div>
                    )
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </DriverShell>
  );
}
