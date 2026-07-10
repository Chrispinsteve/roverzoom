import { useEffect, useState } from 'react';

export default function Shell({ step, totalSteps, children, noPadHeader }) {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('rz-theme') || 'light';
    }
    return 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('rz-theme', theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  const pct = totalSteps ? Math.round((step / totalSteps) * 100) : 0;
  const logoSrc = theme === 'dark' ? '/logo-wordmark-white.png' : '/logo-wordmark.png';

  return (
    <div className="app">
      <div className="stage">
        <div className="header">
          <img src={logoSrc} alt="RoverZoom" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {totalSteps > 0 && <span className="step-count">Step {step} of {totalSteps}</span>}
            <button
              onClick={toggle}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              style={{
                width: 38, height: 38, borderRadius: 10,
                border: '1.5px solid var(--line-2)',
                background: 'var(--card)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', fontSize: 18,
              }}
            >
              {theme === 'light' ? '🌙' : '☀️'}
            </button>
          </div>
        </div>
        {totalSteps > 0 && (
          <div className="progress"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
        )}
        {children}
      </div>
    </div>
  );
}
