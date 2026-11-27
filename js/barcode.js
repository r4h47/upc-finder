// UPC-A / EAN-13 / EAN-8 encoder → module pattern (true = bar). Rendered as crisp SVG rects.
import { displayCode, kindFor } from './gtin.js';

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function ean13Bits(code13) {
  const first = Number(code13[0]);
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (PARITY[first][i - 1] === 'L' ? L : G)[Number(code13[i])];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[Number(code13[i])];
  return bits + '101';
}

function ean8Bits(code8) {
  let bits = '101';
  for (let i = 0; i < 4; i++) bits += L[Number(code8[i])];
  bits += '01010';
  for (let i = 4; i < 8; i++) bits += R[Number(code8[i])];
  return bits + '101';
}

/** {code, kind, modules: boolean[]} or null when invalid. UPC-A is EAN-13 with a leading 0 (same bars). */
export function encode(raw) {
  const code = displayCode(raw);
  if (!code) return null;
  const kind = kindFor(code);
  const bits = kind === 'EAN_8' ? ean8Bits(code) : ean13Bits(kind === 'UPC_A' ? '0' + code : code);
  return { code, kind, modules: [...bits].map((b) => b === '1') };
}

/**
 * Draws the barcode into a canvas at the device's real pixel density with a whole number of device pixels per
 * module and an 11-module quiet zone — no anti-aliased bar edges for the scanner to misread.
 */
export function draw(canvas, raw) {
  const e = encode(raw);
  if (!e) return null;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 320, cssH = canvas.clientHeight || 120;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const quiet = 11;
  const module = Math.max(1, Math.floor(canvas.width / (e.modules.length + quiet * 2)));
  const start = Math.floor((canvas.width - module * e.modules.length) / 2);
  ctx.fillStyle = '#000';
  for (let x = 0; x < e.modules.length;) {
    if (!e.modules[x]) { x++; continue; }
    let run = 1;
    while (x + run < e.modules.length && e.modules[x + run]) run++;
    ctx.fillRect(start + x * module, 0, run * module, canvas.height);
    x += run;
  }
  return e;
}
