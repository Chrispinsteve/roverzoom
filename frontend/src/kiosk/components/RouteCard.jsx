import AddressInput from '../../components/AddressInput';

// Wraps the existing (already real-geocoding) AddressInput in the new
// route-card/rail visual. `pickupKey`/`dropoffKey` force AddressInput to
// remount and re-read its initial text ONLY when the address is set from
// OUTSIDE typing (a destination chip or the "This trip" GPS button) — the
// parent bumps these nonces itself and leaves them alone for AddressInput's
// own dropdown picks. A remount on every pick (e.g. keying off the address
// text directly) re-triggers AddressInput's mount-time search effect, which
// clobbers the just-picked lat/lng with a coordinate-less re-search.
export default function RouteCard({ pickup, dropoff, onPickup, onDropoff, onThisTrip, locating, pickupKey, dropoffKey }) {
  return (
    <div className="k-route-card">
      <div className="k-r-row">
        <span className="k-rail">
          <span className="k-pin k-pin-o" />
          <span className="k-rail-line" />
        </span>
        <div className="k-r-field">
          <span className="k-r-cap">Pickup</span>
          <AddressInput
            key={pickupKey}
            iconName="pin"
            placeholder="Street address"
            value={pickup}
            onSelect={onPickup}
          />
        </div>
        <button className="k-r-action" onClick={onThisTrip} disabled={locating}>
          {locating ? 'Locating…' : 'This trip'}
        </button>
      </div>
      <div className="k-r-div" />
      <div className="k-r-row">
        <span className="k-rail"><span className="k-pin k-pin-f" /></span>
        <div className="k-r-field">
          <span className="k-r-cap">Destination</span>
          <AddressInput
            key={dropoffKey}
            iconName="flag"
            placeholder="Where you're headed"
            value={dropoff}
            onSelect={onDropoff}
          />
        </div>
      </div>
    </div>
  );
}
