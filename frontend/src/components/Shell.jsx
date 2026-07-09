export default function Shell({ step, totalSteps, children }) {
  const pct = totalSteps ? Math.round((step / totalSteps) * 100) : 0;
  return (
    <div className="app">
      <div className="stage">
        <div className="header">
          <img src="/logo-wordmark.png" alt="RoverZoom" />
          {totalSteps > 0 && <span className="step-count">Step {step} of {totalSteps}</span>}
        </div>
        {totalSteps > 0 && (
          <div className="progress"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
        )}
        {children}
      </div>
    </div>
  );
}
