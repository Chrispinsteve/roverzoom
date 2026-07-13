import { useState } from 'react';
import DriverShell from '../DriverShell';
import { supabase } from '../../lib/supabaseClient';

// The trigger that creates the drivers row (handle_new_driver in schema.sql)
// raises two distinguishable errors on failure; map them to real copy rather
// than showing Supabase's generic "Database error saving new user".
function mapSignupError(message) {
  if (!message) return 'Something went wrong creating your account. Please try again.';
  const m = message.toLowerCase();
  if (m.includes('already_registered') || m.includes('already registered') || m.includes('duplicate') || m.includes('unique')) {
    return 'That email or phone number is already registered. Try logging in instead.';
  }
  if (m.includes('missing_required_driver_field') || m.includes('not null') || m.includes('not_null')) {
    return 'Please fill in all required fields.';
  }
  return message;
}

const emptyForm = {
  name: '', email: '', password: '', phone: '',
  vehicleMake: '', vehicleModel: '', vehicleColor: '', vehiclePlate: '',
};

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
        <h1 className="title" style={{ fontSize: 26 }}>Become a Driver</h1>
        <p className="subtitle">Apply to drive with RoverZoom.</p>

        <div className="field">
          <label className="label">Full name</label>
          <input className="input" placeholder="Alex Rivera" value={form.name} onChange={set('name')} />
        </div>
        <div className="field">
          <label className="label">Email</label>
          <input className="input" type="email" placeholder="you@example.com" value={form.email} onChange={set('email')} />
        </div>
        <div className="field">
          <label className="label">Password</label>
          <input className="input" type="password" placeholder="At least 8 characters" value={form.password} onChange={set('password')} />
        </div>
        <div className="field">
          <label className="label">Phone number</label>
          <input className="input" type="tel" placeholder="+1 555 555 0100" value={form.phone} onChange={set('phone')} />
        </div>

        <div className="field">
          <label className="label">Vehicle make</label>
          <input className="input" placeholder="Genesis" value={form.vehicleMake} onChange={set('vehicleMake')} />
        </div>
        <div className="field">
          <label className="label">Vehicle model</label>
          <input className="input" placeholder="G90" value={form.vehicleModel} onChange={set('vehicleModel')} />
        </div>
        <div className="field">
          <label className="label">Vehicle color</label>
          <input className="input" placeholder="Black" value={form.vehicleColor} onChange={set('vehicleColor')} />
        </div>
        <div className="field">
          <label className="label">License plate</label>
          <input className="input" placeholder="RZ-0001" value={form.vehiclePlate} onChange={set('vehiclePlate')} />
        </div>

        {error && <p className="error-text">{error}</p>}

        <button className="btn" disabled={!canSubmit || submitting} onClick={submit} style={{ marginTop: 8 }}>
          {submitting ? 'Creating account…' : 'Create Account'}
        </button>

        <p className="center muted" style={{ marginTop: 18, fontSize: 14 }}>
          Already have an account?{' '}
          <button onClick={onSwitchToLogin} style={{ color: 'var(--ink)', fontWeight: 600, textDecoration: 'underline' }}>
            Log in
          </button>
        </p>
      </div>
    </DriverShell>
  );
}
