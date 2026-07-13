import { useState } from 'react';
import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import { supabase } from '../../lib/supabaseClient';

// The trigger that creates the drivers row (handle_new_driver in schema.sql)
// raises two distinguishable errors on failure, but GoTrue often wraps the
// real Postgres error in a generic/empty body rather than forwarding the
// message verbatim — so this only ever shows either specific, recognized
// copy or a safe generic fallback, never the raw error text (which might be
// "{}", a stack trace, etc.).
function mapSignupError(message) {
  const m = (message || '').toLowerCase();
  if (m.includes('already_registered') || m.includes('already registered') || m.includes('duplicate') || m.includes('unique')) {
    return 'That email or phone number is already registered. Try logging in instead.';
  }
  if (m.includes('missing_required_driver_field') || m.includes('not null') || m.includes('not_null')) {
    return 'Please fill in all required fields.';
  }
  if (m.includes('password')) {
    return message; // e.g. "Password should be at least 6 characters" — genuinely useful as-is
  }
  return 'Something went wrong creating your account. Please try again in a moment.';
}

const emptyForm = {
  name: '', email: '', password: '', phone: '',
  vehicleMake: '', vehicleModel: '', vehicleColor: '', vehiclePlate: '',
};

// A guided, one-thing-at-a-time application — the same shape as Airbnb's
// host onboarding: small focused steps, a progress bar, warm copy, and a
// clear "here's what happens next" before the final submit.
const STEPS = ['identity', 'account', 'vehicle'];

function IconField({ icon, label, ...inputProps }) {
  return (
    <div className="field">
      <label className="label">{label}</label>
      <div className="drv-input-icon-wrap">
        <Icon name={icon} size={16} color="var(--ink-4)" />
        <input className="input drv-input-with-icon" {...inputProps} />
      </div>
    </div>
  );
}

function StepHero({ icon }) {
  return (
    <div className="drv-signup-hero rise">
      <div className="drv-signup-glow" />
      <div className="drv-signup-mark">
        <Icon name={icon} size={28} color="#fff" stroke={1.8} />
      </div>
    </div>
  );
}

export default function Signup({ onSwitchToLogin, onSignedUp }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const step = STEPS[stepIdx];
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const canContinue = () => {
    if (step === 'identity') return form.name.trim() && form.phone.trim();
    if (step === 'account') return form.email.trim() && form.password.length >= 8;
    if (step === 'vehicle') return form.vehicleMake.trim() && form.vehicleModel.trim() && form.vehicleColor.trim() && form.vehiclePlate.trim();
    return false;
  };

  const next = () => { setError(''); setStepIdx((i) => Math.min(i + 1, STEPS.length - 1)); };
  const back = () => {
    setError('');
    if (stepIdx === 0) onSwitchToLogin();
    else setStepIdx((i) => i - 1);
  };

  const submit = async () => {
    if (!canContinue() || submitting) return;
    setSubmitting(true);
    setError('');
    const { error } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          name: form.name.trim(),
          phone: form.phone.trim(),
          vehicle_make: form.vehicleMake.trim(),
          vehicle_model: form.vehicleModel.trim(),
          vehicle_color: form.vehicleColor.trim(),
          vehicle_plate: form.vehiclePlate.trim(),
        },
      },
    });
    setSubmitting(false);
    if (error) {
      // Log the raw error during active debugging — the trigger's new
      // catch-all handler (schema.sql) now embeds the real Postgres cause
      // directly in this message, so check the browser console first before
      // digging through Supabase logs.
      console.error('signUp failed:', error.message, error);
      setError(mapSignupError(error.message));
      return;
    }
    onSignedUp(form.email.trim());
  };

  return (
    <DriverShell onBack={back} step={stepIdx + 1} totalSteps={STEPS.length}>
      <div className="body">
        {step === 'identity' && (
          <>
            <StepHero icon="user" />
            <h1 className="title center rise-1" style={{ fontSize: 25 }}>Let’s get to know you</h1>
            <p className="subtitle center rise-1">We’ll use this to set up your driver profile.</p>
            <div className="rise-2">
              <IconField icon="user" label="Full name" placeholder="Alex Rivera" value={form.name} onChange={set('name')} />
              <IconField icon="phone" label="Phone number" type="tel" placeholder="+1 555 555 0100" value={form.phone} onChange={set('phone')} />
            </div>
          </>
        )}

        {step === 'account' && (
          <>
            <StepHero icon="lock" />
            <h1 className="title center rise-1" style={{ fontSize: 25 }}>Set up your account</h1>
            <p className="subtitle center rise-1">This is how you’ll log in every time you drive.</p>
            <div className="rise-2">
              <IconField icon="mail" label="Email" type="email" placeholder="you@example.com" value={form.email} onChange={set('email')} />
              <IconField icon="lock" label="Password" type="password" placeholder="At least 8 characters" value={form.password} onChange={set('password')} />
            </div>
          </>
        )}

        {step === 'vehicle' && (
          <>
            <StepHero icon="car" />
            <h1 className="title center rise-1" style={{ fontSize: 25 }}>Tell us about your ride</h1>
            <p className="subtitle center rise-1">Riders will see this when you arrive to pick them up.</p>
            <div className="drv-field-grid rise-2">
              <div className="field">
                <label className="label">Make</label>
                <input className="input" placeholder="Genesis" value={form.vehicleMake} onChange={set('vehicleMake')} />
              </div>
              <div className="field">
                <label className="label">Model</label>
                <input className="input" placeholder="G90" value={form.vehicleModel} onChange={set('vehicleModel')} />
              </div>
              <div className="field">
                <label className="label">Color</label>
                <input className="input" placeholder="Black" value={form.vehicleColor} onChange={set('vehicleColor')} />
              </div>
              <div className="field">
                <label className="label">License plate</label>
                <input className="input" placeholder="RZ-0001" value={form.vehiclePlate} onChange={set('vehiclePlate')} />
              </div>
            </div>
            <p className="muted rise-2" style={{ fontSize: 13, lineHeight: 1.6, marginTop: 4 }}>
              After you submit, our team reviews every application — we’ll email you as soon as you’re approved to start driving.
            </p>
          </>
        )}

        {error && <p className="error-text">{error}</p>}

        <div className="spacer" />

        <button
          className="btn rise-3"
          disabled={!canContinue() || submitting}
          onClick={step === 'vehicle' ? submit : next}
          style={{ marginTop: 8 }}
        >
          {step === 'vehicle' ? (submitting ? 'Submitting…' : 'Submit Application') : 'Continue'}
        </button>

        {step === 'identity' && (
          <p className="center muted rise-3" style={{ marginTop: 18, fontSize: 14 }}>
            Already have an account?{' '}
            <button onClick={onSwitchToLogin} style={{ color: 'var(--ink)', fontWeight: 600, textDecoration: 'underline' }}>
              Log in
            </button>
          </p>
        )}
      </div>
    </DriverShell>
  );
}
