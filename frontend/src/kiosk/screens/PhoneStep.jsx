import FlowShell from '../components/FlowShell';
import PhoneKeypad from '../components/PhoneKeypad';
import { fmtPhone } from '../lib/phone';

export default function PhoneStep({ booking, onChange, onNext, onBack }) {
  const digits = booking.phoneDigits || '';
  const canContinue = booking.name?.trim().length > 1 && digits.length === 10;

  const footer = (
    <div className="k-footer-bar">
      <div className="k-footer-inner">
        <button className="k-next-btn" disabled={!canContinue} onClick={onNext}>Continue</button>
      </div>
    </div>
  );

  return (
    <FlowShell title="Your details" step={2} totalSteps={3} onBack={onBack} footer={footer}>
      <span className="k-q">Who's riding?</span>
      {/* No SMS provider is wired up yet — doesn't claim a text will be sent. */}
      <span className="k-q-sub">We'll use this number to identify your ride</span>

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
    </FlowShell>
  );
}
