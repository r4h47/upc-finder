// Online product databases that allow direct browser access (CORS). UPCitemdb and search engines block browsers,
// so the website offers them as one-tap "search in a new tab" links instead.

const FIELDS = 'code,product_name,brands,quantity,image_front_small_url,image_front_url';

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

function openFacts(host, source, label, fast = false) {
  return {
    source, label,
    async search(q) {
      if (fast) {
        try {
          const u = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=20&fields=${FIELDS}`;
          const hits = ((await getJson(u)).hits ?? []).map((p) => toHit(p, source)).filter(Boolean);
          if (hits.length) return hits;
        } catch { /* fall back to the classic search */ }
      }
      const u = `https://${host}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20&fields=${FIELDS}`;
      return ((await getJson(u)).products ?? []).map((p) => toHit(p, source)).filter(Boolean);
    },
  };
}

export const providers = [
  openFacts('world.openfoodfacts.org', 'OPEN_FOOD_FACTS', 'Open Food Facts', true),
  openFacts('world.openbeautyfacts.org', 'OPEN_BEAUTY_FACTS', 'Open Beauty Facts'),
  openFacts('world.openproductsfacts.org', 'OPEN_PRODUCTS_FACTS', 'Open Products Facts'),
];

export const browserSearches = (q) => [
  { label: 'Google “UPC”', url: `https://www.google.com/search?q=${encodeURIComponent(q)}+UPC` },
  { label: 'UPCitemdb', url: `https://www.upcitemdb.com/query?s=${encodeURIComponent(q)}&type=2` },
];
