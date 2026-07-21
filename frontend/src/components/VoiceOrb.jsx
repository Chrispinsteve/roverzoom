import { useEffect, useRef } from 'react';

// The RoverZoom assistant sphere — a glowing core wrapped in orbiting particle
// rings, rendered on canvas. Drive it with the `state` prop; it eases between
// four looks so the rider can read what it's doing from across a dark car.
const STATES = {
  idle:      { spin: 0.16, scale: 1.00, bright: 0.55, core: 1.00, pulse: 0.00 },
  listening: { spin: 0.42, scale: 1.14, bright: 1.00, core: 1.35, pulse: 0.06 },
  thinking:  { spin: 0.78, scale: 0.82, bright: 0.72, core: 0.85, pulse: 0.00 },
  speaking:  { spin: 0.24, scale: 1.06, bright: 1.00, core: 1.25, pulse: 0.55 },
};

export default function VoiceOrb({ state = 'idle', size = 220 }) {
  const canvasRef = useRef(null);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W, H, cx, cy, R;

    function resize() {
      const s = canvas.clientWidth || size;
      W = canvas.width = Math.round(s * DPR);
      H = canvas.height = Math.round(s * DPR);
      cx = W / 2; cy = H / 2; R = Math.min(W, H) * 0.33;
    }

    const particles = [];
    const RINGS = 9, PER = 58;
    for (let i = 0; i < RINGS; i++) {
      const tiltX = Math.random() * Math.PI;
      const tiltZ = Math.random() * Math.PI;
      const r = 0.5 + Math.random() * 0.6;
      const speed = (0.25 + Math.random() * 0.6) * (Math.random() < 0.5 ? 1 : -1);
      for (let j = 0; j < PER; j++) {
        particles.push({ a: Math.random() * 6.283, r, tiltX, tiltZ, speed, jitter: (Math.random() - 0.5) * 0.05, size: 0.55 + Math.random() * 1.2 });
      }
    }

    const cur = { ...STATES.idle };
    const target = { ...STATES.idle };
    let g = 0, t = 0, last = 0, raf = null;

    function rot(p, gx, gg) {
      let x = Math.cos(p.a) * (p.r + p.jitter), y = Math.sin(p.a) * (p.r + p.jitter), z = 0, tmp;
      let c = Math.cos(p.tiltX), s = Math.sin(p.tiltX); tmp = y * c - z * s; z = y * s + z * c; y = tmp;
      c = Math.cos(p.tiltZ); s = Math.sin(p.tiltZ); tmp = x * c - y * s; y = x * s + y * c; x = tmp;
      c = Math.cos(gg); s = Math.sin(gg); tmp = x * c + z * s; z = -x * s + z * c; x = tmp;
      c = Math.cos(gx); s = Math.sin(gx); tmp = y * c - z * s; z = y * s + z * c; y = tmp;
      return { x, y, z };
    }

    function drawCore(strength, pulseAmt) {
      const r = R * (0.92 + pulseAmt * 0.16) * cur.scale;
      const g1 = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g1.addColorStop(0, `rgba(234,247,255,${0.85 * strength})`);
      g1.addColorStop(0.18, `rgba(150,215,255,${0.5 * strength})`);
      g1.addColorStop(0.5, `rgba(60,150,230,${0.12 * strength})`);
      g1.addColorStop(1, 'rgba(10,20,40,0)');
      ctx.fillStyle = g1; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.2832); ctx.fill();
      const r2 = R * 0.17 * (1 + pulseAmt * 0.45);
      const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, r2);
      g2.addColorStop(0, `rgba(255,255,255,${0.95 * strength})`);
      g2.addColorStop(1, 'rgba(180,230,255,0)');
      ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(cx, cy, r2, 0, 6.2832); ctx.fill();
    }

    function frame(dt) {
      const tgt = STATES[stateRef.current] || STATES.idle;
      for (const k in tgt) { target[k] = tgt[k]; cur[k] += (target[k] - cur[k]) * 0.06; }
      g += cur.spin * dt * 0.0012;
      const gx = 0.30 + Math.sin(t * 0.00022) * 0.34;
      // Transparent canvas — clear each frame so the orb is just glow with no
      // dark box, and composites cleanly onto any background it floats over.
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      const pulseAmt = cur.pulse * (0.5 + 0.5 * Math.sin(t * 0.011)) * (0.6 + 0.4 * Math.sin(t * 0.023 + 1));
      drawCore(cur.core, pulseAmt);
      const scale = R * cur.scale * (1 + pulseAmt * 0.05);
      for (const p of particles) {
        p.a += p.speed * cur.spin * dt * 0.0016;
        const w = rot(p, gx, g);
        const persp = 1 / (1.7 - w.z * 0.6);
        const sx = cx + w.x * scale * persp;
        const sy = cy + w.y * scale * persp;
        let depth = (w.z + 1.15) / 2.3; if (depth < 0) depth = 0; if (depth > 1) depth = 1;
        const alpha = (0.12 + depth * 0.9) * cur.bright;
        let sz = p.size * persp * (0.5 + depth) * DPR; if (sz < 0.4) sz = 0.4;
        ctx.fillStyle = `rgba(${(150 + depth * 70) | 0},${(212 + depth * 35) | 0},255,${alpha})`;
        ctx.beginPath(); ctx.arc(sx, sy, sz, 0, 6.2832); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function loop(now) { const dt = Math.min(42, now - last) || 16; last = now; t += dt; frame(dt); raf = requestAnimationFrame(loop); }

    resize();
    const onResize = () => { resize(); if (reduce) { t += 16; frame(16); } };
    window.addEventListener('resize', onResize);
    if (reduce) { t = 1000; frame(16); } else { raf = requestAnimationFrame(loop); }
    return () => { if (raf) cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, [size]);

  return <canvas ref={canvasRef} className="rz-orb-canvas" style={{ width: size, height: size, display: 'block' }} aria-hidden="true" />;
}
