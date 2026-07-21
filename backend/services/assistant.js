// The brain of the RoverZoom voice assistant. Claude (via the Anthropic SDK)
// holds a spoken conversation and actually acts — pricing and booking real
// rides through the same services the rest of the app uses (geocode, fare,
// bookings, SMS confirmation). Lazy-initialized like the Stripe/Twilio clients:
// if ANTHROPIC_API_KEY isn't set the whole API still boots and every other
// flow keeps working; the assistant endpoint just answers 503.
const supabase = require('../db/supabase');
const { estimate } = require('./fare');
const { geocodeOne } = require('./geocode');
const { makeReference } = require('./reference');
const { sendBookingConfirmation, trackingUrl } = require('./sms');

// Per the model guidance, use the most capable model. Thinking is deliberately
// left off (fast turnaround matters for a spoken back-and-forth) and effort is
// low — the work here is short slot-filling plus tool calls, not deep
// reasoning, and the model handles that well without a thinking pass.
const MODEL = 'claude-opus-4-8';

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
    name: 'get_quote',
    description:
      "Get the locked price and travel time for a ride between two addresses. Call this before booking, or whenever the rider asks how much a ride costs.",
    input_schema: {
      type: 'object',
      properties: {
        pickup_address: { type: 'string', description: 'The pickup address or place name, as the rider said it.' },
        dropoff_address: { type: 'string', description: 'The destination address or place name.' },
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

async function toolGetQuote(input) {
  const { p, d } = await resolveEnds(input.pickup_address, input.dropoff_address);
  if (!p || !d) return { error: "Couldn't find one of those addresses — ask the rider to be more specific." };
  const est = estimate(p, d);
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
  const est = estimate(p, d);
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

async function runTool(name, input) {
  try {
    if (name === 'get_quote') return await toolGetQuote(input);
    if (name === 'create_booking') return await toolCreateBooking(input);
    if (name === 'get_booking_status') return await toolGetBookingStatus(input);
    return { error: 'Unknown tool.' };
  } catch (err) {
    return { error: err.message || 'That step failed.' };
  }
}

function systemPrompt() {
  return `You are the voice of RoverZoom, a scheduled ride service. You help riders book a car by talking with them out loud.

RoverZoom's promise: the price is locked the moment they book, a driver is guaranteed, and there's no surge. Riders pay the driver in cash, by Zelle, or by card.

Current date and time: ${new Date().toISOString()}. Use this to turn phrases like "tomorrow at 6" into an exact future ISO 8601 timestamp when booking.

How to behave:
- Your replies are READ ALOUD by a text-to-speech voice. Keep every reply to one or two short spoken sentences. No lists, no markdown, no emojis, no code. Say prices in words, like "fifty-two dollars".
- A booking needs: pickup, destination, date and time, the rider's name, and their phone number. Ask only for what's still missing, one item at a time. Keep it conversational.
- Use get_quote to price a ride. Always tell the rider the locked price and get a clear yes before booking.
- Call create_booking only after you have everything and they've confirmed. Default payment to cash unless they say otherwise.
- After booking, read back the confirmation code clearly (say the characters) and tell them a driver will be assigned soon and they'll get a tracking text.
- Use get_booking_status if they ask about an existing ride by its code.
- If a tool returns an error, say what went wrong plainly and suggest the next step. Never invent a price, a confirmation code, an address, or a driver.
- Answer only the final spoken sentence to the rider — do not narrate your reasoning.`;
}

// history: [{ role: 'user'|'assistant', text }], message: latest spoken/typed text.
// Returns { reply, booking } where booking is set if a ride was booked this turn.
async function runAssistant(history, message) {
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
      max_tokens: 2048,
      output_config: { effort: 'low' },
      system: systemPrompt(),
      tools: TOOLS,
      messages,
    });
    messages.push({ role: 'assistant', content: resp.content });

    if (resp.stop_reason === 'tool_use') {
      const toolResults = [];
      for (const block of resp.content) {
        if (block.type === 'tool_use') {
          const result = await runTool(block.name, block.input);
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
