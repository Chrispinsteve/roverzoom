# RoverZoom — scheduled ride booking

Premium, tablet-optimized web app for booking scheduled chauffeur rides.
Two booking paths: a fast step-by-step **form**, and a **conversational AI**
assistant (powered by Claude) that turns natural language into a booking.
No account required.

Light premium aesthetic — soft gray canvas, near-black ink, white cards,
the RoverZoom wordmark. Built mobile-first and scaled up for in-car tablets.

## Stack

- **Frontend:** React + Vite (`frontend/`)
- **Backend:** Node.js + Express (`backend/`)
- **Database:** PostgreSQL
- **Payments:** card/cash selection now; Stripe stub ready to wire
- **AI:** Claude Messages API (`claude-sonnet-4-6`) for conversational booking

## What's built (rider flow, end-to-end)

1. **Landing** — "Where to?", pick Form or AI assistant.
2. **Form flow** — pickup → destination (address search) → date → time →
   review with live fare → payment → name/phone/email → confirmation.
3. **AI flow** — voice-first by default. Tap "Talk to the assistant" → the
   assistant greets you aloud, listens, and runs hands-free: you speak, Claude
   extracts pickup/dropoff/date/time (asking clarifying questions when needed),
   speaks its reply, and listens again. A live voice orb shows state
   (listening / thinking / speaking). A keyboard toggle switches to the
   text-chat version at any time. Both paths end in a priced draft → payment
   → details → confirmation.
4. **Fare** — $50/hour model based on estimated trip duration.
5. **Confirmation** — booking ID (e.g. RZ-S52FZ) + full ride details.

Driver mode and admin dashboard come next.

## Run locally

Requires PostgreSQL running locally.

### Backend
```bash
cd backend
cp .env.example .env          # set DATABASE_URL; optionally ANTHROPIC_API_KEY
npm install
npm run db:setup              # creates the bookings table
npm run dev                   # API on http://localhost:4000
```

### Frontend
```bash
cd frontend
npm install
npm run dev                   # app on http://localhost:5200 (proxies /api → :4000)
```

## Voice (browser-native)

The voice assistant uses the browser's built-in Web Speech APIs — no key, no
cost:
- **Input:** `SpeechRecognition` (speech → text). Needs mic permission; works
  in Chrome, Edge, and Safari. Firefox has limited support.
- **Output:** `SpeechSynthesis` (text → speech), browser-native voices.

**Premium voice upgrade path:** to swap the robotic browser voice for a
natural one (ElevenLabs, OpenAI, etc.), replace the body of `speak()` in
`src/lib/useVoice.js` with a call to a backend TTS endpoint that returns audio,
and play it via an `<audio>` element. The rest of the hook — the hands-free
state machine, auto-listen, and callbacks — stays unchanged.

Note: voice can't be exercised in a headless/CI environment (no mic, no audio
device). It runs on real devices. The flow logic (greet → listen → parse →
speak → listen) is verified; only the audio I/O needs a real browser.

## The AI assistant (important)

- The Anthropic API key lives **only on the backend** (`ANTHROPIC_API_KEY`
  in `backend/.env`). It is never sent to the browser — the frontend calls
  `/api/ai/chat`, and the server calls Claude. Never put the key in frontend code.
- If no key is set, the AI option is shown as "setup needed" and disabled;
  the form flow works fully without it.
- Model: `claude-sonnet-4-6` (fast, inexpensive, ideal for parsing). The
  server uses tool-use to get structured JSON (pickup, dropoff, ISO datetime)
  rather than parsing prose.

## Notes / production TODO

- **Geocoding** uses OpenStreetMap Nominatim server-side (no key). Its public
  server is rate-limited — self-host or use a paid geocoder before scaling.
  (Note: sandboxed dev environments may block Nominatim; it works on a normal server.)
- **Fare/distance** is straight-line × road factor; swap in a routing API for
  exact drive distance/time.
- **Stripe** is stubbed as card/cash selection; wire the real PaymentIntent
  when your Stripe account is ready.
- Add rate limiting + input hardening on the AI endpoint before production.

## Structure

```
backend/
  db/         schema.sql, pool, setup
  routes/     quote (geocode+estimate), bookings, ai
  services/   fare, geocode, ai (Claude), reference
  server.js
frontend/
  src/
    steps/       Landing, FormFlow, AIFlow, AICheckout, Confirmation
    components/   Shell, AddressInput, DatePicker, TimePicker,
                  ThinkingDots, Icon
    lib/api.js
    styles/index.css   ← all design tokens
```
