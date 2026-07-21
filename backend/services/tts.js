// Neural text-to-speech for the assistant's spoken replies. The browser's
// built-in speech sounds robotic; a neural voice sounds human and warm. Uses
// OpenAI's TTS when OPENAI_API_KEY is set, and returns null otherwise so the
// frontend gracefully falls back to the browser voice — same lazy/optional
// pattern as Stripe and Twilio, so nothing breaks when it isn't configured.
//
// Voice + model are env-tunable: TTS_VOICE (default "nova" — warm and
// friendly; "shimmer" is brighter/upbeat, "fable" is expressive) and
// TTS_MODEL (default "tts-1"). Cost is tiny — ~$0.015 per 1,000 characters,
// so a spoken reply is a small fraction of a cent.
async function synthesizeSpeech(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null; // not configured — caller falls back to browser TTS
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.TTS_MODEL || 'tts-1',
      voice: process.env.TTS_VOICE || 'nova',
      input: String(text).slice(0, 1200),
      response_format: 'mp3',
      speed: 1.0,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`openai tts ${res.status} ${detail.slice(0, 160)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function ttsConfigured() {
  return !!process.env.OPENAI_API_KEY;
}

module.exports = { synthesizeSpeech, ttsConfigured };
