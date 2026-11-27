// Reads the barcode printed on a product with the camera. Uses the browser's BarcodeDetector (Chrome on Android)
// and falls back to ZXing elsewhere. A code must read identically twice before it's accepted.
import { expandUpcE, normalizeInput } from './gtin.js';
import { loadScript } from './ocr.js';

const ZXING = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';

function normalize(raw, format) {
  if (!raw) return null;
  return /upc_e|UPC_E/.test(String(format)) ? expandUpcE(raw) : normalizeInput(raw);
}

export async function start(video, onCode) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  await video.play();

  let last = null, stopped = false, zxingReader = null;
  const accept = (code) => {
    if (!code || stopped) return;
    if (code === last) { stopped = true; onCode(code); }
    last = code;
  };

  let native = false;
  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      native = ['upc_a', 'ean_13'].every((f) => formats.includes(f));
    } catch { native = false; }
  }

  if (native) {
    const detector = new window.BarcodeDetector({ formats: ['upc_a', 'upc_e', 'ean_13', 'ean_8'] });
    const tick = async () => {
      if (stopped) return;
      try {
        const codes = await detector.detect(video);
        accept(codes.map((c) => normalize(c.rawValue, c.format)).find(Boolean) ?? null);
      } catch { /* frame not ready */ }
      if (!stopped) setTimeout(tick, 120);
    };
    tick();
  } else {
    await loadScript(ZXING);
    const Z = window.ZXing;
    const hints = new Map([[Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8]], [Z.DecodeHintType.TRY_HARDER, true]]);
    zxingReader = new Z.BrowserMultiFormatReader(hints, 150);
    zxingReader.decodeFromStream(stream, video, (result) => {
      if (result) accept(normalize(result.getText(), Z.BarcodeFormat[result.getBarcodeFormat()]));
    });
  }

  const track = stream.getVideoTracks()[0];
  return {
    torchSupported: Boolean(track.getCapabilities?.().torch),
    async torch(on) { try { await track.applyConstraints({ advanced: [{ torch: on }] }); } catch { /* unsupported */ } },
    stop() {
      stopped = true;
      try { zxingReader?.reset(); } catch { /* ignore */ }
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}
