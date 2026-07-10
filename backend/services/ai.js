// Bob — the RoverZoom AI booking assistant, powered by Claude.
//
// Bob handles the COMPLETE booking flow conversationally: addresses, date/time,
// rider details (name, phone, email), payment method, and final confirmation.
// Uses the Messages API with a single tool ("complete_booking") so the model
// returns STRUCTURED JSON rather than prose we'd have to parse.

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-4-6';

function getClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

const SYSTEM = `You are Bob, the friendly and professional AI booking assistant for RoverZoom, a premium scheduled-ride service.

Your job: guide a rider through booking a scheduled ride via natural conversation. You need to collect ALL of these before confirming:

1. PICKUP location (address or recognizable place)
2. DROPOFF location (destination)
3. DATE and TIME of pickup (resolve relative times like "tomorrow 8am" to concrete datetimes)
4. RIDER NAME (their full name)
5. RIDER PHONE (phone number)
6. PAYMENT METHOD ("card" or "cash")

Optional: rider email.

Rules:
- Rides are SCHEDULED in advance, not on-demand.
- Introduce yourself as Bob on the first message.
- Be warm, concise, and premium in tone. Short sentences. One question at a time.
- Ask for the MOST NATURAL information first (usually pickup/dropoff), then date/time, then personal details.
- Resolve relative times ("tomorrow at 8am", "next Friday evening") into ISO 8601 using the provided current time.
- If a rider gives multiple pieces at once ("Pick me up at 123 Main tomorrow at 9am, I'm Alex, 555-1234"), extract them all.
- When you have ALL required fields (pickup, dropoff, datetime, name, phone, payment), call the complete_booking tool. Do NOT call it before you have everything.
- If something is unclear, ask ONE brief clarifying question.
- Never ask for information you already have.
- Keep it conversational. You're a premium concierge, not a form.`;

const TOOL = {
  name: 'complete_booking',
  description:
    'Complete a scheduled ride booking. Call ONLY when you have all required fields: pickup, dropoff, datetime, rider name, phone, and payment method.',
  input_schema: {
    type: 'object',
    properties: {
      pickup: { type: 'string', description: 'Pickup location as address or place name' },
      dropoff: { type: 'string', description: 'Dropoff location as address or place name' },
      datetime_iso: { type: 'string', description: 'Pickup date/time in ISO 8601' },
      rider_name: { type: 'string', description: 'Rider full name' },
      rider_phone: { type: 'string', description: 'Rider phone number' },
      rider_email: { type: 'string', description: 'Rider email (optional, empty string if not given)' },
      payment_method: { type: 'string', enum: ['card', 'cash'], description: 'Payment method' },
      confirmation_note: { type: 'string', description: 'A short friendly confirmation message for the rider' },
    },
    required: ['pickup', 'dropoff', 'datetime_iso', 'rider_name', 'rider_phone', 'payment_method', 'confirmation_note'],
  },
};

async function parseBooking(history) {
  const client = getClient();
  if (!client) {
    const err = new Error('AI booking is not configured on this server.');
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }

  const now = new Date();
  const messages = history.map((m) => ({ role: m.role, content: m.content }));
  messages.unshift({
    role: 'user',
    content: `(Context: the current date and time is ${now.toString()} / ISO ${now.toISOString()}.)`,
  });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: SYSTEM,
    tools: [TOOL],
    messages,
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (toolUse) {
    return { type: 'booking', data: toolUse.input, note: toolUse.input.confirmation_note };
  }

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return { type: 'question', text: text || "Hey, I'm Bob! Where would you like to go?" };
}

module.exports = { parseBooking, isConfigured: () => !!process.env.ANTHROPIC_API_KEY };
