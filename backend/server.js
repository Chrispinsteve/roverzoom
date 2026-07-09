require('dotenv').config();
const express = require('express');
const cors = require('cors');

const quoteRoutes = require('./routes/quote');
const bookingRoutes = require('./routes/bookings');
const aiRoutes = require('./routes/ai');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'roverzoom-api' }));
app.use('/api', quoteRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/ai', aiRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Only bind a port for local/standalone use (`node server.js`). When this
// file is required by api/index.js on Vercel, the exported app is invoked
// per-request by the serverless runtime instead — it must not also listen.
if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`RoverZoom API on http://localhost:${PORT}`));
}

module.exports = app;
