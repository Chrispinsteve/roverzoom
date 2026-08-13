import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';
import './styles/kiosk.css';

// Canonicalize the host: forward the raw Vercel URL to the real domain so a
// scanned QR or shared tracking link only ever lives on roverzoom.com (and
// carries the same path/query, e.g. ?track=…). This is a client-side backstop;
// vercel.json also redirects this host server-side (before the app loads). Both
// target the www host, which serves 200 directly (no apex→www hop).
if (window.location.hostname === 'roverzooma.vercel.app') {
  window.location.replace('https://www.roverzoom.com' + window.location.pathname + window.location.search + window.location.hash);
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
