// In-browser OCR with Tesseract.js (WebAssembly). The image never leaves the device; only the OCR engine and its
// English model are downloaded (once, then cached by the browser).
import { parse, cleanOcrLine } from './parser.js';

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let workerPromise;
/** Raw lines from the last OCR run (for diagnosing a misread). */
export let lastLines = [];

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some((s) => s.src === src)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = resolve; s.onerror = () => reject(new Error(`Couldn't load ${src}`));
    document.head.append(s);
  });
}

async function worker(onProgress) {
  workerPromise ??= (async () => {
    await loadScript(TESSERACT);
    return window.Tesseract.createWorker('eng', 1, {
      logger: (m) => { if (m.status === 'recognizing text') workerPromise.onProgress?.(m.progress); },
    });
  })();
  workerPromise.onProgress = onProgress;
  return workerPromise;
}

/** Decode an image file to a bitmap, downscaled to maxEdge (EXIF orientation applied by the browser). */
export async function decode(file, maxEdge = 2400) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const s = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

/** Grayscale + contrast stretch: helps Tesseract on glare-y photos of handheld screens. */
function prepare(src) {
  const scale = src.height < 1400 ? 2 : 1;
  const c = document.createElement('canvas');
  c.width = src.width * scale; c.height = src.height * scale;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = y; if (y < min) min = y; if (y > max) max = y;
  }
  const range = Math.max(max - min, 1);
  for (let i = 0; i < d.length; i += 4) { const v = ((d[i] - min) * 255) / range; d[i] = d[i + 1] = d[i + 2] = v; }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, scale };
}

/**
 * Local (adaptive) threshold via an integral image. Rescues dim, low-contrast photos of the handheld where a
 * global stretch is dominated by the black bezel, at the cost of extra noise on already-clear screenshots.
 */
function adaptive(src) {
  const scale = src.height < 1400 ? 3 : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * scale); c.height = Math.round(src.height * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const W = c.width, H = c.height, img = ctx.getImageData(0, 0, W, H), d = img.data;
  const g = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 1; y <= H; y++) {
    let row = 0;
    for (let x = 1; x <= W; x++) { row += g[(y - 1) * W + x - 1]; I[y * (W + 1) + x] = I[(y - 1) * (W + 1) + x] + row; }
  }
  const r = Math.max(8, Math.round(H / 75)), C = 12;
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
      const n = (x1 - x0 + 1) * (y1 - y0 + 1);
      const s = I[(y1 + 1) * (W + 1) + x1 + 1] - I[y0 * (W + 1) + x1 + 1] - I[(y1 + 1) * (W + 1) + x0] + I[y0 * (W + 1) + x0];
      const v = g[y * W + x] < s / n - C ? 0 : 255, k = (y * W + x) * 4;
      d[k] = d[k + 1] = d[k + 2] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, scale };
}

const quality = (p) => (p.name ? 3 : 0) + (p.isPickScreen ? 1 : 0) + (p.category ? 1 : 0) + (p.size ? 1 : 0);

/**
 * canvas → parsed pick screen {name, size, category, productRect, isPickScreen}.
 * Pass 1 reads the contrast-stretched image; if that doesn't find a confident item name on a pick screen,
 * pass 2 retries with an adaptive threshold and the better parse wins.
 */
export async function extract(canvas, onProgress) {
  let pass = 0;
  const w = await worker((v) => onProgress?.(pass === 0 ? v * 0.6 : 0.6 + v * 0.4));
  const read = async ({ canvas: prepped, scale }) => {
    const { data } = await w.recognize(prepped);
    const lines = (data.lines ?? []).map((l) => ({
      text: cleanOcrLine(l.text),
      left: l.bbox.x0 / scale, top: l.bbox.y0 / scale, right: l.bbox.x1 / scale, bottom: l.bbox.y1 / scale,
    })).filter((l) => l.text);
    return { lines, parsed: parse(lines, canvas.width, canvas.height) };
  };
  let best = await read(prepare(canvas));
  if (!best.parsed.name || !best.parsed.isPickScreen || !best.parsed.category) {
    pass = 1;
    const second = await read(adaptive(canvas));
    if (quality(second.parsed) > quality(best.parsed)) best = second;
  }
  lastLines = best.lines;
  return best.parsed;
}

/** Crop a normalized rect to a JPEG Blob (max 640px) for the comparison photo. */
export function cropToBlob(canvas, r) {
  const x = Math.round(r.left * canvas.width), y = Math.round(r.top * canvas.height);
  const w = Math.max(1, Math.round((r.right - r.left) * canvas.width)), h = Math.max(1, Math.round((r.bottom - r.top) * canvas.height));
  const s = Math.min(1, 640 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, c.width, c.height);
  return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.88));
}
