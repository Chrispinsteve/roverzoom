import { useEffect, useState } from 'react';
import DriverShell from '../DriverShell';
import MonthCalendar from '../components/MonthCalendar';
import { driverApi } from '../../lib/driverApi';

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
  return (
    <div className="drv-trip-body">
      <div className="drv-trip-time">{timeLabel(booking.scheduled_at)}</div>
      <div className="drv-trip-route">{booking.pickup_address} → {booking.dropoff_address}</div>
      <div className="drv-trip-meta">{booking.distance_miles} mi · ${Number(booking.fare).toFixed(2)}</div>
    </div>
  );
}

export default function Schedule({ onBack }) {
  const [tab, setTab] = useState('mine'); // 'mine' | 'available'
  const [mine, setMine] = useState(null);
  const [available, setAvailable] = useState(null);
  const [error, setError] = useState('');
  const [claimingId, setClaimingId] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null); // date key from MonthCalendar, or null

  const load = async () => {
    setError('');
    try {
      const [schedule, trips] = await Promise.all([
        driverApi.getSchedule(),
        driverApi.getAvailableTrips(),
      ]);
      setMine(schedule);
      setAvailable(trips);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const claim = async (bookingId) => {
    setClaimingId(bookingId);
    setError('');
    try {
      await driverApi.claimBooking(bookingId);
      await load();
      setTab('mine');
    } catch (e) {
      setError(e.message);
      await load();
    } finally {
      setClaimingId(null);
    }
  };

  // Confirmed = already assigned to this driver (My Schedule). Pending =
  // still unclaimed by anyone (Available Trips). A day can be both.
  const confirmedDates = new Set((mine || []).filter((b) => b.status !== 'canceled').map((b) => new Date(b.scheduled_at).toDateString()));
  const pendingDates = new Set((available || []).map((b) => new Date(b.scheduled_at).toDateString()));

  const baseList = tab === 'mine' ? mine : available;
  const list = selectedDate ? (baseList || []).filter((b) => new Date(b.scheduled_at).toDateString() === selectedDate) : baseList;

  return (
    <DriverShell onBack={onBack}>
      <div className="body">
        <h1 className="title rise" style={{ fontSize: 26 }}>Schedule</h1>

        <div className="rise-1">
          <MonthCalendar
            confirmedDates={confirmedDates}
            pendingDates={pendingDates}
            selectedKey={selectedDate}
            onSelectDate={setSelectedDate}
          />
        </div>

        {selectedDate && (
          <div className="drv-cal-filter-chip rise-1">
            Showing {new Date(selectedDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
            <button onClick={() => setSelectedDate(null)}>Clear</button>
          </div>
        )}

        <div className="drv-tabs rise-1">
          <button className={`drv-tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>My Schedule</button>
          <button className={`drv-tab ${tab === 'available' ? 'active' : ''}`} onClick={() => setTab('available')}>Available Trips</button>
        </div>

        {error && <p className="error-text">{error}</p>}

        {list === null && !error && <p className="muted center" style={{ marginTop: 24 }}>Loading…</p>}

        {list && list.length === 0 && (
          <p className="muted center" style={{ marginTop: 24 }}>
            {selectedDate ? 'No trips on this date.' : (tab === 'mine' ? 'No upcoming trips yet.' : 'No trips available right now.')}
          </p>
        )}

        {list && groupByDay(list).map((group) => (
          <div key={group.key} style={{ marginBottom: 18 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>{dayLabel(group.items[0].scheduled_at)}</div>
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
                  <span className="drv-trip-status">{STATUS_LABEL[b.status] || b.status}</span>
                </div>
              )
            ))}
          </div>
        ))}
      </div>
    </DriverShell>
  );
}
