import Icon from '../../components/Icon';
import Avatar from './Avatar';

// Passenger identity row, reused across ride details / navigate / pickup / on-trip.
// Pass `right` to replace the call/message buttons with custom content (e.g. ETA).
export default function PassengerRow({ passenger, right }) {
  return (
    <div className="drv-passenger-row">
      <Avatar name={passenger.name} size={46} />
      <div className="drv-passenger-info">
        <div className="drv-passenger-name">{passenger.name}</div>
        <div className="drv-passenger-rating">★ {passenger.rating}</div>
      </div>
      {right ?? (
        <div className="drv-passenger-actions">
          <button className="drv-icon-btn" aria-label="Call passenger">
            <Icon name="phone" size={16} color="var(--ink)" />
          </button>
          <button className="drv-icon-btn" aria-label="Message passenger">
            <Icon name="message" size={16} color="var(--ink)" />
          </button>
        </div>
      )}
    </div>
  );
}
