// Match Confidence Score. Port of MatchScorer.kt — same weights and rules.
//  Brand 30 · Title tokens 45 · Size 25; +6 when sources agree; +8 for the 7-Eleven prefix on 7-Select queries;
//  +4 for a saved pick; web hits capped at 85; brand-only matches capped at 25; product-form words penalized.
import { tokens, parseSizes, normalize } from './text.js';
import { key, displayCode, SEVEN_ELEVEN_PREFIX } from './gtin.js';

export const Sources = {
  SAVED: 'Saved', OPEN_FOOD_FACTS: 'Open Food Facts', OPEN_BEAUTY_FACTS: 'Open Beauty Facts',
  OPEN_PRODUCTS_FACTS: 'Open Products Facts', UPCITEMDB: 'UPCitemdb', WEB: 'Web search',
  SCANNED: 'Scanned by you', MANUAL: 'Entered by you',
};

const variantWords = new Set([
  'slice', 'bar', 'bite', 'mini', 'cone', 'sandwich', 'multipack', 'variety', 'diet', 'zero', 'light', 'lite',
  'decaf', 'protein', 'keto', 'kid', 'travel', 'refill', 'replacement', 'head', 'sample',
]);
const toMl = { ml: 1, l: 1000, oz: 29.5735, pint: 473.176, quart: 946.353, gal: 3785.41 };
const toG = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };

export function makeQuery(text) {
  const t = tokens(text);
  const norm = normalize(text);
  let brandTokens = [];
  if (t.length) brandTokens = ['ben', 'dr', 'mr', 'mrs', 'st', 'la', 'el'].includes(t[0]) ? t.slice(0, 2) : t.slice(0, 1);
  return {
    text, tokens: t, sizes: parseSizes(text), brandTokens,
    isSevenSelect: norm.includes('7select') || norm.includes('7eleven'),
  };
}

export function sameSize(a, b) {
  const close = (x, y) => Math.abs(x - y) <= 0.04 * Math.max(x, y, 1);
  if (a.unit === b.unit) return close(a.amount, b.amount);
  const ml = toMl[a.unit] && toMl[b.unit] && close(a.amount * toMl[a.unit], b.amount * toMl[b.unit]);
  const g = toG[a.unit] && toG[b.unit] && close(a.amount * toG[a.unit], b.amount * toG[b.unit]);
  return Boolean(ml || g);
}
const convertible = (a, b) => a.unit === b.unit || (a.unit in toMl && b.unit in toMl) || (a.unit in toG && b.unit in toG);

function fuzzyIn(token, hay) {
  if (hay.has(token)) return true;
  if (token.length < 5) return false;
  for (const h of hay) if (h.length >= 5 && (h.startsWith(token) || token.startsWith(h))) return true;
  return false;
}

/** hit: {code, title, brand, size, imageUrl, source} → 0..100 */
export function score(query, hit, agreeingSources = 1) {
  if (!query.tokens.length) return 0;
  const hitTokens = new Set(tokens([hit.brand, hit.title, hit.size].join(' ')));
  const brandHay = new Set(tokens(`${hit.brand} ${hit.title}`));

  const brandScore = query.brandTokens.length && query.brandTokens.every((t) => fuzzyIn(t, brandHay)) ? 30
    : query.brandTokens.some((t) => fuzzyIn(t, brandHay)) ? 15 : 0;

  const matched = query.tokens.filter((t) => fuzzyIn(t, hitTokens)).length;
  const recall = matched / query.tokens.length;
  const extra = Math.max(hitTokens.size - matched, 0);
  const noise = Math.min(extra * 0.015, 0.15);
  const titleScore = 45 * Math.min(Math.max(recall - noise, 0), 1);

  const hitSizes = parseSizes(`${hit.title} ${hit.size}`);
  let sizeScore;
  if (!query.sizes.length) sizeScore = 15;
  else if (!hitSizes.length) sizeScore = 10;
  else if (query.sizes.some((q) => hitSizes.some((h) => sameSize(q, h)))) sizeScore = 25;
  else if (query.sizes.some((q) => hitSizes.some((h) => convertible(q, h)))) sizeScore = 0;
  else sizeScore = 6;

  const queryTok = new Set(query.tokens);
  const formPenalty = [...hitTokens].filter((t) => variantWords.has(t) && !queryTok.has(t)).length * 14;

  let total = brandScore + titleScore + sizeScore - formPenalty;
  const productTokens = query.tokens.filter((t) => !query.brandTokens.includes(t));
  const brandOnly = productTokens.length > 0 && !productTokens.some((t) => fuzzyIn(t, hitTokens));

  if (agreeingSources >= 2) total += 6;
  if (query.isSevenSelect && displayCode(hit.code)?.startsWith(SEVEN_ELEVEN_PREFIX)) total += 8;
  if (hit.source === 'SAVED') total += 4;
  if (hit.source === 'WEB') total = Math.min(total, 85);
  if (brandOnly) total = Math.min(total, 25);
  return Math.min(Math.max(Math.round(total), 0), 100);
}

/** Collapse hits for the same GTIN into ranked candidates {upc,title,brand,size,imageUrl,sources,confidence}. */
export function rank(queryText, hits) {
  const query = makeQuery(queryText);
  const groups = new Map();
  for (const h of hits) {
    const k = key(h.code);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(h);
  }
  const out = [];
  for (const group of groups.values()) {
    const sources = [...new Set(group.map((h) => h.source))];
    const independent = sources.filter((s) => s !== 'SAVED').length;
    const scores = group.map((h) => score(query, h, 1));
    const max = Math.max(...scores), min = Math.min(...scores);
    // Agreeing sources earn a bonus; sources that disagree about the code mean "check it": take the lowest.
    const confidence = max - min > 20 ? min : Math.min(max + (independent >= 2 ? 6 : 0), 100);
    const best = group[scores.indexOf(max)];
    const richest = group.reduce((a, b) =>
      (b.title.length + b.brand.length + (b.imageUrl ? 20 : 0)) > (a.title.length + a.brand.length + (a.imageUrl ? 20 : 0)) ? b : a);
    out.push({
      upc: displayCode(best.code),
      title: richest.title || best.title,
      brand: richest.brand || best.brand,
      size: group.find((h) => h.size)?.size ?? '',
      imageUrl: group.find((h) => h.imageUrl)?.imageUrl ?? null,
      sources,
      confidence,
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence || b.sources.length - a.sources.length);
}

export const band = (c) => (c >= 80 ? 'high' : c >= 50 ? 'partial' : 'low');
