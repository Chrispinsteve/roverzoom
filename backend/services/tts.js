// Neural text-to-speech for the assistant's spoken replies. The browser's
// built-in speech sounds robotic; a neural voice sounds human and warm.
//
// Two providers, tried in order of "most human" — whichever key is set wins,
// and if neither is set this returns null so the frontend gracefully falls back
// to the browser voice (same lazy/optional pattern as Stripe and Twilio):
//   1. ElevenLabs (ELEVENLABS_API_KEY) — the most expressive/joyful voices,
//      low-latency Flash model. Pricier per character.
//   2. OpenAI (OPENAI_API_KEY) — very natural, much cheaper.
// If both keys are set, ElevenLabs is used.

async function synthElevenLabs(text) {
  const key = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // "Rachel" — warm default; swap for any voice in your library
  const model = process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5'; // low-latency, high quality
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: model,
      // Lower stability + some style = livelier, warmer delivery (less flat).
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.45, use_speaker_boost: true },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`elevenlabs ${res.status} ${detail.slice(0, 180)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function synthOpenAI(text) {
  const key = process.env.OPENAI_API_KEY;
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.TTS_MODEL || 'tts-1',
      voice: process.env.TTS_VOICE || 'shimmer',
      input: text,
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

async function synthesizeSpeech(text) {
  const input = String(text).slice(0, 1200);
  if (process.env.ELEVENLABS_API_KEY) return synthElevenLabs(input);
  if (process.env.OPENAI_API_KEY) return synthOpenAI(input);
  return null; // not configured — caller falls back to browser TTS
}

function ttsConfigured() {
  return !!(process.env.ELEVENLABS_API_KEY || process.env.OPENAI_API_KEY);
}

module.exports = { synthesizeSpeech, ttsConfigured };
