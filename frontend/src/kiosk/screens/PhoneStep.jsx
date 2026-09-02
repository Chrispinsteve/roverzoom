import FlowShell from '../components/FlowShell';
import PhoneKeypad from '../components/PhoneKeypad';
import { fmtPhone } from '../lib/phone';
import { SMS_CONSENT_LABEL, SMS_CONSENT_FINE_PRINT, SMS_CONSENT_OPTIONAL_NOTE } from '../lib/terms';

export default function PhoneStep({ booking, onChange, onNext, onBack, step = 2, totalSteps = 3 }) {
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
    <FlowShell title="Your details" step={step} totalSteps={totalSteps} onBack={onBack} footer={footer}>
      <span className="k-q">Who's riding?</span>
      {/* Says why the number is needed WITHOUT promising a text.
          It previously read "We'll text your confirmation and tracking link
          here" — an unconditional promise of SMS sitting directly above an
          optional consent checkbox. A reviewer reads that as messaging being
          part of the service, which is the very thing error 30923 is about,
          and it is simply untrue for a rider who declines.
          The driver calling is true either way. */}
      <span className="k-q-sub">So your driver can reach you about this ride</span>

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

      {/* SMS CONSENT — a distinct checkbox, for messaging only, unchecked.

          What was here was a paragraph reading "By booking, you agree to
          receive text messages…". That is what got the A2P 10DLC campaign
          rejected under error 30923: it made consent a condition of using the
          service. Carriers require the opposite — a separate, deliberate,
          skippable action, and a booking that completes fine without it.

          It stays at the point the phone number is collected, because that is
          where the consent is meaningful and where reviewers look for it. */}
      <label className="k-optin">
        <input
          type="checkbox"
          className="k-optin-box"
          checked={Boolean(booking.smsConsent)}
          onChange={(e) => onChange({ smsConsent: e.target.checked })}
        />
        <span className="k-optin-text">
          <span className="k-optin-label">{SMS_CONSENT_LABEL}</span>
          <span className="k-optin-fine">
            {SMS_CONSENT_FINE_PRINT} See our{' '}
            <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy&nbsp;Policy</a> and{' '}
            <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a>.
          </span>
          <span className="k-optin-optional">{SMS_CONSENT_OPTIONAL_NOTE}</span>
        </span>
      </label>

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
