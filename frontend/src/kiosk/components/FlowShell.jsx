// Shared header for the light "flow" screens: back button, title, and a
// cumulative step-dot indicator (dots up to and including the current step
// are "on" — matches the approved kiosk mockup exactly).
//
// `footer` is a separate slot from `children`, rendered OUTSIDE the
// scrollable body region and pinned to the bottom of the screen. This
// guarantees the primary action (Continue, Confirm booking, etc.) is
// always visible without scrolling, no matter how much content is in the
// body on a short/landscape viewport — only the body scrolls internally,
// as a last-resort fallback, if its content still doesn't fit after fluid
// sizing.
export default function FlowShell({ title, step, totalSteps, onBack, children, footer }) {
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
        {footer && <div className="k-flow-footer">{footer}</div>}
      </section>
    </div>
  );
}
