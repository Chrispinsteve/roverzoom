import Icon from '../../components/Icon';

// A labelled input with a leading glyph. Lifted out of Signup so the Google
// "finish your profile" step can present the same fields the same way — a
// driver filling in their phone should not be able to tell which of the two
// routes they arrived by.
export default function IconField({ icon, label, ...inputProps }) {
  return (
    <div className="field">
      <label className="label">{label}</label>
      <div className="drv-input-icon-wrap">
        <Icon name={icon} size={16} color="var(--ink-4)" />
        <input className="input drv-input-with-icon" {...inputProps} />
      </div>
    </div>
  );
}
