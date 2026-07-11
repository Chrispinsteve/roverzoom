export default function Avatar({ name, size = 48 }) {
  const initials = name.split(' ').filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div
      style={{
        width: size, height: size, minWidth: size, borderRadius: '50%',
        background: 'var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: Math.round(size * 0.36), color: 'var(--ink)', flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}
