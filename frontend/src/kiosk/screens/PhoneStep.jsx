import FlowShell from '../components/FlowShell';
import PhoneKeypad from '../components/PhoneKeypad';
import { fmtPhone } from '../lib/phone';

export default function PhoneStep({ booking, onChange, onNext, onBack }) {
  const digits = booking.phoneDigits || '';
  const canContinue = booking.name?.trim().length > 1 && digits.length === 10;

  return (
    <FlowShell title="Your details" step={2} totalSteps={3} onBack={onBack}>
      <span className="k-q">Who's riding?</span>
      <span className="k-q-sub">We'll text your confirmation to this number</span>

      <div className="field" style={{ marginTop: 16 }}>
        <label className="label">Name</label>
        <input
          className="input"
          placeholder="Your name"
          value={booking.name || ''}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>

      <span className="k-field-label">Phone number</span>
      <PhoneKeypad digits={digits} onChange={(d) => onChange({ phoneDigits: d, phone: fmtPhone(d) })} />

      <div className="k-footer-bar">
        <div className="k-footer-inner">
          <button className="k-next-btn" disabled={!canContinue} onClick={onNext}>Continue</button>
        </div>
      </div>
    </FlowShell>
  );
}
