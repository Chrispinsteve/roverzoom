// The brain of the RoverZoom voice assistant. Claude (via the Anthropic SDK)
// holds a spoken conversation and actually acts — pricing and booking real
// rides through the same services the rest of the app uses (geocode, fare,
// bookings, SMS confirmation). Lazy-initialized like the Stripe/Twilio clients:
// if ANTHROPIC_API_KEY isn't set the whole API still boots and every other
// flow keeps working; the assistant endpoint just answers 503.
const supabase = require('../db/supabase');
const { estimate } = require('./fare');
const { geocode, geocodeOne, searchNear } = require('./geocode');
const { makeReference } = require('./reference');
const { sendBookingConfirmation, trackingUrl } = require('./sms');

// A spoken back-and-forth has to feel near-instant, so speed wins over raw
// power here: Claude Haiku 4.5 is the fastest (and cheapest) model and is more
// than capable of this slot-filling + tool-use booking flow. Thinking is left
// off for latency. (Haiku 4.5 does not accept output_config.effort — that's an
// Opus/Sonnet-tier parameter — so it isn't sent.)
const MODEL = 'claude-haiku-4-5';

let client = null;
let resolved = false;
function anthropic() {
  if (resolved) return client;
  resolved = true;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const Anthropic = require('@anthropic-ai/sdk').default;
    client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  } catch (err) {
    console.error('anthropic init failed:', err.message);
    client = null;
  }
  return client;
}

const TOOLS = [
  {
    name: 'find_place',
    description:
      'Look up a place by NAME when the rider names a business, hotel, airport, store, restaurant, mall, or landmark instead of giving a street address (e.g. "Walmart", "the Hilton", "Fort Lauderdale airport", "Aventura Mall"). Returns real matching places with their full addresses. Pass "near" (the pickup city/area, or wherever the rider is) so you get the local branch rather than one across the country. Use this to turn a place name into a real address before quoting or booking; if several plausibly match, name a couple and ask which one.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The place or business name, exactly as the rider said it.' },
        near: { type: 'string', description: "Optional. A city, area, or the pickup address to focus results nearby — usually the rider's pickup city." },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_quote',
    description:
      "Get the locked price and travel time for a ride between two addresses. Call this before booking, or whenever the rider asks how much a ride costs. Pass when_iso if you know the pickup time — early-morning rides (4–10am) are cheaper, so the price depends on it.",
    input_schema: {
      type: 'object',
      properties: {
        pickup_address: { type: 'string', description: 'The pickup address or place name, as the rider said it.' },
        dropoff_address: { type: 'string', description: 'The destination address or place name.' },
        when_iso: { type: 'string', description: 'Optional pickup date and time as ISO 8601, if known. Fares are lower for early-morning rides, so include it for an accurate quote.' },
      },
      required: ['pickup_address', 'dropoff_address'],
    },
  },
  {
    name: 'create_booking',
    description:
      "Book a scheduled ride. Only call this once you have the pickup, destination, date/time, the rider's name, and their phone number, AND the rider has confirmed the price out loud. The fare is locked at booking.",
    input_schema: {
      type: 'object',
      properties: {
        pickup_address: { type: 'string' },
        dropoff_address: { type: 'string' },
        when_iso: { type: 'string', description: 'Pickup date and time as a full ISO 8601 timestamp, computed from the current time in the system prompt. Must be in the future.' },
        rider_name: { type: 'string' },
        rider_phone: { type: 'string', description: "The rider's phone number." },
        payment_method: { type: 'string', enum: ['cash', 'zelle', 'card'], description: 'How the rider pays. Default to cash unless they say otherwise.' },
      },
      required: ['pickup_address', 'dropoff_address', 'when_iso', 'rider_name', 'rider_phone', 'payment_method'],
    },
  },
  {
    name: 'get_booking_status',
    description: "Look up an existing booking by its confirmation code (like RZ-8F3K2) to report its status and driver.",
    input_schema: {
      type: 'object',
      properties: { reference: { type: 'string' } },
      required: ['reference'],
    },
  },
];

async function resolveEnds(pickup, dropoff) {
  const [p, d] = await Promise.all([geocodeOne(pickup), geocodeOne(dropoff)]);
  return { p, d };
}

async function toolFindPlace(input, location) {
  const name = String(input.query || '').trim();
  if (!name) return { matches: [] };
  const near = String(input.near || '').trim();

  // Anchor the search so we only return NEARBY matches (never a same-name store
  // in another city). Priority: an explicit "near" the AI passed, else the
  // rider's live GPS location from the app. Results come back nearest-first.
  let anchor = null;
  if (near) {
    anchor = await geocodeOne(near).catch(() => null);
  } else if (location && Number.isFinite(location.lat) && Number.isFinite(location.lng)) {
    anchor = { lat: location.lat, lng: location.lng };
  }
  if (anchor) {
    const rows = await searchNear(name, { lat: anchor.lat, lng: anchor.lng }, 5).catch(() => []);
    if (rows.length) {
      return { matches: rows.map((r) => ({ name: r.label, address: r.address, miles_away: Math.round(r.miles) })) };
    }
    return { matches: [], note: `No "${name}" found nearby. Ask the rider for the street address or a nearby cross street.` };
  }

  // No location to anchor on — best-effort plain search.
  const rows = await geocode(near ? `${name}, ${near}` : name, 5).catch(() => []);
  if (!rows.length) {
    return { matches: [], note: 'No place found by that name — and no location to search near. Ask the rider where they are, then a street address if needed.' };
  }
  return { matches: rows.map((r) => ({ name: r.label, address: r.address })) };
}

async function toolGetQuote(input) {
  const { p, d } = await resolveEnds(input.pickup_address, input.dropoff_address);
  if (!p || !d) return { error: "Couldn't find one of those addresses — ask the rider to be more specific." };
  const est = estimate(p, d, input.when_iso);
  return {
    fare: est.fare,
    distance_miles: est.distanceMiles,
    duration: est.durationLabel,
    pickup_resolved: p.address,
    dropoff_resolved: d.address,
    too_far: !!est.tooFar,
  };
}

async function toolCreateBooking(input) {
  const { p, d } = await resolveEnds(input.pickup_address, input.dropoff_address);
  if (!p || !d) return { error: "Couldn't resolve the addresses to book the ride." };
  const est = estimate(p, d, input.when_iso);
  const pm = ['cash', 'zelle', 'card'].includes(input.payment_method) ? input.payment_method : 'cash';

  let reference = makeReference();
  for (let i = 0; i < 3; i++) {
    const { data: existing } = await supabase.from('bookings').select('reference').eq('reference', reference).maybeSingle();
    if (!existing) break;
    reference = makeReference();
  }

  const { data, error } = await supabase
    .from('bookings')
    .insert({
      reference,
      pickup_address: p.address, pickup_lat: p.lat, pickup_lng: p.lng,
      dropoff_address: d.address, dropoff_lat: d.lat, dropoff_lng: d.lng,
      scheduled_at: input.when_iso,
      distance_miles: est.distanceMiles, duration_minutes: est.durationMinutes, fare: est.fare,
      payment_method: pm,
      rider_name: input.rider_name, rider_phone: input.rider_phone,
      source: 'ai',
    })
    .select()
    .single();
  if (error) return { error: 'Booking could not be saved: ' + error.message };

  try { await sendBookingConfirmation(data); } catch { /* best-effort */ }

  return {
    reference: data.reference,
    fare: data.fare,
    when: data.scheduled_at,
    payment_method: pm,
    tracking_url: trackingUrl(data.id),
    booking_id: data.id,
    pickup: p.address,
    dropoff: d.address,
  };
}

async function toolGetBookingStatus(input) {
  const ref = String(input.reference || '').toUpperCase().replace(/\s/g, '');
  const { data } = await supabase
    .from('bookings')
    .select('reference, status, scheduled_at, fare, pickup_address, dropoff_address, drivers(name, vehicle_make, vehicle_model, vehicle_color)')
    .eq('reference', ref)
    .maybeSingle();
  if (!data) return { error: 'No booking found with that code.' };
  const drv = data.drivers;
  return {
    reference: data.reference,
    status: data.status,
    when: data.scheduled_at,
    fare: data.fare,
    pickup: data.pickup_address,
    dropoff: data.dropoff_address,
    driver: drv ? { name: drv.name, vehicle: [drv.vehicle_color, drv.vehicle_make, drv.vehicle_model].filter(Boolean).join(' ') } : null,
  };
}

async function runTool(name, input, location) {
  try {
    if (name === 'find_place') return await toolFindPlace(input, location);
    if (name === 'get_quote') return await toolGetQuote(input);
    if (name === 'create_booking') return await toolCreateBooking(input);
    if (name === 'get_booking_status') return await toolGetBookingStatus(input);
    return { error: 'Unknown tool.' };
  } catch (err) {
    return { error: err.message || 'That step failed.' };
  }
}

function systemPrompt(location) {
  const here = location && Number.isFinite(location.lat) && Number.isFinite(location.lng)
    ? `\nThe rider is opening the app from their current location right now: ${location.address || `${location.lat}, ${location.lng}`}. Treat this as their most likely PICKUP — offer it (e.g. "Should I pick you up from there?") and use it as the pickup unless they name another. When they name a place to GO, you can call find_place with NO "near" value and it searches around their current location automatically.\n`
    : '';
  return `You are the voice of RoverZoom, a scheduled ride service. You help riders book a car by talking with them out loud.

RoverZoom's promise: the price is locked the moment they book, a driver is guaranteed, and there's no surge. Riders pay the driver in cash, by Zelle, or by card.

Early-bird pricing: rides scheduled between 4 and 10 in the morning are 25% off; every other time is 15% off. So an early-morning ride is cheaper — mention it if it helps the rider save. The quote already reflects this, so always pass the pickup time to get_quote once you know it.

Current date and time: ${new Date().toISOString()}. Use this to turn phrases like "tomorrow at 6" into an exact future ISO 8601 timestamp when booking.
${here}
How to behave:
- Your replies are READ ALOUD by a text-to-speech voice. Keep every reply to one or two short spoken sentences. No lists, no markdown, no emojis, no code. Say prices in words, like "fifty-two dollars".
- A booking needs: pickup, destination, date and time, the rider's name, and their phone number. Ask only for what's still missing, one item at a time. Keep it conversational.
- Riders often name a place instead of an address — a business, hotel, store, mall, airport, or landmark ("Publix", "the Marriott", "Fort Lauderdale airport"). When they do, use find_place. Pass "near" (the pickup area) when you know a specific one; if the rider is at their current location shown above, you can OMIT "near" and it searches around them. This pins the branch closest to them, not a same-name store in another city. If you have no location at all, ask where they are first. Matches come back nearest-first with how many miles away each is; take the closest, or if two are similarly close, name them and ask which. Then always quote and book with the full resolved address — never a bare name, and never invent one.
- Use get_quote to price a ride. Always tell the rider the locked price and get a clear yes before booking.
- Call create_booking only after you have everything and they've confirmed. Default payment to cash unless they say otherwise.
- After booking, read back the confirmation code clearly (say the characters) and tell them a driver will be assigned soon and they'll get a tracking text.
- Use get_booking_status if they ask about an existing ride by its code.
- If a tool returns an error, say what went wrong plainly and suggest the next step. Never invent a price, a confirmation code, an address, or a driver.
- Answer only the final spoken sentence to the rider — do not narrate your reasoning.`;
}

// history: [{ role: 'user'|'assistant', text }], message: latest spoken/typed text,
// location: optional { address, lat, lng } — the rider's live GPS location.
// Returns { reply, booking } where booking is set if a ride was booked this turn.
async function runAssistant(history, message, location) {
  const a = anthropic();
  if (!a) {
    const e = new Error('assistant_not_configured');
    e.code = 'not_configured';
    throw e;
  }

  const messages = [];
  for (const h of history || []) {
    if (h && typeof h.text === 'string' && (h.role === 'user' || h.role === 'assistant')) {
      messages.push({ role: h.role, content: h.text });
    }
  }
  messages.push({ role: 'user', content: message });

  let booking = null;
  for (let iter = 0; iter < 6; iter++) {
    const resp = await a.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt(location),
      tools: TOOLS,
      messages,
    });
    messages.push({ role: 'assistant', content: resp.content });

    if (resp.stop_reason === 'tool_use') {
      const toolResults = [];
      for (const block of resp.content) {
        if (block.type === 'tool_use') {
          const result = await runTool(block.name, block.input, location);
          if (block.name === 'create_booking' && result && result.reference) booking = result;
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
        }
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
    return { reply: text || 'Sorry, could you say that again?', booking };
  }
  return { reply: 'Sorry, I got a little stuck there. Could you try that again?', booking };
}

module.exports = { runAssistant, isConfigured: () => !!anthropic() };
