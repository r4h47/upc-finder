// 7-Eleven pick-screen parser. Port of ScreenTextParser.kt.
// lines: [{text, left, top, right, bottom}] in image pixels → {name, size, category, productRect, isPickScreen}
import { findSizeText } from './text.js';

export const DEFAULT_RECT = { left: 0.2, top: 0.2, right: 0.8, bottom: 0.55 };

const noise = [
  /items?\s+remain/i, /\bof\s+\d+\s+items?/i, /\bD-\d{3,}/i, /^qty\b/i, /^report$/i, /tap\s+image/i,
  /balance\s+on\s+hand/i, /upc\s+entry/i, /^(x\s*)?remove$/i, /^(home|back|undo)$/i, /item\s+fulfilled/i,
  /possibly\s+out\s+of\s+stock/i, /^(cold|frozen)\s+item$/i, /^(freezer|cooler|ambient)$/i,
  /\bsec\s*\d+/i, /\bshelf\s*\d+/i, /\bseq\s*\d+/i, /^\d{1,2}:\d{2}/, /^(4g|5g|lte|wifi)$/i,
];
const tapZoom = /tap\s+image\s+to\s+zoom|tap\s+image|image\s+to\s+zoom/i;
const remain = /items?\s+remain/i;
const qtyOrReport = /^qty\b|^report$/i;
const category = /^[A-Za-z0-9&.,'’\- ]{2,}\s*\/\s*[A-Za-z0-9&.,'’\- ]{2,}$/;
const stopBelowName = /balance\s+on\s+hand|\bsec\s*\d+|upc\s+entry|cold\s+item/i;

const h = (l) => l.bottom - l.top;

/**
 * Cleans one Tesseract line: drops edge junk from glare and bezels ("| Trident Spearmint Value | {1 |",
 * "Gum / Sugarless §"), fixes "200z" → "20oz" (zero read for the letter o) and splits "Water20oz".
 */
export function cleanOcrLine(raw) {
  const symbols = /[|~¥§«»©®™{}\[\]_<>“”‘]/g;
  // Tokens that were mostly bezel/glare symbols ("{1", "|!") are junk even if a digit survives the cleanup.
  const toks = String(raw).trim().split(/\s+/).map((tok) => {
    const cleaned = tok.replace(symbols, '');
    return { t: cleaned, junk: cleaned !== tok && (cleaned.length <= 1 || !/[A-Za-z0-9]/.test(cleaned)) };
  });
  // At the line edges, also drop lone punctuation and stray single letters ("Value I", "g Water"); keep "/" inside.
  const edge = (x) => x.junk || !/[A-Za-z0-9]/.test(x.t) || (x.t.length === 1 && !/[0-9&aA]/.test(x.t));
  while (toks.length && edge(toks[0])) toks.shift();
  while (toks.length && edge(toks.at(-1))) toks.pop();
  return toks.filter((x) => !x.junk).map((x) => x.t).join(' ')
    .replace(/(\d)0z\b/gi, '$1oz')
    .replace(/([a-z])(\d+(?:\.\d+)?\s*(?:oz|ml|l|ct|pk)\b)/gi, '$1 $2')
    .replace(/[^A-Za-z0-9)'’.%]+$/, '')
    .trim();
}

export function isNoise(text) {
  const t = text.trim();
  if (t.length < 3) return true;
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  if (letters < 2 || letters < t.length * 0.4) return true;
  return noise.some((r) => r.test(t));
}

const clamp = (r) => {
  const c = (v) => Math.min(Math.max(v, 0), 1);
  const l = c(r.left), t = c(r.top), ri = c(r.right), b = c(r.bottom);
  return { left: Math.min(l, ri), top: Math.min(t, b), right: Math.max(l, ri), bottom: Math.max(t, b) };
};

function takeTitleBlock(lines) {
  if (!lines.length) return [];
  const first = lines[0];
  const block = [first];
  for (const l of lines.slice(1)) {
    const prev = block.at(-1);
    const similar = h(l) >= h(first) * 0.7 && h(l) <= h(first) * 1.35;
    const close = l.top - prev.bottom <= h(first) * 1.2;
    if (similar && close && block.length < 3) block.push(l); else break;
  }
  return block;
}

function estimateRect(lines, anchor, nameLines, w, hgt) {
  if (w <= 0 || hgt <= 0) return DEFAULT_RECT;
  if (anchor) {
    const bottom = anchor.top;
    const qty = lines.filter((l) => qtyOrReport.test(l.text.trim()) && l.bottom < anchor.top);
    const remainLine = lines.filter((l) => remain.test(l.text) && l.bottom < anchor.top).at(-1);
    let top;
    if (qty.length) top = Math.max(...qty.map((l) => l.bottom)) + h(anchor);
    else if (remainLine) top = remainLine.bottom + (bottom - remainLine.bottom) * 0.38; // skip thumbnail strip
    else top = bottom - hgt * 0.25;
    const left = nameLines.length ? Math.min(...nameLines.map((l) => l.left)) : w / 6;
    const right = anchor.right;
    const cx = (left + right) / 2;
    const half = Math.min(Math.max((right - left) / 2, (bottom - top) * 0.6), w / 2);
    const r = clamp({ left: (cx - half) / w, top: top / hgt, right: (cx + half) / w, bottom: bottom / hgt });
    return r.right - r.left > 0.05 && r.bottom - r.top > 0.05 ? r : DEFAULT_RECT;
  }
  const nameTop = nameLines[0]?.top;
  if (nameTop != null && nameTop > hgt * 0.25) {
    return clamp({ left: 0.15, top: (nameTop - hgt * 0.3) / hgt, right: 0.85, bottom: (nameTop - 4) / hgt });
  }
  return DEFAULT_RECT;
}

export function parse(rawLines, width, height) {
  const sorted = rawLines.filter((l) => l.text.trim()).sort((a, b) => a.top - b.top || a.left - b.left);
  const anchor = sorted.find((l) => tapZoom.test(l.text));
  let nameLines, categoryText = '';

  if (anchor) {
    const below = sorted.filter((l) => l.top >= anchor.bottom - h(anchor) / 2 && l !== anchor);
    const stopIdx = below.findIndex((l) => category.test(l.text.trim()) || stopBelowName.test(l.text));
    const candidates = (stopIdx >= 0 ? below.slice(0, stopIdx) : below.slice(0, 3)).filter((l) => !isNoise(l.text));
    nameLines = takeTitleBlock(candidates);
    categoryText = below.find((l) => category.test(l.text.trim()))?.text.trim() ?? '';
  } else {
    const cleanLines = sorted.filter((l) => !isNoise(l.text) && !category.test(l.text.trim()));
    const tallest = cleanLines.reduce((a, b) => (!a || h(b) > h(a) ? b : a), null);
    nameLines = tallest ? takeTitleBlock(cleanLines.slice(cleanLines.indexOf(tallest))) : [];
    categoryText = sorted.find((l) => category.test(l.text.trim()))?.text.trim() ?? '';
  }

  const name = nameLines.map((l) => l.text.trim()).join(' ')
    .replace(/\s+/g, ' ')
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9)'’.]+$/g, '');

  return {
    name,
    size: findSizeText(name) ?? '',
    category: categoryText.replace(/\s*\/\s*/g, ' / '),
    productRect: estimateRect(sorted, anchor, nameLines, width, height),
    isPickScreen: Boolean(anchor) || sorted.some((l) => remain.test(l.text)),
  };
}
