import Icon from '../components/Icon';

const TABS = [
  { key: 'home', label: 'Home', icon: 'bars' },
  { key: 'requests', label: 'Requests', icon: 'car' },
  { key: 'schedule', label: 'Schedule', icon: 'calendar' },
  { key: 'earnings', label: 'Earnings', icon: 'wallet' },
  { key: 'profile', label: 'Profile', icon: 'user' },
];

function TabBar({ active, onChange }) {
  return (
    <nav className="drv-tabbar">
      {TABS.map((t) => (
        <button
          key={t.key}
          className={`drv-tabbar-btn ${active === t.key ? 'active' : ''}`}
          onClick={() => onChange(t.key)}
          aria-current={active === t.key}
        >
          <Icon name={t.icon} size={20} color={active === t.key ? 'var(--ink)' : 'var(--ink-4)'} />
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

// Driver mode is always dark, regardless of the rider app's theme setting.
// Setting data-theme="dark" on this wrapper scopes every CSS variable used
// by the shared .stage/.btn/.summary/etc classes to the dark palette, since
// custom properties inherit down to descendants.
//
// `activeTab`/`onChangeTab` render the persistent bottom tab bar (Home /
// Requests / Schedule / Earnings / Profile). Omit them (as the in-trip
// lifecycle screens do) to get a focused, tab-free full-screen surface —
// standard rideshare-app pattern: browsing has navigation chrome, an active
// trip doesn't.
export default function DriverShell({ onBack, rightSlot, step, totalSteps, activeTab, onChangeTab, children }) {
  const pct = totalSteps ? Math.round((step / totalSteps) * 100) : 0;
  return (
    <div data-theme="dark" className="app" style={{ background: 'var(--canvas)', minHeight: '100dvh' }}>
      <div className="stage">
        <div className="header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {onBack && (
              <button className="drv-icon-btn" onClick={onBack} aria-label="Back">
                <Icon name="arrowLeft" size={19} color="var(--ink)" />
              </button>
            )}
            <img src="/logo-wordmark-white.png" alt="RoverZoom" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {totalSteps > 0 && <span className="step-count">{step} / {totalSteps}</span>}
            {rightSlot}
          </div>
        </div>
        {totalSteps > 0 && (
          <div className="progress"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
        )}
        {children}
        {activeTab && <TabBar active={activeTab} onChange={onChangeTab} />}
      </div>
    </div>
  );
}
