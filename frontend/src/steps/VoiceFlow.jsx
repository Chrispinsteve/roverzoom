import { useCallback, useEffect, useRef, useState } from 'react';
import Shell from '../components/Shell';
import Icon from '../components/Icon';
import BobOrb from '../components/BobOrb';
import { useVoice, voiceSupported } from '../lib/useVoice';
import { api } from '../lib/api';

const GREETING = "Hey! I'm Bob, your RoverZoom concierge. Tell me where you're headed, when, and I'll handle everything. For example: Pick me up at 220 W 21st tomorrow at 8am, going to JFK. My name is Alex, phone 305-555-0100, pay by card.";

export default function VoiceFlow({ onBack, onBookingComplete, onSwitchToText }) {
  const [phase, setPhase] = useState('idle');
  const [transcript, setTranscript] = useState([]);
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(false);
  const historyRef = useRef([]);
  const supported = voiceSupported();

  const handleFinal = useCallback(async (text) => {
    setTranscript((t) => [...t, { role: 'user', content: text }]);
    historyRef.current = [...historyRef.current, { role: 'user', content: text }];
    setPhase('thinking');
    setError('');
    try {
      const res = await api.aiChat(historyRef.current);
      if (res.type === 'question') {
        historyRef.current = [...historyRef.current, { role: 'assistant', content: res.text }];
        setTranscript((t) => [...t, { role: 'assistant', content: res.text }]);
        setPhase('speaking');
        speak(res.text, () => startListening());
      } else if (res.type === 'booking_confirmed') {
        // Bob created the booking directly — show confirmation
        historyRef.current = [...historyRef.current, { role: 'assistant', content: res.note }];
        setTranscript((t) => [...t, { role: 'assistant', content: res.note }]);
        setBooking(res.booking);
        setPhase('speaking');
        speak(res.note, () => setPhase('idle'));
      } else if (res.type === 'booking') {
        // Legacy: draft without rider details (shouldn't happen with new Bob, but safe fallback)
        historyRef.current = [...historyRef.current, { role: 'assistant', content: res.note }];
        setTranscript((t) => [...t, { role: 'assistant', content: res.note }]);
        setPhase('speaking');
        speak(res.note, () => setPhase('idle'));
      }
    } catch (e) {
      setError(e.message);
      const msg = "Sorry, I had trouble with that. Try again, or switch to the form.";
      setTranscript((t) => [...t, { role: 'assistant', content: msg }]);
      setPhase('speaking');
      speak(msg, () => setPhase('idle'));
    }
  }, []); // eslint-disable-line

  const { listening, speaking: isSpeaking, partial, startListening, stopListening, speak, cancelSpeech } =
    useVoice(handleFinal);

  useEffect(() => { if (listening) setPhase('listening'); }, [listening]);
  useEffect(() => {
    if (!listening && !isSpeaking && phase === 'listening') setPhase('idle');
  }, [listening, isSpeaking]); // eslint-disable-line

  const begin = () => {
    setStarted(true);
    setTranscript([{ role: 'assistant', content: GREETING }]);
    setPhase('speaking');
    speak(GREETING, () => startListening());
  };

  const orbTap = () => {
    if (phase === 'listening') stopListening();
    else if (phase === 'speaking') { cancelSpeech(); startListening(); }
    else startListening();
  };

  useEffect(() => () => { cancelSpeech(); stopListening(); }, []); // eslint-disable-line

  if (!supported) {
    return (
      <Shell step={0} totalSteps={0}>
        <div className="body" style={{ justifyContent: 'center', textAlign: 'center' }}>
          <h1 className="title">Voice not available</h1>
          <p className="subtitle">This browser doesn't support voice. You can type instead.</p>
          <button className="btn" onClick={onSwitchToText}>Switch to typing</button>
          <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={onBack}>Back</button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell step={0} totalSteps={0}>
      <div className="body" style={{ padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 24px 8px' }}>
          <button className="btn btn-back" onClick={onBack} style={{ width: 44, padding: '10px 0' }} aria-label="Back">
            <Icon name="arrowLeft" size={20} color="var(--ink-2)" />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Bob</span>
          </div>
          <button className="btn btn-back" onClick={onSwitchToText} style={{ width: 44, padding: '10px 0' }} aria-label="Switch to typing">
            <Icon name="keyboard" size={20} color="var(--ink-2)" />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {transcript.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '82%', padding: '12px 16px', fontSize: 15, lineHeight: 1.5,
                borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                background: m.role === 'user' ? 'var(--ink)' : 'var(--card)',
                color: m.role === 'user' ? 'var(--accent-ink)' : 'var(--ink)',
                border: m.role === 'user' ? 'none' : '1px solid var(--line)',
              }}>
                {m.content}
              </div>
            </div>
          ))}
          {partial && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ maxWidth: '82%', padding: '11px 15px', fontSize: 15, borderRadius: '18px 18px 4px 18px', background: 'var(--canvas-2)', color: 'var(--ink-3)', fontStyle: 'italic' }}>
                {partial}…
              </div>
            </div>
          )}
          {error && <p className="error-text">{error}</p>}
        </div>

        <div style={{ padding: '18px 24px 28px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          {!started ? (
            <button className="btn" onClick={begin} style={{ maxWidth: 320 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <Icon name="mic" size={20} color="var(--accent-ink)" /> Talk to Bob
              </span>
            </button>
          ) : booking ? (
            <button className="btn" style={{ maxWidth: 360 }} onClick={() => onBookingComplete(booking)}>
              View my booking
            </button>
          ) : (
            <BobOrb state={phase} onClick={orbTap} />
          )}
        </div>
      </div>
    </Shell>
  );
}
