// Online product databases that allow direct browser access (CORS). UPCitemdb and search engines block browsers,
// so the website offers them as one-tap "search in a new tab" links instead.

import { searchVariants } from './text.js';

const FIELDS ='code,product_name,brands,quantity,image_front_small_url,image_front_url';

async function getJson(url, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (r.status === 429) throw Object.assign(new Error('rate limited, try later'), { soft: true });
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { soft: true });
    return await r.json();
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error('timed out'), { soft: true });
    throw e;
  } finally { clearTimeout(timer); }
}

// The fast search returns taxonomy tags such as "xx:7 Select" / "en:trident"; drop the language prefix.
const untag = (s) => s.replace(/^[a-z]{2}:/, '').trim();
const str = (v) => (Array.isArray(v) ? v.filter(Boolean).map((x) => untag(String(x))).join(', ') : typeof v === 'string' ? untag(v) : '');

function toHit(p, source) {
  const code = str(p.code), title = str(p.product_name);
  if (!code || !title) return null;
  return {
    code, title, brand: str(p.brands), size: str(p.quantity),
    imageUrl: str(p.image_front_small_url) || str(p.image_front_url) || null, source,
  };
}

/** Classic search on Open Beauty / Products Facts (these hosts allow browser requests). */
function openFacts(host, source, label) {
  return {
    source, label,
    async search(q) {
      const u = `https://${host}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20&fields=${FIELDS}`;
      return ((await getJson(u)).products ?? []).map((p) => toHit(p, source)).filter(Boolean);
    },
  };
}

/**
 * Open Food Facts through its search service (search.openfoodfacts.org), the only OFF endpoint that allows
 * browser requests (world.openfoodfacts.org blocks them). It returns only products containing every word, so
 * several looser variants of the name are searched in parallel and merged; the scorer ranks the union.
 */
const openFoodFacts = {
  source: 'OPEN_FOOD_FACTS', label: 'Open Food Facts',
  async search(q) {
    const results = await Promise.allSettled(searchVariants(q).map((v) =>
      getJson(`https://search.openfoodfacts.org/search?q=${encodeURIComponent(v)}&page_size=24&fields=${FIELDS}`)));
    const ok = results.filter((r) => r.status === 'fulfilled');
    if (!ok.length) throw results[0].reason;
    const seen = new Set();
    return ok.flatMap((r) => r.value.hits ?? []).map((p) => toHit(p, 'OPEN_FOOD_FACTS'))
      .filter((h) => h && !seen.has(h.code) && seen.add(h.code));
  },
};

export const providers = [
  openFoodFacts,
  openFacts('world.openbeautyfacts.org', 'OPEN_BEAUTY_FACTS', 'Open Beauty Facts'),
  openFacts('world.openproductsfacts.org', 'OPEN_PRODUCTS_FACTS', 'Open Products Facts'),
];

export const browserSearches = (q) => [
  { label: 'Google “UPC”', url: `https://www.google.com/search?q=${encodeURIComponent(q)}+UPC` },
  { label: 'UPCitemdb', url: `https://www.upcitemdb.com/query?s=${encodeURIComponent(q)}&type=2` },
];
