// The "AI is thinking" indicator the brief asked for: a smooth, dynamic
// animation (a wave of squares) shown while Claude processes a request.

export default function ThinkingDots() {
  const bars = [0, 1, 2, 3, 4];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '10px 2px' }}>
      {bars.map((i) => (
        <span
          key={i}
          style={{
            width: 8,
            height: 8,
            borderRadius: 3,
            background: 'var(--ink)',
            display: 'inline-block',
            animation: `rz-wave 1.1s ${i * 0.12}s infinite var(--ease)`,
          }}
        />
      ))}
      <style>{`
        @keyframes rz-wave {
          0%, 60%, 100% { transform: translateY(0) scaleY(1); opacity: 0.35; }
          30% { transform: translateY(-7px) scaleY(1.4); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
