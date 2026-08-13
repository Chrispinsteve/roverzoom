import Icon from '../../components/Icon';

// Three ways to pay, each honest about when money moves. Card is only
// offered when Stripe is actually configured (payments config from the API);
// Zelle only when a recipient is set. Cash always works.
export default function PaymentCards({ method, onSelect, config }) {
  const cardEnabled = !!config?.cardEnabled;
  const zelleEnabled = !!config?.zelle;
  return (
    <div className="k-pay-cards">
      {cardEnabled && (
        <button className={`k-pay-card ${method === 'card' ? 'sel' : ''}`} onClick={() => onSelect('card')}>
          <span className="k-pay-icon"><Icon name="card" size={24} color="var(--ink)" /></span>
          <div>
            <h3>Card</h3>
            <p>Pay now, right here — Visa, Mastercard, Amex</p>
          </div>
        </button>
      )}
      {zelleEnabled && (
        <button className={`k-pay-card ${method === 'zelle' ? 'sel' : ''}`} onClick={() => onSelect('zelle')}>
          <span className="k-pay-icon"><Icon name="phone" size={24} color="var(--ink)" /></span>
          <div>
            <h3>Zelle</h3>
            <p>Send from your bank app — instructions after booking</p>
          </div>
        </button>
      )}
      <button className={`k-pay-card ${method === 'cash' ? 'sel' : ''}`} onClick={() => onSelect('cash')}>
        <span className="k-pay-icon"><Icon name="cash" size={24} color="var(--ink)" /></span>
        <div>
          <h3>Cash</h3>
          <p>Pay your driver the exact locked price at pickup</p>
        </div>
      </button>
    </div>
  );
}
