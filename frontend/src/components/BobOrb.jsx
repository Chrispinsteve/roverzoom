import { useMemo } from 'react';

// Bob — a living cloud of soft smoke, light particles, and moving gradients.
// Premium. Luxury. Alive. NOT a circle, NOT gaming neon.
//
// Built with layered blurred gradient blobs that drift independently on
// slow organic timings. Colors: muted blue, dusty purple, soft pink, warm white.
// The whole thing breathes — a gentle scale pulse that makes it feel alive.

const BLOBS = [
  // Each blob: position offset, size, colors, animation duration, direction
  { x: -12, y: -8,  w: 90,  h: 80,  colors: ['#7c8cf8', '#a78bfa'],     dur: 7,  delay: 0,   rotate: true },
  { x: 14,  y: -6,  w: 85,  h: 75,  colors: ['#c084fc', '#e879a8'],     dur: 9,  delay: 0.5, rotate: true, reverse: true },
  { x: -4,  y: 10,  w: 95,  h: 70,  colors: ['#93c5fd', '#a5b4fc'],     dur: 8,  delay: 1,   rotate: true },
  { x: 8,   y: -12, w: 70,  h: 65,  colors: ['#f0abfc', '#fda4af'],     dur: 10, delay: 1.5, rotate: true, reverse: true },
  { x: 0,   y: 0,   w: 60,  h: 55,  colors: ['rgba(255,255,255,0.7)', 'rgba(255,255,255,0.15)'], dur: 5, delay: 0, rotate: false },
];

// Floating particles — tiny bright dots that drift upward slowly
function Particles({ active }) {
  const particles = useMemo(() =>
    Array.from({ length: 16 }, (_, i) => ({
      id: i,
      x: (Math.random() - 0.5) * 80,
      delay: Math.random() * 4,
      dur: 3 + Math.random() * 3,
      size: 2 + Math.random() * 2.5,
      color: ['#c4b5fd','#fbcfe8','#bfdbfe','#e9d5ff','#fecdd3','#ddd6fe','#e0e7ff','#fff','#c7d2fe','#fce7f3','#a5b4fc','#f9a8d4','#bae6fd','#d8b4fe','#fda4af','#e2e8f0'][i],
    })),
  []);

  return particles.map((p) => (
    <span
      key={p.id}
      style={{
        position: 'absolute',
        width: p.size,
        height: p.size,
        borderRadius: '50%',
        background: p.color,
        left: `calc(50% + ${p.x}px)`,
        top: '50%',
        opacity: active ? 0.9 : 0.55,
        animation: `bob-float ${p.dur}s ${p.delay}s ease-in-out infinite`,
        pointerEvents: 'none',
      }}
    />
  ));
}

export default function BobOrb({ state = 'idle', onClick }) {
  const active = state !== 'idle';
  const breathing = active ? 'bob-breathe-active' : 'bob-breathe';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <button
        onClick={onClick}
        aria-label="Talk to Bob"
        style={{
          position: 'relative',
          width: 100,
          height: 80,
          border: 'none',
          background: 'transparent',
          cursor: onClick ? 'pointer' : 'default',
          animation: `${breathing} 4s ease-in-out infinite`,
        }}
      >
        {/* Smoke blobs */}
        {BLOBS.map((blob, i) => (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: `calc(50% + ${blob.x}px - ${blob.w / 2}px)`,
              top: `calc(50% + ${blob.y}px - ${blob.h / 2}px)`,
              width: blob.w,
              height: blob.h,
              borderRadius: '42% 58% 55% 45% / 48% 42% 58% 52%',
              background: `radial-gradient(ellipse at ${30 + i * 10}% ${40 + i * 8}%, ${blob.colors[0]}, ${blob.colors[1]} 70%, transparent)`,
              filter: `blur(${active ? 16 : 20}px)`,
              opacity: active ? 0.75 : 0.55,
              animation: `bob-drift-${i} ${blob.dur}s ${blob.delay}s ease-in-out infinite ${blob.reverse ? 'reverse' : ''}`,
              mixBlendMode: i === BLOBS.length - 1 ? 'overlay' : 'normal',
              pointerEvents: 'none',
              transition: 'opacity 0.6s ease, filter 0.6s ease',
            }}
          />
        ))}

        {/* Light particles */}
        <Particles active={active} />
      </button>

      {/* Label */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Talk to Bob</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-4)', marginTop: 2 }}>Your AI Ride Assistant</div>
      </div>

      <style>{`
        @keyframes bob-breathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.04); }
        }
        @keyframes bob-breathe-active {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
        @keyframes bob-float {
          0%, 100% { transform: translateY(0) scale(1); opacity: 0.4; }
          50% { transform: translateY(-24px) scale(1.2); opacity: 0.8; }
        }
        @keyframes bob-drift-0 {
          0%, 100% { transform: translate(0, 0) rotate(0deg) scale(1); }
          33% { transform: translate(6px, -4px) rotate(8deg) scale(1.06); }
          66% { transform: translate(-4px, 5px) rotate(-5deg) scale(0.97); }
        }
        @keyframes bob-drift-1 {
          0%, 100% { transform: translate(0, 0) rotate(0deg) scale(1); }
          33% { transform: translate(-7px, 3px) rotate(-6deg) scale(1.04); }
          66% { transform: translate(5px, -6px) rotate(10deg) scale(0.95); }
        }
        @keyframes bob-drift-2 {
          0%, 100% { transform: translate(0, 0) rotate(0deg) scale(1); }
          33% { transform: translate(4px, 6px) rotate(5deg) scale(1.05); }
          66% { transform: translate(-6px, -3px) rotate(-8deg) scale(0.96); }
        }
        @keyframes bob-drift-3 {
          0%, 100% { transform: translate(0, 0) rotate(0deg) scale(1); }
          33% { transform: translate(-5px, -5px) rotate(-7deg) scale(1.03); }
          66% { transform: translate(7px, 4px) rotate(6deg) scale(0.98); }
        }
        @keyframes bob-drift-4 {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.5; }
          50% { transform: translate(2px, -2px) scale(1.08); opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}
