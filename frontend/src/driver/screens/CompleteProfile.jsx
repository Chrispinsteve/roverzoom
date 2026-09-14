import { useState } from 'react';
import DriverShell from '../DriverShell';
import IconField from '../components/IconField';
import { supabase } from '../../lib/supabaseClient';
import { driverApi } from '../../lib/driverApi';

// ============================================================
// CompleteProfile — the second half of a Google signup
// ============================================================
// Google gives us an email and a name. It never gives a phone number, and
// drivers.phone is NOT NULL because dispatch has to be able to reach the person
// driving. So an OAuth account arrives authenticated but incomplete, and the
// signup trigger deliberately leaves the driver row uncreated rather than
// inventing one.
//
// This is where the rest comes from. It replaces a dead-end that used to read
// "We couldn't find a driver profile for this account. Contact support" — which
// was the correct message for a genuinely broken account and exactly the wrong
// one for somebody who had just signed up successfully.
//
// The values go into the auth user's own metadata first, then ensure-profile
// builds the row from that same whitelist the trigger uses. One definition of
// what a driver row is made of, not two.

const SMS_CONSENT_VERSION = 'driver-sms-2026-09-02.v1';

export default function CompleteProfile({ session, onDone, onLogout }) {
  const googleName = session?.user?.user_metadata?.full_name
    || session?.user?.user_metadata?.name || '';
  const [form, setForm] = useState({
    name: googleName, phone: '',
    vehicleMake: '', vehicleModel: '', vehicleColor: '', vehiclePlate: '',
    smsConsent: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const ready = form.name.trim() && form.phone.trim();

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true); setError('');
    try {
      // Written to the auth user first so ensure-profile — and the trigger, on
      // any future account — read the same source. Storing it only in a request
      // body would give the two paths different ideas of the truth.
      const { error: metaErr } = await supabase.auth.updateUser({
        data: {
          name: form.name.trim(),
          phone: form.phone.trim(),
          vehicle_make: form.vehicleMake.trim(),
          vehicle_model: form.vehicleModel.trim(),
          vehicle_color: form.vehicleColor.trim(),
          vehicle_plate: form.vehiclePlate.trim(),
          sms_consent: form.smsConsent ? 'true' : 'false',
          sms_consent_version: SMS_CONSENT_VERSION,
        },
      });
      if (metaErr) throw metaErr;

      const res = await driverApi.ensureProfile();
      if (!res?.driver) throw new Error('We could not finish setting up your profile.');
      onDone(res.driver);
    } catch (e) {
      const msg = String(e.message || '');
      setError(
        /already registered|duplicate|unique/i.test(msg)
          ? 'That phone number is already on another driver account. Log in with that one, or use a different number.'
          : msg || 'Something went wrong. Try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <DriverShell>
      <div className="body">
        <h1 style={{ marginTop: 8 }}>Almost there</h1>
        <p className="drv-card-sub" style={{ marginBottom: 18 }}>
          Signed in as {session?.user?.email}. We need a few details before you can drive.
        </p>

        <IconField icon="user" label="Full name" value={form.name} onChange={set('name')} placeholder="Alex Rivera" />
        <IconField icon="phone" label="Phone number" type="tel" value={form.phone} onChange={set('phone')} placeholder="+1 555 555 0100" />

        <label className="drv-optin">
          <input
            type="checkbox"
            className="drv-optin-box"
            checked={form.smsConsent}
            onChange={(e) => setForm((f) => ({ ...f, smsConsent: e.target.checked }))}
          />
          <span className="drv-optin-text">
            <span className="drv-optin-label">Text me about ride requests and schedule changes.</span>
            <span className="drv-optin-fine">
              Only when push notifications are unavailable on your phone. Message and data rates may
              apply. Reply STOP to opt out, HELP for help.
            </span>
            <span className="drv-optin-optional">Optional. You can drive without this.</span>
          </span>
        </label>

        <p className="drv-card-sub" style={{ marginTop: 20, marginBottom: 8 }}>
          Your vehicle — you can add this later from your profile.
        </p>
        <IconField icon="car" label="Make" value={form.vehicleMake} onChange={set('vehicleMake')} placeholder="Toyota" />
        <IconField icon="car" label="Model" value={form.vehicleModel} onChange={set('vehicleModel')} placeholder="RAV4" />
        <IconField icon="car" label="Color" value={form.vehicleColor} onChange={set('vehicleColor')} placeholder="White" />
        <IconField icon="car" label="Plate" value={form.vehiclePlate} onChange={set('vehiclePlate')} placeholder="ABC1234" />

        {error && <p className="error-text" style={{ marginTop: 14 }}>{error}</p>}

        <button className="btn" onClick={submit} disabled={!ready || busy} style={{ marginTop: 18 }}>
          {busy ? 'Setting up…' : 'Finish setup'}
        </button>
        <button className="btn btn-ghost" onClick={onLogout} style={{ marginTop: 10 }}>Log out</button>
      </div>
    </DriverShell>
  );
}
