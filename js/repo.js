// Lookup rules — same as the Android LookupRepository: parallel search, simplified retry, saved picks merged in,
// rejected codes filtered for good, your own scanned/typed codes saved at 100%.
import * as db from './db.js';
import { rank } from './scorer.js';
import { key, normalizeInput } from './gtin.js';
import { tokens, queryKey, findSizeText } from './text.js';
import { providers } from './providers.js';

export const MIN_AUTO_CONFIDENCE = 50;

function simplify(q) {
  const size = findSizeText(q);
  if (size) q = q.replace(size, ' ');
  return q.replace(/\b(value|family|king|share)\s+(pack|size)\b/gi, ' ').replace(/\s+/g, ' ').trim();
}

export async function savedHits(query) {
  const toks = tokens(query).filter((t) => t.length >= 4).slice(0, 3);
  if (!toks.length) return [];
  const rows = await db.all();
  return rows
    .filter((r) => toks.some((t) => `${r.query} ${r.title}`.toLowerCase().includes(t)))
    .map((r) => ({ code: r.upc, title: r.title || r.query, brand: r.brand, size: r.size, imageUrl: r.imageUrl, source: 'SAVED' }));
}

export async function searchOnline(query) {
  const rejected = await db.rejectedFor(queryKey(query));
  const allowed = (hits) => rank(query, hits).filter((c) => !rejected.has(key(c.upc)));
  const failures = [];
  let attempts = 0, networkErrors = 0;

  const runAll = async (q) => (await Promise.all(providers.map(async (p) => {
    attempts++;
    try { return await p.search(q); } catch (e) {
      if (!e.soft) networkErrors++;
      failures.push(`${p.label}: ${e.soft ? e.message : 'network error'}`);
      return [];
    }
  }))).flat();

  const saved = await savedHits(query);
  const hits = await runAll(query);
  let ranked = allowed([...hits, ...saved]);
  if (ranked.filter((c) => c.confidence >= MIN_AUTO_CONFIDENCE).length < 2) {
    const s = simplify(query);
    if (s && s !== query) { hits.push(...await runAll(s)); ranked = allowed([...hits, ...saved]); }
  }
  return {
    candidates: ranked.slice(0, 12),
    failures: [...new Set(failures)],
    offline: !navigator.onLine || (attempts > 0 && networkErrors >= attempts),
  };
}

export async function searchOffline(query) {
  const rejected = await db.rejectedFor(queryKey(query));
  return rank(query, await savedHits(query)).filter((c) => !rejected.has(key(c.upc)));
}

export const cached = (query) => db.findByKey(queryKey(query));

/** Insert or update the row for this query, keeping its id stable. */
export async function save(query, category, chosen, candidates, thumb) {
  const qk = queryKey(query);
  const existing = await db.findByKey(qk);
  const now = Date.now();
  const row = {
    ...(existing ? { id: existing.id } : {}),
    queryKey: qk, query, category: category || existing?.category || '',
    upc: chosen.upc, title: chosen.title, brand: chosen.brand, size: chosen.size, imageUrl: chosen.imageUrl,
    sources: chosen.sources, confidence: chosen.confidence,
    thumb: thumb ?? existing?.thumb ?? null,
    candidates, favorite: existing?.favorite ?? false,
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  };
  return db.put(row);
}

/** "Wrong barcode": block for this item; delete the saved row if it was the answer (returned for Undo). */
export async function reject(query, upc) {
  const qk = queryKey(query), k = key(upc);
  if (!k) return null;
  await db.addRejected(qk, k);
  const saved = await db.findByKey(qk);
  if (!saved) return null;
  if (key(saved.upc) === k) { await db.remove(saved.id); return saved; }
  saved.candidates = saved.candidates.filter((c) => key(c.upc) !== k);
  await db.put(saved);
  return null;
}

export async function unreject(query, upc) {
  const k = key(upc);
  if (k) await db.deleteRejected(queryKey(query), k);
}

export const restore = (row) => db.put(row);

/** Your scanned/typed code becomes this item's verified answer (100%). Returns the row id, or null if invalid. */
export async function saveManual(query, category, rawUpc, source, others, thumb) {
  const upc = normalizeInput(rawUpc);
  if (!upc) return null;
  await unreject(query, upc);
  const fromList = others.find((c) => key(c.upc) === key(upc));
  const mine = {
    upc, title: fromList?.title ?? query, brand: fromList?.brand ?? '',
    size: fromList?.size ?? (findSizeText(query) ?? ''), imageUrl: fromList?.imageUrl ?? null,
    sources: [source, ...(fromList?.sources ?? []).filter((s) => s !== source)], confidence: 100,
  };
  const list = [mine, ...others.filter((c) => key(c.upc) !== key(upc))];
  return save(query, category, mine, list, thumb);
}
