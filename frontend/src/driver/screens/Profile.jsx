import { useEffect, useState } from 'react';
import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import Avatar from '../components/Avatar';
import { driverApi } from '../../lib/driverApi';
import { supabase } from '../../lib/supabaseClient';

const COLUMN_BY_TYPE = { photo: 'photo_url', license: 'license_photo_url', insurance: 'insurance_photo_url' };
const DOC_TYPES = [
  { type: 'photo', label: 'Profile photo', hint: "Riders see this once you're matched" },
  { type: 'license', label: "Driver's license", hint: 'Kept private — never shown to riders' },
  { type: 'insurance', label: 'Insurance', hint: 'Kept private — never shown to riders' },
];

function UploadRow({ docType, done, onUploaded }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputId = `drv-upload-${docType.type}`;

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file again later
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const { bucket, path, token } = await driverApi.getUploadUrl(docType.type);
      const { error: uploadErr } = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, file);
      if (uploadErr) throw uploadErr;
      const updatedDriver = await driverApi.saveDocument(docType.type, path);
      onUploaded(updatedDriver);
    } catch (err) {
      setError(err.message || 'Upload failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drv-doc-row">
      <div className="drv-doc-info">
        <div className="drv-doc-label">{docType.label}</div>
        <div className="drv-doc-hint" style={error ? { color: 'var(--danger)' } : undefined}>{error || docType.hint}</div>
      </div>
      {done ? (
        <span className="drv-doc-done"><Icon name="check" size={16} color="var(--positive)" stroke={3} /> Uploaded</span>
      ) : (
        <label className="btn btn-ghost drv-doc-upload-btn" htmlFor={inputId}>
          {busy ? 'Uploading…' : 'Upload'}
          <input id={inputId} type="file" accept="image/*" onChange={handleFile} disabled={busy} style={{ display: 'none' }} />
        </label>
      )}
    </div>
  );
}

// Driver payouts via Stripe Connect. Stripe hosts the bank/debit-card
// onboarding; here we only reflect status and hand off to that hosted flow.
function PayoutsSection() {
  const [status, setStatus] = useState(null); // null = loading
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    driverApi.getPayoutStatus().then(setStatus).catch(() => setStatus({ configured: false }));
  }, []);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const { url } = await driverApi.startPayoutOnboarding();
      window.location.href = url; // Stripe-hosted onboarding
    } catch (e) {
      setError(e.message || 'Could not start payout setup.');
      setBusy(false);
    }
  };

  if (!status || !status.configured) return null; // loading, or payouts not enabled server-side yet

  const enabled = status.payoutsEnabled;
  const inProgress = status.connected && !enabled;

  return (
    <div className="drv-payouts rise-2">
      <p className="eyebrow" style={{ marginTop: 24, marginBottom: 6 }}>Getting paid</p>
      {enabled ? (
        <div className="drv-doc-row">
          <div className="drv-doc-info">
            <div className="drv-doc-label">Payouts active</div>
            <div className="drv-doc-hint">You’re set to be paid to your bank or debit card.</div>
          </div>
          <span className="drv-doc-done"><Icon name="check" size={16} color="var(--positive)" stroke={3} /> Ready</span>
        </div>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
            {inProgress
              ? 'Your details are being verified — finish any remaining steps to start getting paid.'
              : 'Add your bank account or debit card to get paid. Secured by Stripe — your details never touch our servers.'}
          </p>
          <button className="btn" disabled={busy} onClick={start}>
            {busy ? 'Opening…' : inProgress ? 'Finish payout setup' : 'Set up payouts'}
          </button>
          {error && <p className="error-text" style={{ marginTop: 8 }}>{error}</p>}
        </>
      )}
    </div>
  );
}

export default function Profile({ driver, onDriverUpdate, onLogout, activeTab, onChangeTab }) {
  const doneCount = DOC_TYPES.filter((d) => !!driver[COLUMN_BY_TYPE[d.type]]).length;
  const complete = !!driver.profile_completed_at;

  return (
    <DriverShell activeTab={activeTab} onChangeTab={onChangeTab}>
      <div className="body">
        <h1 className="title rise" style={{ fontSize: 26 }}>Profile</h1>

        <div className="drv-profile rise-1">
          <Avatar name={driver.name} photoUrl={driver.photo_url} size={56} />
          <div>
            <div className="drv-profile-name">{driver.name}</div>
            <div className="drv-profile-meta">
              <span>★ {driver.rating}</span>
              {complete && (
                <span className="drv-verified"><Icon name="shieldCheck" size={13} color="var(--positive)" stroke={2} /> Verified Driver</span>
              )}
            </div>
          </div>
        </div>

        <div className="stat-strip rise-1" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <div className="stat" style={{ textAlign: 'left', padding: '14px 16px' }}>
            <div className="k">Vehicle</div>
            <div className="v" style={{ fontSize: 15 }}>{driver.vehicle_color} {driver.vehicle_make} {driver.vehicle_model}</div>
          </div>
          <div className="stat" style={{ textAlign: 'left', padding: '14px 16px' }}>
            <div className="k">Plate</div>
            <div className="v" style={{ fontSize: 15 }}>{driver.vehicle_plate}</div>
          </div>
        </div>

        <p className="eyebrow rise-2" style={{ marginTop: 22, marginBottom: 4 }}>
          Profile Completion — {doneCount} of 3
        </p>
        <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
          All three are required before you can see ride requests.
        </p>

        {DOC_TYPES.map((d) => (
          <UploadRow
            key={d.type}
            docType={d}
            done={!!driver[COLUMN_BY_TYPE[d.type]]}
            onUploaded={onDriverUpdate}
          />
        ))}

        <PayoutsSection />

        <div className="spacer" />

        <button className="btn btn-ghost rise-3" onClick={onLogout} style={{ marginTop: 24 }}>
          Log Out
        </button>
      </div>
    </DriverShell>
  );
}
