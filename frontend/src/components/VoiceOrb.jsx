import Icon from './Icon';

// Central voice indicator. Four states, each with distinct motion so the
// passenger always knows what's happening without reading text.
//   idle      — calm, tap to start
//   listening — pulsing rings (mic open)
//   thinking  — rotating ring (Claude processing)
//   speaking  — waveform bars (assistant talking)
export default function VoiceOrb({ state, onTap }) {
  const label = {
    idle: 'Tap to speak',
    listening: 'Listening…',
    thinking: 'Thinking…',
    speaking: 'Speaking…',
  }[state];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
      <button
        onClick={onTap}
        aria-label={label}
        style={{
          position: 'relative',
          width: 132,
          height: 132,
          borderRadius: '50%',
          background: state === 'idle' ? 'var(--card)' : 'var(--ink)',
          border: state === 'idle' ? '1.5px solid var(--line-2)' : 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 0.3s',
          boxShadow: state === 'idle' ? 'var(--shadow-card)' : '0 10px 30px rgba(17,17,19,0.25)',
        }}
      >
        {/* Listening: expanding rings */}
        {state === 'listening' && (
          <>
            <span style={ring(0)} />
            <span style={ring(0.6)} />
          </>
        )}

        {/* Thinking: rotating arc */}
        {state === 'thinking' && (
          <span
            style={{
              position: 'absolute',
              inset: 8,
              borderRadius: '50%',
              border: '3px solid rgba(255,255,255,0.18)',
              borderTopColor: '#fff',
              animation: 'rz-spin 0.9s linear infinite',
            }}
          />
        )}

        {/* Speaking: waveform bars */}
        {state === 'speaking' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 34 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                style={{
                  width: 5,
                  borderRadius: 3,
                  background: '#fff',
                  height: '100%',
                  animation: `rz-bar 0.9s ${i * 0.12}s ease-in-out infinite`,
                }}
              />
            ))}
          </div>
        ) : (
          <Icon
            name={state === 'idle' ? 'mic' : 'mic'}
            size={40}
            color={state === 'idle' ? 'var(--ink)' : '#fff'}
            stroke={1.8}
          />
        )}
      </button>

      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-2)' }}>{label}</div>

      <style>{`
        @keyframes rz-spin { to { transform: rotate(360deg); } }
        @keyframes rz-bar {
          0%, 100% { transform: scaleY(0.35); }
          50% { transform: scaleY(1); }
        }
        @keyframes rz-ring {
          0% { transform: scale(0.7); opacity: 0.6; }
          100% { transform: scale(1.5); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function ring(delay) {
  return {
    position: 'absolute',
    inset: 0,
    borderRadius: '50%',
    border: '2px solid rgba(255,255,255,0.5)',
    animation: `rz-ring 1.6s ${delay}s ease-out infinite`,
  };
}
