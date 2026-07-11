import Icon from '../../components/Icon';

// The "head to pickup" / "continue straight" turn-by-turn style banner used
// on the navigate and on-trip screens.
export default function InstructionBanner({ icon, title, meta, lines = [] }) {
  return (
    <div className="drv-instruction">
      <span className="drv-instruction-icon">
        <Icon name={icon} size={21} color="#0c0d0f" stroke={2.2} />
      </span>
      <div className="drv-instruction-body">
        <div className="drv-instruction-row">
          <span className="drv-instruction-title">{title}</span>
          {meta && <span className="drv-instruction-meta">{meta}</span>}
        </div>
        {lines.map((line) => (
          <div className="drv-instruction-line" key={line}>{line}</div>
        ))}
      </div>
    </div>
  );
}
