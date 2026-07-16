import { useEffect, useState } from 'react';
import DriverShell from '../DriverShell';
import { driverApi } from '../../lib/driverApi';

function dateLabel(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function Earnings({ activeTab, onChangeTab }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    driverApi.getEarnings().then(setData).catch((e) => setError(e.message));
  }, []);

  return (
    <DriverShell activeTab={activeTab} onChangeTab={onChangeTab}>
      <div className="body">
        <h1 className="title rise" style={{ fontSize: 26 }}>Earnings</h1>
        <p className="subtitle rise-1">You keep 60% of every fare</p>

        {error && <p className="error-text">{error}</p>}
        {!data && !error && <p className="muted center" style={{ marginTop: 24 }}>Loading…</p>}

        {data && (
          <>
            <div className="stat-strip rise-1">
              <div className="stat"><div className="k">Today</div><div className="v">${data.todayTotal.toFixed(2)}</div></div>
              <div className="stat"><div className="k">This Week</div><div className="v">${data.weekTotal.toFixed(2)}</div></div>
            </div>

            <p className="eyebrow rise-2" style={{ marginTop: 22, marginBottom: 8 }}>Recent Activity</p>
            {data.recent.length === 0 && (
              <p className="muted center" style={{ marginTop: 12 }}>No earnings yet — completed trips will show up here.</p>
            )}
            {data.recent.map((e) => (
              <div key={e.id} className="drv-trip-row" style={{ cursor: 'default' }}>
                <div className="drv-trip-body">
                  <div className="drv-trip-time">{dateLabel(e.created_at)}</div>
                  <div className="drv-trip-route" style={{ textTransform: 'capitalize' }}>{e.type}</div>
                </div>
                <span className="drv-trip-status" style={{ color: 'var(--positive)' }}>+${Number(e.amount).toFixed(2)}</span>
              </div>
            ))}

            {data.payouts.length > 0 && (
              <>
                <p className="eyebrow rise-2" style={{ marginTop: 22, marginBottom: 8 }}>Payout History</p>
                {data.payouts.map((p) => (
                  <div key={p.id} className="drv-trip-row" style={{ cursor: 'default' }}>
                    <div className="drv-trip-body">
                      <div className="drv-trip-time">
                        {new Date(p.period_start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        {' – '}
                        {new Date(p.period_end).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </div>
                      <div className="drv-trip-route">${Number(p.amount).toFixed(2)}</div>
                    </div>
                    <span className="drv-trip-status">{p.status === 'paid' ? 'Paid' : 'Pending'}</span>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </DriverShell>
  );
}
