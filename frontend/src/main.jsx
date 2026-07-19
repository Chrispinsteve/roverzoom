import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';
import './styles/kiosk.css';

// Canonicalize the host: forward the raw Vercel URL to the real domain so a
// scanned QR or shared tracking link only ever lives on roverzoom.com (and
// carries the same path/query, e.g. ?track=…).
if (window.location.hostname === 'roverzooma.vercel.app') {
  window.location.replace('https://roverzoom.com' + window.location.pathname + window.location.search + window.location.hash);
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
