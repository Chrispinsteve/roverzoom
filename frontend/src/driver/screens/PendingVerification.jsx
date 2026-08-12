import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';

export default function PendingVerification({ onLogout }) {
  return (
    <DriverShell rightSlot={
      <button className="drv-icon-btn" aria-label="Log out" onClick={onLogout}>
        <Icon name="power" size={17} color="var(--ink)" />
      </button>
    }>
      <div className="body">
        <div style={{ textAlign: 'center', marginTop: 40 }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%', background: 'var(--canvas-2)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
          }}>
            <Icon name="clockCheck" size={28} color="var(--ink-2)" />
          </div>
          <h1 className="title" style={{ fontSize: 24 }}>Application under review</h1>
          <p className="subtitle">
            Thanks for applying. Our team is reviewing your details — we’ll notify you by email once your account is verified.
          </p>
        </div>
      </div>
    </DriverShell>
  );
}
