import Icon from '../components/Icon';

// Driver mode is always dark, regardless of the rider app's theme setting.
// Setting data-theme="dark" on this wrapper scopes every CSS variable used
// by the shared .stage/.btn/.summary/etc classes to the dark palette, since
// custom properties inherit down to descendants.
export default function DriverShell({ onBack, rightSlot, children }) {
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
          {rightSlot}
        </div>
        {children}
      </div>
    </div>
  );
}
