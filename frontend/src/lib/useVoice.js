import { useCallback, useEffect, useRef, useState } from 'react';

// Voice engine for the assistant. Wraps the browser's built-in speech APIs:
//   - SpeechRecognition  (speech -> text)   [input]
//   - SpeechSynthesis    (text -> speech)   [output, browser-native]
//
// PREMIUM UPGRADE PATH: to swap in ElevenLabs/OpenAI TTS later, replace the
// body of `speak()` with a fetch to your backend TTS endpoint that returns
// audio, and play it via an <audio> element. The rest of the hook — state
// machine, auto-listen, callbacks — stays identical.

const SR =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

export function voiceSupported() {
  return !!SR && typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * @param {(finalTranscript:string)=>void} onFinal called when the user stops speaking
 */
export function useVoice(onFinal) {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [partial, setPartial] = useState('');
  const recRef = useRef(null);
  const finalRef = useRef('');
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  // Build the recognizer once.
  useEffect(() => {
    if (!SR) return;
    const rec = new SR();
    rec.continuous = false; // stop after a natural pause
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onresult = (e) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      if (interim) setPartial(interim);
      if (final) finalRef.current += final;
    };

    rec.onend = () => {
      setListening(false);
      setPartial('');
      const text = finalRef.current.trim();
      finalRef.current = '';
      if (text) onFinalRef.current?.(text);
    };

    rec.onerror = () => {
      setListening(false);
      setPartial('');
    };

    recRef.current = rec;
    return () => {
      try { rec.abort(); } catch { /* noop */ }
    };
  }, []);

  const startListening = useCallback(() => {
    if (!recRef.current || listening) return;
    // Don't listen over our own speech.
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    setSpeaking(false);
    finalRef.current = '';
    try {
      recRef.current.start();
      setListening(true);
    } catch {
      // start() throws if already started; ignore.
    }
  }, [listening]);

  const stopListening = useCallback(() => {
    if (!recRef.current) return;
    try { recRef.current.stop(); } catch { /* noop */ }
    setListening(false);
  }, []);

  /**
   * Speak text aloud, then call onDone (used to chain into auto-listen).
   */
  const speak = useCallback((text, onDone) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) {
      onDone?.();
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    u.pitch = 1.0;
    // Prefer a natural-sounding English voice if the browser offers one.
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find((v) =>
      /Samantha|Google US English|Microsoft Aria|Natural/i.test(v.name)
    );
    if (preferred) u.voice = preferred;
    u.onstart = () => setSpeaking(true);
    u.onend = () => { setSpeaking(false); onDone?.(); };
    u.onerror = () => { setSpeaking(false); onDone?.(); };
    window.speechSynthesis.speak(u);
  }, []);

  const cancelSpeech = useCallback(() => {
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  return { listening, speaking, partial, startListening, stopListening, speak, cancelSpeech };
}
