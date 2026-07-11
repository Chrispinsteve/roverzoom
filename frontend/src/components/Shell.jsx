import { useEffect, useState } from 'react';
import Icon from './Icon';

export default function Shell({ step, totalSteps, children }) {
  const [theme, setTheme] = useState(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.getAttribute('data-theme') || 'light';
    }
    return 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('rz-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0c0d0f' : '#f4f4f5');
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
            {totalSteps > 0 && <span className="step-count">{step} / {totalSteps}</span>}
            <button
              onClick={toggle}
              className="theme-toggle"
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            >
              <Icon
                name={theme === 'light' ? 'moon' : 'sun'}
                size={20}
                color="var(--ink)"
                stroke={1.8}
              />
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
