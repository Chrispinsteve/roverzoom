import { useEffect, useRef, useState } from 'react';
import Shell from '../components/Shell';
import Icon from '../components/Icon';
import ThinkingDots from '../components/ThinkingDots';
import { api } from '../lib/api';

const GREETING = "Hey! I'm Bob, your RoverZoom concierge. Tell me where you want to go, when, your name and phone, and how you'd like to pay — I'll handle the rest.";

export default function AIFlow({ onBack, onBookingComplete }) {
  const [messages, setMessages] = useState([{ role: 'assistant', content: GREETING }]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking, booking]);

  const send = async () => {
    const text = input.trim();
    if (!text || thinking) return;
    setError('');
    const history = [...messages, { role: 'user', content: text }];
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setInput('');
    setThinking(true);
    try {
      const res = await api.aiChat(history.map(({ role, content }) => ({ role, content })));
      if (res.type === 'question') {
        setMessages((m) => [...m, { role: 'assistant', content: res.text }]);
      } else if (res.type === 'booking_confirmed') {
        setMessages((m) => [...m, { role: 'assistant', content: res.note }]);
        setBooking(res.booking);
      } else if (res.type === 'booking') {
        setMessages((m) => [...m, { role: 'assistant', content: res.note }]);
      }
    } catch (e) {
      setError(e.message);
      setMessages((m) => [...m, { role: 'assistant', content: "Sorry, I hit a snag. Try again or use the form." }]);
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
          <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Bob</span>
        </div>

        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 24px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.map((m, i) => (
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
          {thinking && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{ padding: '4px 14px', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: '18px 18px 18px 4px' }}>
                <ThinkingDots />
              </div>
            </div>
          )}
          {error && <p className="error-text">{error}</p>}
        </div>

        {booking ? (
          <div style={{ padding: '8px 24px 24px', borderTop: '1px solid var(--line)' }}>
            <button className="btn" onClick={() => onBookingComplete(booking)}>View my booking</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10, padding: '10px 24px 24px', borderTop: '1px solid var(--line)' }}>
            <input
              className="input"
              placeholder="Tell Bob what you need…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              disabled={thinking}
            />
            <button className="btn" style={{ width: 56, flex: '0 0 auto', padding: 0 }} onClick={send} disabled={thinking || !input.trim()} aria-label="Send">
              <Icon name="send" size={20} color="var(--accent-ink)" />
            </button>
          </div>
        )}
      </div>
    </Shell>
  );
}
