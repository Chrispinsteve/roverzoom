import app from '../backend/server.js';

// Vercel's Node runtime parses the request body itself by default, which
// consumes the stream before Express's own express.json() middleware can —
// leaving req.body empty. Disabling it here lets Express handle parsing.
export const config = { api: { bodyParser: false } };
export default app;
