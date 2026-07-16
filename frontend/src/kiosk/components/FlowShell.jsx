// Shared header for the light "flow" screens: back button, title, and a
// cumulative step-dot indicator (dots up to and including the current step
// are "on" — matches the approved kiosk mockup exactly).
export default function FlowShell({ title, step, totalSteps, onBack, children }) {
  return (
    <div className="kiosk-root">
      <section className="kiosk-screen k-flow">
        <div className="k-flow-head">
          <button className="k-back-btn" onClick={onBack} aria-label="Back">&larr;</button>
          <div className="k-flow-title">{title}</div>
          {totalSteps > 0 && (
            <div className="k-steps">
              {Array.from({ length: totalSteps }, (_, i) => (
                <span key={i} className={`k-dot ${i < step ? 'on' : ''}`} />
              ))}
            </div>
          )}
        </div>
        <div className="k-flow-body">{children}</div>
      </section>
    </div>
  );
}
