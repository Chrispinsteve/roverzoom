import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';

export default function CheckEmail({ email, onSwitchToLogin }) {
  return (
    <DriverShell>
      <div className="body">
        <div style={{ textAlign: 'center', marginTop: 40 }}>
          <div className="drv-check-pop">
            <Icon name="message" size={26} color="#fff" />
          </div>
          <h1 className="title" style={{ fontSize: 24 }}>Check your email</h1>
          <p className="subtitle">
            We sent a confirmation link to{' '}
            {email ? <strong style={{ color: 'var(--ink)' }}>{email}</strong> : 'your email'}.
            Click it to activate your account, then log in.
          </p>
        </div>
        <button className="btn" onClick={onSwitchToLogin} style={{ marginTop: 24 }}>
          Back to Log In
        </button>
      </div>
    </DriverShell>
  );
}
