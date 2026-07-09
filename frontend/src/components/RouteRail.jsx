// The signature component: pickup and dropoff joined by a dotted rail with a
// dot (○) at the top and a square (■) at the bottom — one journey, not two
// separate fields. Reused on review, confirm, and confirmation screens.
export default function RouteRail({ pickup, dropoff }) {
  return (
    <div className="route-rail">
      <div className="rail-track">
        <span className="rail-dot" />
        <span className="rail-line" />
        <span className="rail-square" />
      </div>
      <div className="rail-body">
        <div className="rail-slot top">
          <div className="rail-label">Pickup</div>
          <div className="rail-value">{pickup}</div>
        </div>
        <div className="rail-slot">
          <div className="rail-label">Dropoff</div>
          <div className="rail-value">{dropoff}</div>
        </div>
      </div>
    </div>
  );
}
