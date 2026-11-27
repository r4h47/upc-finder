// Text normalization shared by the parser and the scorer. Port of TextNormalizer.kt.

const unitAliases = new Map([
  ['fl oz', 'oz'], ['fl. oz', 'oz'], ['floz', 'oz'], ['fl.oz', 'oz'], ['ounces', 'oz'], ['ounce', 'oz'], ['oz', 'oz'],
  ['count', 'ct'], ['ct', 'ct'], ['cnt', 'ct'], ['pieces', 'ct'], ['piece', 'ct'], ['pcs', 'ct'], ['pc', 'ct'],
  ['sticks', 'ct'], ['stick', 'ct'],
  ['pack', 'pk'], ['pk', 'pk'], ['pks', 'pk'], ['packs', 'pk'],
  ['liters', 'l'], ['liter', 'l'], ['litres', 'l'], ['litre', 'l'], ['ltr', 'l'], ['lt', 'l'], ['l', 'l'],
  ['milliliters', 'ml'], ['milliliter', 'ml'], ['ml', 'ml'],
  ['pounds', 'lb'], ['pound', 'lb'], ['lbs', 'lb'], ['lb', 'lb'],
  ['grams', 'g'], ['gram', 'g'], ['gr', 'g'], ['g', 'g'], ['kg', 'kg'],
  ['pints', 'pint'], ['pint', 'pint'], ['pt', 'pint'],
  ['quarts', 'quart'], ['quart', 'quart'], ['qt', 'quart'],
  ['gallons', 'gal'], ['gallon', 'gal'], ['gal', 'gal'],
]);

const unitPattern = [...unitAliases.keys()].sort((a, b) => b.length - a.length)
  .map((u) => u.replace(/\./g, '\\.').replace(/ /g, '\\s*')).join('|');

// "20oz", "1.5 Liter", "14 Count", "2 Pack", "12-pack"
const numericSizeSrc = `(?<![\\w.])(\\d+(?:\\.\\d+)?)\\s*-?\\s*(${unitPattern})(?![a-z])`;
const numericSize = () => new RegExp(numericSizeSrc, 'gi');
const wordSize = () => /\b(half\s+gallon|pint|quart|gallon)\b/gi;

const stopWords = new Set(['the', 'a', 'an', 'of', 'with', 'for', 'and', 'in', 'by', 'value']);

export function canonicalUnit(raw) {
  const l = raw.toLowerCase();
  return unitAliases.get(l.replace(/\s+/g, ' ').trim()) ?? unitAliases.get(l.replace(/\s+/g, '')) ?? null;
}

export function sizeToString(s) {
  const n = Number.isInteger(s.amount) ? String(s.amount) : String(s.amount);
  return `${n} ${s.unit}`;
}

/** [{amount, unit}] */
export function parseSizes(text) {
  const out = [];
  for (const m of String(text).matchAll(numericSize())) {
    const unit = canonicalUnit(m[2]);
    if (unit) out.push({ amount: Number(m[1]), unit });
  }
  if (out.length === 0) {
    for (const m of String(text).matchAll(wordSize())) {
      const w = m[1].toLowerCase();
      out.push(w.startsWith('half') ? { amount: 0.5, unit: 'gal' } : { amount: 1, unit: canonicalUnit(w) ?? w });
    }
  }
  return out;
}

export function findSizeText(text) {
  const m = numericSize().exec(text) ?? wordSize().exec(text);
  return m ? m[0].trim() : null;
}

export function normalize(text) {
  return String(text).toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’'`´]/g, '')
    .replace(/7\s*-?\s*(select|eleven|11)/g, '7$1')
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stem(t) {
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 3 && (t.endsWith('shes') || t.endsWith('ches') || t.endsWith('xes'))) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

/** Content tokens: normalized, stop words and size expressions removed, light stemming. */
export function tokens(text) {
  const without = normalize(text).replace(numericSize(), ' ').replace(wordSize(), ' ');
  const out = [];
  for (let t of without.split(' ')) {
    t = t.replace(/^\.+|\.+$/g, '');
    if (t.length <= 1 || stopWords.has(t) || /^\d+$/.test(t)) continue;
    t = stem(t);
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** Order-insensitive key used to cache a query. */
export function queryKey(text) {
  const sizes = parseSizes(text).map(sizeToString).sort();
  return [...tokens(text).sort(), ...sizes].join(' ');
}
