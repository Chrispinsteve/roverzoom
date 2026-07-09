import Icon from '../components/Icon';

export default function Landing({ aiEnabled, onPickForm, onPickAI }) {
  return (
    <div className="body" style={{ justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <h1 className="title" style={{ fontSize: 38 }}>Where to?</h1>
        <p className="subtitle" style={{ marginBottom: 0 }}>
          Book a premium scheduled ride in under two minutes.
        </p>
      </div>

      <button className="option" onClick={onPickForm} style={{ padding: 22 }}>
        <span className="option-icon" style={{ background: 'var(--ink)' }}>
          <Icon name="form" size={22} color="#fff" />
        </span>
        <span className="option-body">
          <span className="option-title">Book with the form</span>
          <span className="option-sub">Enter pickup, destination, date & time</span>
        </span>
        <Icon name="arrowRight" size={20} color="var(--ink-4)" />
      </button>

      <button
        className="option"
        onClick={aiEnabled ? onPickAI : undefined}
        disabled={!aiEnabled}
        style={{ padding: 22, opacity: aiEnabled ? 1 : 0.5, cursor: aiEnabled ? 'pointer' : 'not-allowed' }}
      >
        <span className="option-icon" style={{ background: 'var(--canvas)' }}>
          <Icon name="sparkles" size={22} color="var(--ink)" />
        </span>
        <span className="option-body">
          <span className="option-title">
            Talk to the assistant {!aiEnabled && <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>· setup needed</span>}
          </span>
          <span className="option-sub">Speak naturally — “Pick me up at the office at 8am, going to JFK”</span>
        </span>
        <Icon name="arrowRight" size={20} color="var(--ink-4)" />
      </button>

      <p className="center muted" style={{ fontSize: 12.5, marginTop: 22 }}>
        No account required · Fixed fare, no surge
      </p>
    </div>
  );
}
