import Icon from '../../components/Icon';

// A stylized, schematic route illustration (not a real map — this app has no
// map tile provider wired up). Draws a road line between a start marker (car)
// and an end marker (square), with a couple of floating neighborhood labels,
// matching the look of the in-car navigation mockups.
export default function RouteMap({ height = 176, pathD, labels = [], carPos, squarePos, fabs = [] }) {
  return (
    <div className="drv-map" style={{ height }}>
      <svg viewBox="0 0 300 180" preserveAspectRatio="none" className="drv-map-svg">
        <path d={pathD} className="drv-map-route-shadow" />
        <path d={pathD} className="drv-map-route" />
      </svg>

      {labels.map((l) => (
        <span key={l.text} className="drv-map-label" style={{ top: l.top, left: l.left }}>{l.text}</span>
      ))}

      {carPos && (
        <span className="drv-map-car" style={{ top: carPos.top, left: carPos.left }}>
          <Icon name="car" size={15} color="#0c0d0f" stroke={2} />
        </span>
      )}
      {squarePos && <span className="drv-map-square" style={{ top: squarePos.top, left: squarePos.left }} />}

      {fabs.length > 0 && (
        <div className="drv-map-fabs">
          {fabs.map((f) => (
            <span className="drv-map-fab" key={f} aria-hidden="true">
              <Icon name={f} size={16} color="#fff" stroke={2} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
