import Icon from '../../components/Icon';
import Avatar from './Avatar';

// Rider identity row, reused across ride details / navigate / pickup / on-trip.
// Riders don't have accounts or ratings in this app — just the name + phone
// collected at booking — so this shows name only, with real tel:/sms: links
// (previously these were decorative, non-functional buttons).
export default function PassengerRow({ name, phone, right, compact }) {
  // Normalised, so the dialler always gets E.164 rather than whatever shape
  // the number was stored in. Riders type ten digits on a keypad and it is
  // saved formatted — "(561) 555-0142" — which most diallers cope with and
  // some mangle. null when there is no usable number, so the buttons are
  // omitted rather than rendered dead.
  const digits = String(phone || '').replace(/\D/g, '');
  const dial = digits.length === 10 ? `+1${digits}` : digits.length > 10 ? `+${digits}` : null;
  return (
    <div className={compact ? "drv-passenger-row compact" : "drv-passenger-row"}>
      <Avatar name={name} size={compact ? 34 : 46} />
      <div className="drv-passenger-info">
        <div className="drv-passenger-name">{name}</div>
      </div>
      {right ?? (dial && (
        <div className="drv-passenger-actions">
          <a className="drv-icon-btn" aria-label={`Call ${name || 'rider'}`} href={`tel:${dial}`}>
            <Icon name="phone" size={16} color="var(--ink)" />
          </a>
          <a className="drv-icon-btn" aria-label={`Text ${name || 'rider'}`} href={`sms:${dial}`}>
            <Icon name="message" size={16} color="var(--ink)" />
          </a>
        </div>
      ))}
    </div>
  );
}
