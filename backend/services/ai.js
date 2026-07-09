// Conversational booking parser powered by Claude.
//
// Uses the Messages API with a single tool ("record_booking") so the model
// returns STRUCTURED JSON rather than prose we'd have to parse. The model
// either calls the tool with whatever fields it has extracted (marking
// missing ones) or asks one concise clarifying question.
//
// The API key lives only here, on the server. It is never sent to the client.

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-4-6'; // fast + inexpensive; ideal for parsing

function getClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

const SYSTEM = `You are the booking assistant for RoverZoom, a premium scheduled-ride service.
Your job: turn a rider's natural-language request into a structured scheduled booking.

Rules:
- Rides are SCHEDULED in advance. If no date is given, assume the soonest sensible upcoming time and confirm it.
- Extract: pickup location, dropoff location, and the scheduled date + time.
- Resolve relative times ("tomorrow at 8am", "in 2 hours", "next Friday evening") into a concrete ISO 8601 datetime using the provided current time.
- Interpret vague places ("the airport", "my office") by asking a brief clarifying question ONLY if you truly cannot proceed. Prefer to proceed and let the rider correct.
- Keep replies short, warm, and premium in tone. One question at a time.
- When you have enough to book (pickup, dropoff, datetime), call the record_booking tool. Otherwise, ask ONE clarifying question and do not call the tool.`;

const TOOL = {
  name: 'record_booking',
  description:
    'Record a scheduled ride once pickup, dropoff, and date/time are known. Only call when you have all three.',
  input_schema: {
    type: 'object',
    properties: {
      pickup: { type: 'string', description: 'Pickup location as a full address or clear place name' },
      dropoff: { type: 'string', description: 'Dropoff location as a full address or clear place name' },
      datetime_iso: {
        type: 'string',
        description: 'The scheduled pickup date and time in ISO 8601, resolved to a concrete moment',
      },
      confirmation_note: {
        type: 'string',
        description: 'A short friendly one-line confirmation to show the rider, e.g. "Got it — booking your ride to JFK tomorrow at 8:00 AM."',
      },
    },
    required: ['pickup', 'dropoff', 'datetime_iso', 'confirmation_note'],
  },
};

/**
 * @param {{role:'user'|'assistant', content:string}[]} history
 * @returns {Promise<{type:'question', text:string} | {type:'booking', data:object, note:string}>}
 */
async function parseBooking(history) {
  const client = getClient();
  if (!client) {
    const err = new Error('AI booking is not configured on this server.');
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }

  const now = new Date();
  const messages = history.map((m) => ({ role: m.role, content: m.content }));
  // Anchor relative-time resolution with the current moment.
  messages.unshift({
    role: 'user',
    content: `(Context: the current date and time is ${now.toString()} / ISO ${now.toISOString()}.)`,
  });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 700,
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
  return { type: 'question', text: text || 'Could you tell me your pickup, destination, and time?' };
}

module.exports = { parseBooking, isConfigured: () => !!process.env.ANTHROPIC_API_KEY };
