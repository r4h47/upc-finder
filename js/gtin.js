// GTIN helpers: check digits, normalization, UPC-E expansion. Port of the Android app's Gtin.kt.

export const SEVEN_ELEVEN_PREFIX = '052548';

const isDigits = (s) => /^\d+$/.test(s);

/** Digits only, or null if the input has anything but digits, spaces or dashes. */
export function clean(raw) {
  const s = String(raw ?? '').trim().replace(/[ -]/g, '');
  return s && isDigits(s) ? s : null;
}

/** GS1 mod-10 check digit for the payload (all digits except the check digit). */
export function checkDigit(payload) {
  let sum = 0;
  [...payload].reverse().forEach((c, i) => { sum += Number(c) * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10;
}

export function isValid(code) {
  if (![8, 12, 13, 14].includes(code.length) || !isDigits(code)) return false;
  return checkDigit(code.slice(0, -1)) === Number(code.at(-1));
}

/** Canonical 13-digit key for de-duplication, or null when invalid. */
export function key(raw) {
  const c = clean(raw);
  if (!c || !isValid(c)) return null;
  switch (c.length) {
    case 8: return c.padStart(13, '0');
    case 12: return '0' + c;
    case 13: return c;
    case 14: return c.startsWith('0') ? c.slice(1) : null;
    default: return null;
  }
}

/** Scan form: 12-digit UPC-A when possible; EAN-8 stays EAN-8 (its own symbology). */
export function displayCode(raw) {
  const c = clean(raw);
  if (c && c.length === 8 && isValid(c)) return c;
  const k = key(raw);
  if (!k) return null;
  return k.startsWith('0') ? k.slice(1) : k;
}

export function kindFor(display) {
  return display.length === 13 ? 'EAN_13' : display.length === 8 ? 'EAN_8' : 'UPC_A';
}

/** Expands an 8-digit UPC-E (small packs like gum) to UPC-A, or null if invalid. */
export function expandUpcE(upcE) {
  if (upcE.length !== 8 || !isDigits(upcE) || !'01'.includes(upcE[0])) return null;
  const ns = upcE[0], d = upcE.slice(1, 7), check = upcE[7];
  let body;
  switch (d[5]) {
    case '0': case '1': case '2': body = `${d[0]}${d[1]}${d[5]}0000${d[2]}${d[3]}${d[4]}`; break;
    case '3': body = `${d[0]}${d[1]}${d[2]}00000${d[3]}${d[4]}`; break;
    case '4': body = `${d[0]}${d[1]}${d[2]}${d[3]}00000${d[4]}`; break;
    default: body = `${d[0]}${d[1]}${d[2]}${d[3]}${d[4]}0000${d[5]}`;
  }
  const upcA = `${ns}${body}${check}`;
  return isValid(upcA) ? upcA : null;
}

/** Anything a scanner or person gives us → scan code, or null when the check digit is wrong. */
export function normalizeInput(raw) {
  const c = clean(raw);
  if (!c) return null;
  if (c.length === 8) return expandUpcE(c) ?? displayCode(c);
  return displayCode(c);
}

/** Every valid 12/13-digit GTIN in free text. */
export function findInText(text) {
  const out = [];
  for (const m of String(text).matchAll(/(?<!\d)(\d{12,13})(?!\d)/g)) {
    if (isValid(m[1]) && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** "0 12345 67890 5" for UPC-A, "4 006381 333931" for EAN-13. */
export function formatUpc(code) {
  if (code.length === 12) return `${code[0]} ${code.slice(1, 6)} ${code.slice(6, 11)} ${code[11]}`;
  if (code.length === 13) return `${code[0]} ${code.slice(1, 7)} ${code.slice(7)}`;
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  return code;
}
