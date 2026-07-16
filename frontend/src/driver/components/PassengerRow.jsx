import Icon from '../../components/Icon';
import Avatar from './Avatar';

// Rider identity row, reused across ride details / navigate / pickup / on-trip.
// Riders don't have accounts or ratings in this app — just the name + phone
// collected at booking — so this shows name only, with real tel:/sms: links
// (previously these were decorative, non-functional buttons).
export default function PassengerRow({ name, phone, right }) {
  return (
    <div className="drv-passenger-row">
      <Avatar name={name} size={46} />
      <div className="drv-passenger-info">
        <div className="drv-passenger-name">{name}</div>
      </div>
      {right ?? (
        <div className="drv-passenger-actions">
          <a className="drv-icon-btn" aria-label="Call rider" href={`tel:${phone}`}>
            <Icon name="phone" size={16} color="var(--ink)" />
          </a>
          <a className="drv-icon-btn" aria-label="Text rider" href={`sms:${phone}`}>
            <Icon name="message" size={16} color="var(--ink)" />
          </a>
        </div>
      )}
    </div>
  );
}
