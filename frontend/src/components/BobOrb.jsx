import { useState } from 'react';

// Bob — the AI booking assistant. Visual: a realistic floating cosmic cloud
// (nebula/exploding star) with shifting colors. It pulses gently when idle,
// intensifies when active (listening/thinking/speaking).
//
// The effect uses layered radial gradients with CSS animation — no canvas,
// no external libraries, pure CSS. Colors shift through blues, purples,
// pinks, and golds like a nebula.

export default function BobOrb({ state = 'idle', onClick }) {
  const [hovered, setHovered] = useState(false);
  const active = state !== 'idle';
  const label = {
    idle: 'Talk to Bob',
    listening: 'Listening…',
    thinking: 'Thinking…',
    speaking: 'Bob is speaking…',
  }[state] || 'Talk to Bob';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <button
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label={label}
        style={{
          position: 'relative',
          width: active ? 110 : 90,
          height: active ? 110 : 90,
          borderRadius: '50%',
          border: 'none',
          cursor: 'pointer',
          background: 'transparent',
          transition: 'width 0.4s var(--ease), height 0.4s var(--ease)',
          transform: hovered && !active ? 'scale(1.08)' : 'none',
        }}
      >
        {/* Cosmic cloud layers */}
        <span style={{
          position: 'absolute', inset: -8, borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 40%, #7c3aed, #3b82f6 40%, #06b6d4 70%, transparent)',
          filter: `blur(${active ? 14 : 10}px)`,
          opacity: active ? 0.9 : 0.7,
          animation: 'bob-rotate 6s linear infinite',
        }} />
        <span style={{
          position: 'absolute', inset: -6, borderRadius: '50%',
          background: 'radial-gradient(circle at 65% 60%, #ec4899, #f59e0b 45%, #8b5cf6 80%, transparent)',
          filter: `blur(${active ? 16 : 12}px)`,
          opacity: active ? 0.85 : 0.6,
          animation: 'bob-rotate 8s linear infinite reverse',
        }} />
        <span style={{
          position: 'absolute', inset: -4, borderRadius: '50%',
          background: 'radial-gradient(circle at 50% 50%, #f472b6, #a78bfa 50%, #38bdf8 90%, transparent)',
          filter: `blur(${active ? 12 : 8}px)`,
          opacity: active ? 0.75 : 0.5,
          animation: 'bob-pulse 3s ease-in-out infinite',
        }} />
        {/* Core glow */}
        <span style={{
          position: 'absolute', inset: '15%', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.4) 40%, transparent 70%)',
          animation: active ? 'bob-core-active 1.5s ease-in-out infinite' : 'bob-core 4s ease-in-out infinite',
        }} />

        {/* Sparkle particles when active */}
        {active && [0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} style={{
            position: 'absolute',
            width: 3, height: 3, borderRadius: '50%',
            background: ['#f472b6', '#a78bfa', '#38bdf8', '#fbbf24', '#34d399', '#f87171'][i],
            top: '50%', left: '50%',
            animation: `bob-particle 2s ${i * 0.3}s ease-out infinite`,
          }} />
        ))}
      </button>

      <span style={{
        fontSize: 13, fontWeight: 600, color: 'var(--ink-3)',
        animation: active ? 'rz-rise 0.3s var(--ease) both' : 'none',
      }}>
        {label}
      </span>

      <style>{`
        @keyframes bob-rotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes bob-pulse {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.12); opacity: 0.8; }
        }
        @keyframes bob-core {
          0%, 100% { transform: scale(0.9); opacity: 0.7; }
          50% { transform: scale(1.05); opacity: 1; }
        }
        @keyframes bob-core-active {
          0%, 100% { transform: scale(0.85); opacity: 0.8; }
          50% { transform: scale(1.15); opacity: 1; }
        }
        @keyframes bob-particle {
          0% { transform: translate(0, 0) scale(1); opacity: 1; }
          100% { transform: translate(${Math.random() > 0.5 ? '' : '-'}${20 + Math.random() * 30}px, -${30 + Math.random() * 40}px) scale(0); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
