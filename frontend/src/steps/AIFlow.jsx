import { useEffect, useRef, useState } from 'react';
import Shell from '../components/Shell';
import Icon from '../components/Icon';
import ThinkingDots from '../components/ThinkingDots';
import { api } from '../lib/api';

const GREETING = "Hi — I’m your RoverZoom assistant. Tell me where you’re headed and when, and I’ll set up your ride. For example: “Pick me up at 220 W 21st St tomorrow at 8am, going to JFK.”";

export default function AIFlow({ onBack, onConfirmDraft }) {
  const [messages, setMessages] = useState([{ role: 'assistant', content: GREETING }]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking, draft]);

  const send = async () => {
    const text = input.trim();
    if (!text || thinking) return;
    setError('');
    const history = [...messages, { role: 'user', content: text }].filter((m) => m.role === 'user' || m.role === 'assistant');
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setInput('');
    setThinking(true);
    try {
      const res = await api.aiChat(history.map(({ role, content }) => ({ role, content })));
      if (res.type === 'question') {
        setMessages((m) => [...m, { role: 'assistant', content: res.text }]);
      } else if (res.type === 'booking') {
        setMessages((m) => [...m, { role: 'assistant', content: res.note }]);
        setDraft(res.draft);
      }
    } catch (e) {
      setError(e.message);
      setMessages((m) => [...m, { role: 'assistant', content: "Sorry — I hit a snag. You can try again, or use the form instead." }]);
    } finally {
      setThinking(false);
    }
  };

  return (
    <Shell step={0} totalSteps={0}>
      <div className="body" style={{ padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 24px 14px' }}>
          <button className="btn btn-back" onClick={onBack} style={{ width: 44, padding: '10px 0' }} aria-label="Back">
            <Icon name="arrowLeft" size={20} color="var(--ink-2)" />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="sparkles" size={20} color="var(--ink)" />
            <span style={{ fontSize: 16, fontWeight: 600 }}>Booking assistant</span>
          </div>
        </div>

        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 24px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '82%', padding: '12px 16px', fontSize: 15, lineHeight: 1.5,
                borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                background: m.role === 'user' ? 'var(--ink)' : 'var(--card)',
                color: m.role === 'user' ? '#fff' : 'var(--ink)',
                border: m.role === 'user' ? 'none' : '1px solid var(--line)',
                boxShadow: m.role === 'assistant' ? 'var(--shadow-card)' : 'none',
              }}>
                {m.content}
              </div>
            </div>
          ))}

          {thinking && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{ padding: '4px 14px', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: '18px 18px 18px 4px', boxShadow: 'var(--shadow-card)' }}>
                <ThinkingDots />
              </div>
            </div>
          )}

          {draft && (
            <div className="summary" style={{ marginTop: 8 }}>
              <div className="summary-row"><span className="summary-label">Pickup</span>
                <span className="summary-value" style={{ maxWidth: '60%', textAlign: 'right' }}>{draft.pickup.address}</span></div>
              <div className="summary-row"><span className="summary-label">Destination</span>
                <span className="summary-value" style={{ maxWidth: '60%', textAlign: 'right' }}>{draft.dropoff.address}</span></div>
              <div className="summary-row"><span className="summary-label">When</span>
                <span className="summary-value">{new Date(draft.scheduledAt).toLocaleString(undefined, { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })}</span></div>
              <div className="summary-row"><span className="summary-label">Distance · time</span>
                <span className="summary-value">{draft.distanceMiles} mi · {draft.durationMinutes} min</span></div>
              <div className="summary-row"><span className="summary-label">Estimated fare</span>
                <span className="summary-value big">${draft.fare.toFixed(2)}</span></div>
            </div>
          )}

          {error && <p className="error-text">{error}</p>}
        </div>

        {draft ? (
          <div style={{ padding: '8px 24px 24px', borderTop: '1px solid var(--line)' }}>
            <button className="btn" onClick={() => onConfirmDraft(draft)}>Looks good — continue to payment</button>
            <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setDraft(null)}>Change something</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10, padding: '10px 24px 24px', borderTop: '1px solid var(--line)' }}>
            <input
              className="input"
              placeholder="Type your request…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              disabled={thinking}
            />
            <button className="btn" style={{ width: 56, flex: '0 0 auto', padding: 0 }} onClick={send} disabled={thinking || !input.trim()} aria-label="Send">
              <Icon name="send" size={20} color="#fff" />
            </button>
          </div>
        )}
      </div>
    </Shell>
  );
}
