import FlowShell from '../components/FlowShell';
import PhoneKeypad from '../components/PhoneKeypad';
import { fmtPhone } from '../lib/phone';

export default function PhoneStep({ booking, onChange, onNext, onBack }) {
  const digits = booking.phoneDigits || '';
  // Email stays OPTIONAL. It is what lets Stripe Link recognise a returning
  // rider and fill in their saved card, and it is what a receipt is sent to —
  // but making it mandatory would add a required field to a flow whose whole
  // promise is that no account is needed.
  const email = booking.email || '';
  const emailValid = email === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canContinue = booking.name?.trim().length > 1 && digits.length === 10 && emailValid;

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
      <span className="k-q-sub">We'll text your confirmation and tracking link here</span>

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

      {/* SMS consent, at the point the number is collected — which is where
          carriers and A2P reviewers require it to be, and where it is actually
          useful to the rider. States what we send, how often, that rates apply,
          and how to stop. */}
      <p className="k-consent">
        By booking, you agree to receive text messages about your ride — a confirmation, and a
        live tracking link when a driver accepts. About two messages per booking. Message and
        data rates may apply. Reply STOP to opt out, HELP for help. See our{' '}
        <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy&nbsp;Policy</a> and{' '}
        <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a>.
      </p>

      <div className="field" style={{ marginTop: 16 }}>
        <label className="label">Email <span className="k-hint-inline">optional</span></label>
        <input
          className="input"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => onChange({ email: e.target.value })}
        />
        <span className={emailValid ? 'k-hint' : 'k-hint k-hint-bad'}>
          {emailValid
            ? 'For your receipt — and so a saved card fills itself in next time.'
            : "That doesn't look like an email address."}
        </span>
      </div>
    </FlowShell>
  );
}
