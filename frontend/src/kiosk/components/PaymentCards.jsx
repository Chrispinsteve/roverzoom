import Icon from '../../components/Icon';

// Visual stub — no real Stripe/payment integration exists yet, so the copy
// deliberately avoids naming a processor that isn't actually wired up.
export default function PaymentCards({ method, onSelect }) {
  return (
    <div className="k-pay-cards">
      <button className={`k-pay-card ${method === 'card' ? 'sel' : ''}`} onClick={() => onSelect('card')}>
        <span className="k-pay-icon"><Icon name="card" size={24} color="var(--ink)" /></span>
        <div>
          <h3>Card</h3>
          <p>Secure checkout at pickup</p>
        </div>
      </button>
      <button className={`k-pay-card ${method === 'cash' ? 'sel' : ''}`} onClick={() => onSelect('cash')}>
        <span className="k-pay-icon"><Icon name="cash" size={24} color="var(--ink)" /></span>
        <div>
          <h3>Cash</h3>
          <p>Pay your driver directly</p>
        </div>
      </button>
    </div>
  );
}
