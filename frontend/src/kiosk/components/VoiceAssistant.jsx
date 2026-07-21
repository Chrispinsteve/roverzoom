import { useCallback, useEffect, useRef, useState } from 'react';
import VoiceOrb from '../../components/VoiceOrb';
import { api } from '../../lib/api';

// Browser speech-to-text. Chrome/Android have it; Safari/iOS do not — there we
// fall back to a text box, so the assistant still works everywhere (you type,
// it talks back). Text-to-speech (speechSynthesis) works on iOS too.
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
const CAN_LISTEN = !!SR;

const STATUS_LABEL = { idle: 'RoverZoom', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking' };

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

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => {
    mountedRef.current = true;
    // Voices load asynchronously in some browsers.
    try { window.speechSynthesis.getVoices(); window.speechSynthesis.addEventListener('voiceschanged', () => window.speechSynthesis.getVoices()); } catch { /* no tts */ }
    return () => {
      mountedRef.current = false;
      try { recRef.current && recRef.current.abort(); } catch { /* ignore */ }
      try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
    };
  }, []);

  // iOS only lets speechSynthesis start from inside a user gesture — "prime" it
  // once on the first tap so later spoken replies (which come after an async
  // request) are allowed to play.
  const primeTTS = () => {
    if (primedRef.current) return;
    primedRef.current = true;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u); } catch { /* ignore */ }
  };

  const speak = useCallback((text) => new Promise((resolve) => {
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02; u.pitch = 1.0;
      const voices = window.speechSynthesis.getVoices() || [];
      const nice = voices.find((v) => /en[-_]US/i.test(v.lang) && /(Samantha|Ava|Zoe|Aria|Jenny|Google US English|natural)/i.test(v.name))
        || voices.find((v) => /en[-_]US/i.test(v.lang))
        || voices.find((v) => /^en/i.test(v.lang));
      if (nice) u.voice = nice;
      u.onend = resolve; u.onerror = resolve;
      window.speechSynthesis.speak(u);
    } catch { resolve(); }
  }), []);

  const startListening = useCallback(() => {
    if (!CAN_LISTEN) return;
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
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
    if (state === 'speaking') { try { window.speechSynthesis.cancel(); } catch { /* ignore */ } }
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
