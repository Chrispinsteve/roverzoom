import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

// Real, scannable QR — encodes the current kiosk URL so a phone camera
// lands the rider on the same booking flow, no external service call.
//
// `.k-qr-box` (the parent) is a responsive box (clamp(120px,14vw,168px)) so
// it can grow/shrink with viewport width. We always render the canvas at a
// fixed, generous internal resolution for crispness, then let CSS's
// `.k-qr-box canvas{ width:100%; height:100% }` scale it down to fit —
// EXCEPT the `qrcode` library itself sets an inline `style="width:...px;
// height:...px"` on the canvas after drawing, and inline styles always beat
// stylesheet rules. Left alone, that pins the QR to a fixed pixel size
// regardless of its box, so it visually detaches/misaligns as the box
// resizes. Clearing that inline style after render hands sizing back to CSS.
const RENDER_SIZE = 640;

export default function QrCode({ value }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, value, {
      width: RENDER_SIZE,
      // margin is the mandatory "quiet zone" in modules — 4 is the QR-spec
      // minimum for reliable scanning; 1 (the old value) is why phones
      // struggled. errorCorrectionLevel 'Q' recovers ~25%, so glare/angle on
      // a glossy in-car screen still scans.
      margin: 4,
      errorCorrectionLevel: 'Q',
      color: { dark: '#000000', light: '#FFFFFF' },
    })
      .then(() => {
        canvasRef.current.style.width = '100%';
        canvasRef.current.style.height = '100%';
      })
      .catch((err) => console.error('QR render failed:', err));
  }, [value]);

  return <canvas ref={canvasRef} className="k-qr-canvas" />;
}
