import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

// Real, scannable QR — encodes the current kiosk URL so a phone camera
// lands the rider on the same booking flow, no external service call.
export default function QrCode({ value, size = 168 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 1,
      color: { dark: '#0B0B0B', light: '#FFFFFF' },
    }).catch((err) => console.error('QR render failed:', err));
  }, [value, size]);

  return <canvas ref={canvasRef} className="k-qr-canvas" width={size} height={size} />;
}
