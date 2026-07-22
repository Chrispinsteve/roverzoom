import { useCallback, useEffect, useRef, useState } from 'react';
import VoiceOrb from '../../components/VoiceOrb';
import { api } from '../../lib/api';

// Browser speech-to-text. Chrome/Android have it; Safari/iOS do not — there we
// fall back to a text box, so the assistant still works everywhere (you type,
// it talks back). Text-to-speech (speechSynthesis) works on iOS too.
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
const CAN_LISTEN = !!SR;

const STATUS_LABEL = { idle: 'RoverZoom', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking' };

// Decode an MP3 arrayBuffer via Web Audio, tolerating Safari's callback-only form.
function decodeAudio(ctx, arrayBuffer) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ok = (b) => { if (!settled) { settled = true; resolve(b); } };
    const err = (e) => { if (!settled) { settled = true; reject(e || new Error('decode failed')); } };
    try { const p = ctx.decodeAudioData(arrayBuffer, ok, err); if (p && typeof p.then === 'function') p.then(ok, err); }
    catch (e) { err(e); }
  });
}

export default function VoiceAssistant({ onClose, onBooked }) {
  const [state, setState] = useState('idle');
  const [caption, setCaption] = useState(
    CAN_LISTEN ? "Tap the orb and tell me where you're going." : "Type where you're going and I'll book it."
  );
  const [error, setError] = useState('');
  const [typed, setTyped] = useState('');

  const historyRef = useRef([]);
  const recRef = useRef(null);
  const stateRef = useRef('idle');
  const mountedRef = useRef(true);
  const primedRef = useRef(false);
  const audioRef = useRef(null);
  const audioCtxRef = useRef(null);
  const sourceRef = useRef(null);
  const premiumRef = useRef(null); // null = unknown, true = neural voice, false = not configured

  const getCtx = () => {
    if (!audioCtxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { try { audioCtxRef.current = new AC(); } catch { /* ignore */ } }
    }
    return audioCtxRef.current;
  };

  const stopSpeech = useCallback(() => {
    try { if (sourceRef.current) { sourceRef.current.onended = null; sourceRef.current.stop(); sourceRef.current = null; } } catch { /* ignore */ }
    try { if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; audioRef.current = null; } } catch { /* ignore */ }
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  }, []);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => {
    mountedRef.current = true;
    // Voices load asynchronously in some browsers.
    try { window.speechSynthesis.getVoices(); window.speechSynthesis.addEventListener('voiceschanged', () => window.speechSynthesis.getVoices()); } catch { /* no tts */ }
    return () => {
      mountedRef.current = false;
      try { recRef.current && recRef.current.abort(); } catch { /* ignore */ }
      stopSpeech();
    };
  }, [stopSpeech]);

  // iOS only allows audio to start from inside a user gesture — "prime" both the
  // browser speech engine and HTMLAudio on the first tap so later replies (which
  // come back after an async request) are allowed to play.
  const primeTTS = () => {
    if (primedRef.current) return;
    primedRef.current = true;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u); } catch { /* ignore */ }
    // Unlock Web Audio inside the gesture — this is what lets the neural voice
    // actually play on iOS (a plain <audio>.play() after an async fetch is blocked).
    try { const ctx = getCtx(); if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); } catch { /* ignore */ }
  };

  // Warmer browser fallback: a livelier pitch and a natural-sounding system
  // voice (skipping the novelty/robotic ones), so even without the neural voice
  // it reads less flat.
  const speakBrowser = useCallback((text) => new Promise((resolve) => {
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0; u.pitch = 1.07;
      const voices = window.speechSynthesis.getVoices() || [];
      const bad = /eloquence|compact|zarvox|albert|bad news|bells|boing|bubbles|cellos|deranged|hysterical|pipe|trinoids|whisper|wobble|jester|organ|superstar|flo|grandma|grandpa|reed|rocko|sandy|shelley/i;
      const nice = voices.find((v) => /en[-_]US/i.test(v.lang) && /(Samantha|Ava|Allison|Nicky|Nova|Aria|Jenny|Google US English)/i.test(v.name))
        || voices.find((v) => /en[-_]US/i.test(v.lang) && !bad.test(v.name))
        || voices.find((v) => /en[-_]US/i.test(v.lang))
        || voices.find((v) => /^en/i.test(v.lang) && !bad.test(v.name));
      if (nice) u.voice = nice;
      u.onend = resolve; u.onerror = resolve;
      window.speechSynthesis.speak(u);
    } catch { resolve(); }
  }), []);

  // Prefer the warm neural voice from the server; fall back to the browser voice
  // if it isn't configured (503) or playback is blocked.
  const speak = useCallback(async (text) => {
    stopSpeech();
    if (premiumRef.current !== false) {
      try {
        const res = await fetch('/api/assistant/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
        if (res.status === 503) {
          premiumRef.current = false; // no voice key configured — stop trying this session
        } else if (res.ok) {
          premiumRef.current = true;
          const arrayBuf = await res.arrayBuffer();
          // Primary: Web Audio. Its context is unlocked in the tap gesture
          // (primeTTS), so playback is allowed on iOS where <audio> is not.
          const ctx = getCtx();
          if (ctx) {
            try {
              if (ctx.state === 'suspended') await ctx.resume();
              const buffer = await decodeAudio(ctx, arrayBuf.slice(0));
              const played = await new Promise((resolve) => {
                try {
                  const src = ctx.createBufferSource();
                  src.buffer = buffer;
                  src.connect(ctx.destination);
                  src.onended = () => resolve(true);
                  sourceRef.current = src;
                  src.start(0);
                } catch { resolve(false); }
              });
              if (played) return;
            } catch { /* fall through */ }
          }
          // Secondary: plain <audio> (works on desktop even without Web Audio).
          try {
            const url = URL.createObjectURL(new Blob([arrayBuf], { type: 'audio/mpeg' }));
            const played = await new Promise((resolve) => {
              const audio = new Audio(url);
              audioRef.current = audio;
              audio.onended = () => { URL.revokeObjectURL(url); resolve(true); };
              audio.onerror = () => { URL.revokeObjectURL(url); resolve(false); };
              audio.play().catch(() => { URL.revokeObjectURL(url); resolve(false); });
            });
            if (played) return;
          } catch { /* fall through */ }
        }
        // Any other status (e.g. transient 500): don't disable neural for the
        // whole session — just use the browser voice this one turn.
      } catch { /* network blip — browser voice this turn, retry neural next */ }
    }
    if (mountedRef.current) await speakBrowser(text);
  }, [speakBrowser, stopSpeech]);

  const startListening = useCallback(() => {
    if (!CAN_LISTEN) return;
    stopSpeech();
    try {
      const rec = new SR();
      rec.lang = 'en-US'; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
      let finalText = '';
      rec.onstart = () => { setState('listening'); setCaption('Listening…'); setError(''); };
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        setCaption(finalText || interim || 'Listening…');
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed') { setError('Microphone access is off. Turn it on, or type below.'); }
        setState('idle');
      };
      rec.onend = () => {
        const t = finalText.trim();
        if (t) sendTurn(t);
        else if (stateRef.current === 'listening') { setState('idle'); setCaption('I didn’t catch that — tap the orb to try again.'); }
      };
      recRef.current = rec;
      rec.start();
    } catch { setState('idle'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendTurn = useCallback(async (text) => {
    if (!text || !text.trim()) return;
    setError(''); setCaption(text); setState('thinking');
    try {
      const { reply, booking } = await api.assistant(historyRef.current, text);
      if (!mountedRef.current) return;
      historyRef.current = [...historyRef.current, { role: 'user', text }, { role: 'assistant', text: reply }].slice(-16);
      setCaption(reply); setState('speaking');
      if (booking && onBooked) onBooked(booking);
      await speak(reply);
      if (!mountedRef.current) return;
      if (CAN_LISTEN) startListening(); else setState('idle');
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e.message || 'Something went wrong.'); setState('idle');
    }
  }, [speak, onBooked, startListening]);

  const onOrbTap = () => {
    primeTTS();
    if (state === 'thinking') return;
    if (state === 'listening') { try { recRef.current && recRef.current.stop(); } catch { /* ignore */ } return; }
    if (state === 'speaking') { stopSpeech(); }
    if (CAN_LISTEN) startListening();
  };

  const submitTyped = (e) => {
    e.preventDefault();
    primeTTS();
    const t = typed.trim();
    if (!t) return;
    setTyped('');
    sendTurn(t);
  };

  return (
    <div className="rz-va" role="dialog" aria-label="RoverZoom voice assistant">
      <button className="rz-va-close" onClick={onClose} aria-label="Close assistant">✕</button>

      <button className="rz-va-orb" onClick={onOrbTap} aria-label={state === 'listening' ? 'Stop' : 'Talk to RoverZoom'}>
        <VoiceOrb state={state} size={264} />
      </button>

      <div className={`rz-va-status ${state}`}>
        {state !== 'idle' && <span className="rz-va-dot" />}
        {STATUS_LABEL[state]}
      </div>

      <p className="rz-va-caption" aria-live="polite">{caption}</p>
      {error && <p className="rz-va-error">{error}</p>}

      {CAN_LISTEN ? (
        <button className="rz-va-hint" onClick={onOrbTap}>
          {state === 'listening' ? 'Tap to stop' : state === 'idle' ? 'Tap the orb to talk' : ' '}
        </button>
      ) : (
        <form className="rz-va-type" onSubmit={submitTyped}>
          <input
            className="rz-va-input"
            placeholder="Type where you're going…"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={state === 'thinking'}
            autoFocus
          />
          <button className="rz-va-send" type="submit" disabled={state === 'thinking' || !typed.trim()}>Send</button>
        </form>
      )}
    </div>
  );
}
