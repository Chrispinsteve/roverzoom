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

function SectionHeader({ icon, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '22px 0 14px' }}>
      <Icon name={icon} size={14} color="var(--ink-4)" />
      <span className="eyebrow">{children}</span>
      <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
    </div>
  );
}

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

export default function Signup({ onSwitchToLogin, onSignedUp }) {
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const canSubmit = form.name.trim() && form.email.trim() && form.password.length >= 8
    && form.phone.trim() && form.vehicleMake.trim() && form.vehicleModel.trim()
    && form.vehicleColor.trim() && form.vehiclePlate.trim();

  const submit = async () => {
    if (!canSubmit || submitting) return;
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
    if (error) { setError(mapSignupError(error.message)); return; }
    onSignedUp(form.email.trim());
  };

  return (
    <DriverShell onBack={onSwitchToLogin}>
      <div className="body">
        <div className="drv-signup-hero rise">
          <div className="drv-signup-glow" />
          <div className="drv-signup-mark">
            <img src="/logo-mark.png" alt="" className="drv-signup-mark-img" />
          </div>
        </div>

        <h1 className="title center rise-1" style={{ fontSize: 25 }}>Become a Driver</h1>
        <p className="subtitle center rise-1" style={{ marginBottom: 8 }}>
          Join RoverZoom's driver network — apply in a couple of minutes.
        </p>

        <div className="rise-1">
          <SectionHeader icon="user">Your Details</SectionHeader>
          <IconField icon="user" label="Full name" placeholder="Alex Rivera" value={form.name} onChange={set('name')} />
          <IconField icon="mail" label="Email" type="email" placeholder="you@example.com" value={form.email} onChange={set('email')} />
          <IconField icon="lock" label="Password" type="password" placeholder="At least 8 characters" value={form.password} onChange={set('password')} />
          <IconField icon="phone" label="Phone number" type="tel" placeholder="+1 555 555 0100" value={form.phone} onChange={set('phone')} />
        </div>

        <div className="rise-2">
          <SectionHeader icon="car">Your Vehicle</SectionHeader>
          <div className="drv-field-grid">
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
        </div>

        {error && <p className="error-text">{error}</p>}

        <button className="btn rise-3" disabled={!canSubmit || submitting} onClick={submit} style={{ marginTop: 8 }}>
          {submitting ? 'Creating account…' : 'Create Account'}
        </button>

        <p className="center muted rise-3" style={{ marginTop: 18, fontSize: 14 }}>
          Already have an account?{' '}
          <button onClick={onSwitchToLogin} style={{ color: 'var(--ink)', fontWeight: 600, textDecoration: 'underline' }}>
            Log in
          </button>
        </p>
      </div>
    </DriverShell>
  );
}
