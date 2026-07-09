import { useCallback, useEffect, useRef, useState } from 'react';
import Shell from '../components/Shell';
import Icon from '../components/Icon';
import VoiceOrb from '../components/VoiceOrb';
import { useVoice, voiceSupported } from '../lib/useVoice';
import { api } from '../lib/api';

const GREETING =
  'Hi, this is RoverZoom. Where would you like to go, and when should I pick you up?';

// State machine: idle -> listening -> thinking -> speaking -> listening ...
export default function VoiceFlow({ onBack, onConfirmDraft, onSwitchToText }) {
  const [phase, setPhase] = useState('idle'); // idle|listening|thinking|speaking
  const [transcript, setTranscript] = useState([]); // {role, content}
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(false);
  const historyRef = useRef([]);
  const supported = voiceSupported();

  // Called by the voice hook when the user finishes speaking.
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
      } else if (res.type === 'booking') {
        historyRef.current = [...historyRef.current, { role: 'assistant', content: res.note }];
        setTranscript((t) => [...t, { role: 'assistant', content: res.note }]);
        setDraft(res.draft);
        setPhase('speaking');
        speak(`${res.note} Your estimated fare is $${res.draft.fare.toFixed(0)}. Shall I confirm?`, () => setPhase('idle'));
      }
    } catch (e) {
      setError(e.message);
      const msg = 'Sorry, I had trouble with that. Please try again, or switch to typing.';
      setTranscript((t) => [...t, { role: 'assistant', content: msg }]);
      setPhase('speaking');
      speak(msg, () => setPhase('idle'));
    }
  }, []); // eslint-disable-line

  const { listening, speaking, partial, startListening, stopListening, speak, cancelSpeech } =
    useVoice(handleFinal);

  // Keep phase in sync with the hook's listening/speaking booleans.
  useEffect(() => {
    if (listening) setPhase('listening');
  }, [listening]);
  useEffect(() => {
    if (!listening && !speaking && phase === 'listening') setPhase('idle');
  }, [listening, speaking]); // eslint-disable-line

  // Kick off: greet, then listen.
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
          <h1 className="title">Voice isn’t available here</h1>
          <p className="subtitle">This browser doesn’t support in-app voice. You can book by typing instead.</p>
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
            <Icon name="sparkles" size={20} color="var(--ink)" />
            <span style={{ fontSize: 16, fontWeight: 600 }}>Voice assistant</span>
          </div>
          <button className="btn btn-back" onClick={onSwitchToText} style={{ width: 44, padding: '10px 0' }} aria-label="Switch to typing">
            <Icon name="keyboard" size={20} color="var(--ink-2)" />
          </button>
        </div>

        {/* Transcript */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {transcript.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '82%', padding: '11px 15px', fontSize: 15, lineHeight: 1.5,
                borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                background: m.role === 'user' ? 'var(--ink)' : 'var(--card)',
                color: m.role === 'user' ? '#fff' : 'var(--ink)',
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

          {draft && (
            <div className="summary" style={{ marginTop: 6 }}>
              <div className="summary-row"><span className="summary-label">Pickup</span>
                <span className="summary-value" style={{ maxWidth: '60%', textAlign: 'right' }}>{draft.pickup.address}</span></div>
              <div className="summary-row"><span className="summary-label">Destination</span>
                <span className="summary-value" style={{ maxWidth: '60%', textAlign: 'right' }}>{draft.dropoff.address}</span></div>
              <div className="summary-row"><span className="summary-label">When</span>
                <span className="summary-value">{new Date(draft.scheduledAt).toLocaleString(undefined, { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })}</span></div>
              <div className="summary-row"><span className="summary-label">Estimated fare</span>
                <span className="summary-value big">${draft.fare.toFixed(2)}</span></div>
            </div>
          )}
          {error && <p className="error-text">{error}</p>}
        </div>

        {/* Voice control zone */}
        <div style={{ padding: '18px 24px 28px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          {!started ? (
            <button className="btn" onClick={begin} style={{ maxWidth: 320 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <Icon name="mic" size={20} color="#fff" /> Start talking
              </span>
            </button>
          ) : draft ? (
            <>
              <button className="btn" style={{ maxWidth: 360 }} onClick={() => onConfirmDraft(draft)}>
                Confirm — continue to payment
              </button>
              <button className="btn btn-ghost" style={{ maxWidth: 360 }} onClick={() => { setDraft(null); startListening(); }}>
                Change something
              </button>
            </>
          ) : (
            <VoiceOrb state={phase} onTap={orbTap} />
          )}
        </div>
      </div>
    </Shell>
  );
}
