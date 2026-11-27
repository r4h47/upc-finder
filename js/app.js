// UPC Finder — web edition. Same flow as the Android app:
// photo/screenshot → on-device OCR → online lookup → scannable barcode, with an offline on-device database,
// your own scanned/typed barcodes, and "Wrong barcode" blocking.
import * as db from './db.js';
import * as repo from './repo.js';
import { band, Sources } from './scorer.js';
import { formatUpc, normalizeInput, key } from './gtin.js';
import { draw as drawBarcode } from './barcode.js';
import { DEFAULT_RECT } from './parser.js';
import { parseSizes, normalize, queryKey, tokens } from './text.js';
import { browserSearches } from './providers.js';
import * as ocr from './ocr.js';
import * as scanner from './scanner.js';

// ---------------------------------------------------------------------------------------------------------- icons
const P = {
  camera: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9z',
  gallery: 'M22 16V4c0-1.1-.9-2-2-2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2zm-11-4 2.03 2.71L16 11l4 5H8l3-4zM2 6v14c0 1.1.9 2 2 2h14v-2H4V6H2z',
  history: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
  search: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  star: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  starOutline: 'm22 9.24-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z',
  copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
  full: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  sun: 'M20 8.69V4h-4.69L12 .69 8.69 4H4v4.69L.69 12 4 15.31V20h4.69L12 23.31 15.31 20H20v-4.69L23.31 12 20 8.69zM12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6zm0-10c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4z',
  refresh: 'M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  scan: 'M9.5 6.5v3h-3v-3h3M11 5H5v6h6V5zm-1.5 9.5v3h-3v-3h3M11 13H5v6h6v-6zm6.5-6.5v3h-3v-3h3M19 5h-6v6h6V5zm-6 8h1.5v1.5H13V13zm1.5 1.5H16V16h-1.5v-1.5zM16 13h1.5v1.5H16V13zm-3 3h1.5v1.5H13V16zm1.5 1.5H16V19h-1.5v-1.5zM16 16h1.5v1.5H16V16zm1.5-1.5H19V16h-1.5v-1.5zm0 3H19V19h-1.5v-1.5zM22 7h-2V4h-3V2h5v5zm0 15v-5h-2v3h-3v2h5zM2 22h5v-2H4v-3H2v5zM2 2v5h2V4h3V2H2z',
  block: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.902 7.902 0 0 1 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.902 7.902 0 0 1 20 12c0 4.42-3.58 8-8 8z',
  open: 'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
  info: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z',
  ok: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
  box: 'M20 2H4c-1 0-2 .9-2 2v3.01c0 .72.43 1.34 1 1.69V20c0 1.1 1.1 2 2 2h14c.9 0 2-.9 2-2V8.7c.57-.35 1-.97 1-1.69V4c0-1.1-1-2-2-2zm-1 18H5V9h14v11zm1-13H4V4h16v3zM9 12h6v2H9z',
  trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM8 9h8v10H8V9zm7.5-5-1-1h-5l-1 1H5v2h14V4z',
  save: 'M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm2 16H5V5h11.17L19 7.83V19zm-7-7c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3zM6 6h9v4H6z',
  keyboard: 'M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z',
  torch: 'M6 2h12v3H6zm0 5v1l2 3v11h8V11l2-3V7H6zm6 8.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${P[n]}"/></svg>`;

// ---------------------------------------------------------------------------------------------------------- utils
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const buzz = (ms = 12) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const pref = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const blobUrls = new WeakMap();
const urlFor = (blob) => { if (!blob) return null; if (!blobUrls.has(blob)) blobUrls.set(blob, URL.createObjectURL(blob)); return blobUrls.get(blob); };
const sourceLabel = (s) => Sources[s] ?? s;

export function buildQuery(name, size) {
  const n = name.trim().replace(/\s+/g, ' '), s = size.trim();
  if (!s) return n;
  const ns = parseSizes(n).map((x) => `${x.amount}${x.unit}`), ss = parseSizes(s).map((x) => `${x.amount}${x.unit}`);
  const already = ns.length && ss.every((x) => ns.includes(x));
  return already || normalize(n).includes(normalize(s)) ? n : `${n} ${s}`.trim();
}

// ---------------------------------------------------------------------------------------------------------- state
const emptyCapture = () => ({ canvas: null, imageUrl: null, ocr: 'idle', progress: 0, name: '', size: '', category: '', rect: { ...DEFAULT_RECT }, isPickScreen: false, error: null });
const emptyResult = () => ({ query: '', category: '', thumb: null, historyId: null, loading: false, candidates: [], selectedUpc: null, fromCache: false, favorite: false, notes: [], error: null, userSelected: false });

const state = {
  route: 'home', history: [], capture: emptyCapture(), result: emptyResult(),
  draft: null, editing: false, histFilter: 0, histSearch: '', keepAwake: pref('keepAwake', true),
};
const selected = (r = state.result) => r.candidates.find((c) => c.upc === r.selectedUpc) ?? r.candidates[0] ?? null;
const confident = (r = state.result) => { const s = selected(r); return s && (r.userSelected || s.confidence >= repo.MIN_AUTO_CONFIDENCE) ? s : null; };

async function refreshHistory() { state.history = await db.all(); if (['home', 'history'].includes(state.route)) render(); }

// ---------------------------------------------------------------------------------------------------------- routing
const routes = ['home', 'crop', 'result', 'history'];
function go(route, { replace = false } = {}) {
  const h = `#/${route}`;
  if (replace) history.replaceState(null, '', h); else history.pushState(null, '', h);
  show(route);
}
function show(route) {
  if (!routes.includes(route)) route = 'home';
  if ((route === 'crop' && !state.capture.canvas && state.capture.ocr === 'idle') || (route === 'result' && !state.result.query)) route = 'home';
  const change = () => { state.route = route; state.editing = false; render(); window.scrollTo(0, 0); };
  if (document.startViewTransition && !reducedMotion() && state.route !== route) document.startViewTransition(change); else change();
}
addEventListener('popstate', () => show(location.hash.replace('#/', '') || 'home'));

// ---------------------------------------------------------------------------------------------------------- render
function render() {
  const app = $('#app');
  app.innerHTML = { home: homeView, crop: cropView, result: resultView, history: historyView }[state.route]();
  afterRender();
  updateWakeLock();
}

function topbar({ title, sub, nav, navLabel = 'Back', actions = '' }) {
  return `<header class="topbar">${nav ? `<button class="icon-btn" data-act="${nav.act}" aria-label="${navLabel}">${icon(nav.icon)}</button>` : '<span style="width:12px"></span>'}
    <div class="titles"><h1>${esc(title)}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>${actions}</header>`;
}

const thumbHtml = (blob, url, cls = '', vt = '') => {
  const src = blob ? urlFor(blob) : url;
  return `<span class="thumb ${cls}" ${vt ? `style="view-transition-name:${vt}"` : ''}>${src ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : icon('box')}</span>`;
};
const badge = (c) => `<span class="badge ${band(c)}" aria-label="${{ high: 'High', partial: 'Partial', low: 'Low' }[band(c)]} match confidence, ${c} percent">${c}%</span>`;

function lookupRow(e, trailing = '') {
  return `<li><button class="main" data-act="open" data-id="${e.id}" aria-label="Show barcode for ${esc(e.title || e.query)}">
      ${thumbHtml(e.thumb, e.imageUrl, '', `thumb-${e.id}`)}
      <span class="grow"><span class="t">${esc(e.title || e.query)}</span>
      <span class="row" style="gap:10px;margin-top:2px"><span class="code upc muted">${esc(e.upc)}</span>${badge(e.confidence)}</span></span>
    </button>${trailing}</li>`;
}

function homeView() {
  const recent = state.history.slice(0, 12);
  return `<section class="screen">
    ${topbar({ title: 'UPC Finder', sub: 'Photo of the pick screen → scannable barcode', actions:
      `<button class="icon-btn" data-act="draft-new" aria-label="Save a barcode from a product">${icon('scan')}</button>
       <button class="icon-btn" data-act="go-history" aria-label="History">${icon('history')}</button>` })}
    <div class="content">
      ${recent.length ? `<div class="label" style="margin-top:4px">Recent — tap to show barcode</div>
        <ul class="list">${recent.map((e) => lookupRow(e, e.favorite ? `<span class="icon-btn on" aria-label="Favorite" role="img">${icon('star')}</span>` : '')).join('')}</ul>`
        : `<div class="empty"><h2 class="display">Barcode won't scan?</h2><div class="steps">
          <div><b>1</b>Snap the handheld's item screen, or pick a screenshot.</div>
          <div><b>2</b>Check the item name the app read. Edit it if needed.</div>
          <div><b>3</b>Hold your phone under the scanner. Tap Full for the brightest barcode.</div></div></div>`}
    </div>
    <footer class="bottombar">
      <form class="search field" data-form="search" role="search">
        <span class="lead">${icon('search')}</span>
        <input name="q" type="search" enterkeyhint="search" placeholder="Or type an item name" aria-label="Type an item name" autocomplete="off">
      </form>
      <div class="row">
        <button class="btn btn-secondary grow" data-act="gallery">${icon('gallery')}Gallery</button>
        <button class="btn btn-primary" style="flex:1.4" data-act="camera">${icon('camera')}Camera</button>
      </div>
    </footer></section>`;
}

function cropView() {
  const c = state.capture, reading = c.ocr === 'running';
  const sub = reading ? 'Reading text on device…' : c.ocr === 'failed' ? "Couldn't read text — type it below" : c.isPickScreen ? 'Pick screen detected' : 'Edit anything that looks wrong';
  const ratio = c.canvas ? `${c.canvas.width} / ${c.canvas.height}` : '3 / 4';
  return `<section class="screen">
    ${topbar({ title: 'Check the item', sub, nav: { act: 'go-home', icon: 'close' }, navLabel: 'Close' })}
    <div class="content">
      ${reading ? `<div class="progress" role="progressbar" aria-label="Reading text" aria-valuenow="${Math.round(c.progress * 100)}"><i style="width:${Math.max(5, c.progress * 100)}%"></i></div>` : ''}
      ${c.error ? `<p class="note err">${icon('info')}${esc(c.error)}</p>` : ''}
      ${c.imageUrl ? `<div class="label">Product photo — drag the box to adjust</div>
        <div class="cropwrap" id="cropwrap" style="aspect-ratio:${ratio}">
          <img src="${c.imageUrl}" alt="" draggable="false">
          <div class="cropbox" id="cropbox" role="img" aria-label="Product crop box. Drag to adjust.">
            <span class="h tl" data-h="tl"></span><span class="h tr" data-h="tr"></span><span class="h bl" data-h="bl"></span><span class="h br" data-h="br"></span>
          </div></div>` : ''}
      <div class="label">Item details</div>
      ${reading ? `<div class="sk" style="height:64px"></div><div class="sk" style="height:56px;margin-top:12px"></div><div class="sk" style="height:56px;margin-top:12px"></div>`
        : `${c.ocr === 'done' && !c.isPickScreen ? `<p class="note warn">${icon('info')}No 7-Eleven pick screen found. Check the name — it was guessed from the largest text.</p>` : ''}
        <div style="display:flex;flex-direction:column;gap:12px">
          <div class="field"><label for="f-name">Item name</label><textarea id="f-name" rows="2" data-bind="name">${esc(c.name)}</textarea></div>
          <div class="field"><label for="f-size">Size / count</label><input id="f-size" data-bind="size" value="${esc(c.size)}" autocomplete="off"></div>
          <div class="field"><label for="f-cat">Category (not searched)</label><input id="f-cat" data-bind="category" value="${esc(c.category)}" autocomplete="off" enterkeyhint="search"></div>
        </div>`}
    </div>
    <footer class="bottombar"><div class="row">
      <button class="btn btn-secondary grow" data-act="camera">${icon('refresh')}Retake</button>
      <button class="btn btn-primary" style="flex:1.6" data-act="find" ${reading || !c.name.trim() ? 'disabled' : ''}>${icon('search')}Find UPC</button>
    </div></footer></section>`;
}

function resultView() {
  const r = state.result, sel = confident(r), guess = selected(r);
  const title = r.loading && !sel ? 'Searching…' : sel ? (r.fromCache && !r.loading ? 'Saved match' : 'Best match') : r.candidates.length ? 'Check these guesses' : 'No match';
  const star = r.historyId != null ? `<button class="icon-btn ${r.favorite ? 'on' : ''}" data-act="fav" aria-pressed="${r.favorite}" aria-label="${r.favorite ? 'Remove from favorites' : 'Add to favorites'}">${icon(r.favorite ? 'star' : 'starOutline')}</button>` : '';
  let main;
  if (sel) main = matchHeader(r, sel);
  else if (r.loading) main = loadingBlock();
  else main = notFoundBlock(r);

  const list = r.candidates.length > 1 || (!sel && r.candidates.length) ? `
    <div class="label">${sel ? `All matches (${r.candidates.length}) — tap to switch` : `Possible matches (${r.candidates.length}) — compare, then tap to use`}</div>
    <ul class="list">${r.candidates.map((c) => `<li>
      <button class="main" data-act="select" data-upc="${c.upc}" role="radio" aria-checked="${c.upc === sel?.upc}">
        <span class="dot ${c.upc === sel?.upc ? 'on' : ''}"></span>${thumbHtml(null, c.imageUrl, 'sm')}
        <span class="grow"><span class="t normal">${esc(c.title)}</span><span class="code upc" style="display:block">${c.upc}</span>
        <span class="meta" style="display:block">${esc([c.size, c.sources.map(sourceLabel).join(', ')].filter(Boolean).join('  ·  '))}</span></span>${badge(c.confidence)}
      </button><button class="icon-btn" data-act="reject" data-upc="${c.upc}" aria-label="Wrong barcode, remove ${c.upc}" style="color:var(--ink-muted)">${icon('close')}</button></li>`).join('')}</ul>` : '';

  const links = sel && !r.loading ? `<p class="muted" style="margin:16px 0 0">Not the right item?</p><div class="links">${browserLinks(r.query)}
    ${r.fromCache ? `<button class="text-btn" data-act="retry">${icon('refresh')}Search online again</button>` : ''}</div>` : '';
  const notes = r.notes.length && !r.loading ? `<p class="muted small" style="margin-top:16px">Some sources didn't answer: ${esc(r.notes.join(' · '))}</p>` : '';

  return `<section class="screen">
    ${topbar({ title, sub: r.query, nav: { act: 'back', icon: 'back' }, actions: `<button class="icon-btn" data-act="edit" aria-label="Edit search">${icon('edit')}</button>${star}` })}
    <div class="content">
      ${state.editing ? `<form class="field" data-form="requery" style="margin:8px 0"><label for="rq">Search for</label>
        <textarea id="rq" name="q" rows="2" enterkeyhint="search">${esc(r.query)}</textarea>
        <div class="row" style="justify-content:flex-end"><button type="button" class="text-btn" data-act="edit">Cancel</button><button class="text-btn">${icon('search')}Search</button></div></form>` : ''}
      ${main}
      ${r.loading && sel ? '<p class="muted small" style="margin-top:12px">Checking online for better matches…</p>' : ''}
      ${list}${links}${notes}
      ${!sel && guess && !r.loading ? '' : ''}
    </div>
    ${sel ? `<footer class="bottombar"><div class="row">
      <button class="icon-btn btn-secondary ${state.keepAwake ? 'on' : ''}" style="width:56px;height:56px;border-radius:28px;background:var(--slate-raised)" data-act="awake" aria-pressed="${state.keepAwake}" aria-label="Keep screen on while the barcode is shown">${icon('sun')}</button>
      <button class="btn btn-secondary grow" data-act="full">${icon('full')}Full</button>
      <button class="btn btn-primary" style="flex:1.5" data-act="copy">${icon('copy')}Copy UPC</button>
    </div></footer>` : ''}
  </section>`;
}

const browserLinks = (q) => browserSearches(q).map((s) =>
  `<a class="text-btn" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${icon('open')}${esc(s.label)}</a>`).join('');

function matchHeader(r, c) {
  const meta = [c.brand, c.size].filter(Boolean).join(' · ');
  const compare = r.thumb || c.imageUrl ? `<div class="label">Compare</div><div class="compare">
      <figure><div class="box" style="view-transition-name:${r.historyId != null ? `thumb-${r.historyId}` : 'none'}">${r.thumb ? `<img src="${urlFor(r.thumb)}" alt="Your photo of the item">` : icon('box')}</div><figcaption>Your photo</figcaption></figure>
      <figure><div class="box">${c.imageUrl ? `<img src="${esc(c.imageUrl)}" alt="Online product photo" referrerpolicy="no-referrer">` : icon('box')}</div><figcaption>Online</figcaption></figure></div>` : '';
  return `<div style="margin-top:8px">
    <button class="pad" data-act="full" aria-label="Barcode ${c.upc}. Tap for full screen."><canvas id="pad" aria-hidden="true"></canvas><span class="digits">${formatUpc(c.upc)}</span></button>
    <div class="row" style="align-items:flex-start;margin-top:16px"><div class="grow"><h2 class="display">${esc(c.title)}</h2>
      ${meta ? `<div class="muted">${esc(meta)}</div>` : ''}</div>${badge(c.confidence)}</div>
    <div class="muted small" style="margin-top:4px">Source: ${esc(c.sources.map(sourceLabel).join(', '))}</div>
    <div class="links" style="margin-top:4px">
      <button class="text-btn danger" data-act="reject" data-upc="${c.upc}">${icon('block')}Wrong barcode</button>
      <button class="text-btn" data-act="draft-current">${icon('scan')}Add correct UPC</button>
    </div>${compare}</div>`;
}

const loadingBlock = () => `<div style="margin-top:8px" aria-label="Searching for UPC">
  <div class="sk" style="height:200px;border-radius:16px"></div><div class="sk" style="height:28px;width:85%;margin-top:16px"></div>
  <div class="sk" style="height:16px;width:50%;margin-top:8px"></div>
  <p class="muted">Checking your saved items and Open Food / Beauty / Products Facts…</p>
  ${'<div class="row" style="padding:10px 0"><div class="sk" style="width:48px;height:48px"></div><div class="grow"><div class="sk" style="height:16px;width:90%"></div><div class="sk" style="height:14px;width:55%;margin-top:6px"></div></div></div>'.repeat(3)}</div>`;

function notFoundBlock(r) {
  const offline = r.error === 'offline', guesses = r.candidates.length > 0;
  return `<div style="margin-top:24px">
    <h2 class="display">${offline ? "You're offline" : guesses ? 'No confident match' : 'No UPC found online'}</h2>
    <p class="muted" style="font-size:16px;line-height:24px">${offline ? 'Nothing saved matches this item yet. Connect and retry.'
      : guesses ? "The closest results below don't clearly match name and size. Check the photo and size before using one, or search the web."
      : 'Try a shorter name (brand + product + size), or search the web — the UPC is often in the first result.'}</p>
    <div class="row" style="margin-top:20px"><button class="btn btn-secondary grow" data-act="edit">${icon('edit')}Edit name</button>
      <button class="btn btn-primary grow" data-act="retry">${icon('refresh')}Retry</button></div>
    <button class="btn btn-secondary" style="width:100%;margin-top:12px" data-act="draft-current">${icon('scan')}Scan or type the UPC yourself</button>
    <div class="links" style="margin-top:8px">${browserLinks(r.query)}</div></div>`;
}

function historyView() {
  const toks = tokens(state.histSearch);
  const shown = state.history.filter((e) => (state.histFilter === 0 || e.favorite) && (!state.histSearch.trim()
    || e.upc.includes(state.histSearch.trim()) || toks.every((q) => tokens(`${e.query} ${e.title}`).some((t) => t.startsWith(q)))));
  const empty = !state.history.length ? 'Nothing saved yet. Every UPC you find is kept here for offline use.'
    : state.histFilter === 1 && !state.histSearch ? 'No favorites yet. Tap the star on a result to pin it here.' : `No saved item matches “${esc(state.histSearch)}”.`;
  return `<section class="screen">
    ${topbar({ title: 'History', sub: `${state.history.length} saved · works offline`, nav: { act: 'back', icon: 'back' } })}
    <div style="padding:0 var(--gutter);display:flex;flex-direction:column;gap:12px">
      <div class="search field"><span class="lead">${icon('search')}</span><input type="search" data-bind="histSearch" value="${esc(state.histSearch)}" placeholder="Search name or UPC" aria-label="Search history"></div>
      <div class="segmented" role="group" aria-label="Filter">${['All', 'Favorites'].map((l, i) => `<button data-act="filter" data-i="${i}" aria-pressed="${state.histFilter === i}">${l}</button>`).join('')}</div>
    </div>
    <div class="content">${shown.length ? `<ul class="list">${shown.map((e) => lookupRow(e,
      `<button class="icon-btn ${e.favorite ? 'on' : ''}" data-act="fav-row" data-id="${e.id}" aria-pressed="${e.favorite}" aria-label="${e.favorite ? 'Remove from favorites' : 'Add to favorites'}" style="${e.favorite ? '' : 'color:var(--ink-muted)'}">${icon(e.favorite ? 'star' : 'starOutline')}</button>
       <button class="icon-btn" data-act="delete-row" data-id="${e.id}" aria-label="Delete ${esc(e.title || e.query)}" style="color:var(--ink-muted)">${icon('trash')}</button>`)).join('')}</ul>`
      : `<p class="muted" style="margin-top:32px;font-size:16px">${empty}</p>`}</div></section>`;
}

function afterRender() {
  const sel = confident();
  const pad = $('#pad');
  if (pad && sel) drawBarcode(pad, sel.upc);
  if (state.route === 'crop') setupCrop();
}

// ---------------------------------------------------------------------------------------------------------- crop box
function placeCropBox() {
  const box = $('#cropbox'); if (!box) return;
  const r = state.capture.rect;
  Object.assign(box.style, { left: `${r.left * 100}%`, top: `${r.top * 100}%`, width: `${(r.right - r.left) * 100}%`, height: `${(r.bottom - r.top) * 100}%` });
}
function setupCrop() {
  const wrap = $('#cropwrap'); if (!wrap) return;
  placeCropBox();
  let drag = null;
  wrap.addEventListener('pointerdown', (ev) => {
    const b = wrap.getBoundingClientRect(), r = state.capture.rect;
    const x = (ev.clientX - b.left) / b.width, y = (ev.clientY - b.top) / b.height;
    const h = ev.target.dataset?.h;
    if (h) drag = { h };
    else if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) drag = { h: 'move' };
    else return;
    drag.x = x; drag.y = y; drag.start = { ...r };
    wrap.setPointerCapture(ev.pointerId); ev.preventDefault();
  });
  wrap.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const b = wrap.getBoundingClientRect();
    const dx = (ev.clientX - b.left) / b.width - drag.x, dy = (ev.clientY - b.top) / b.height - drag.y;
    const s = drag.start, min = 0.08, cl = (v) => Math.min(Math.max(v, 0), 1);
    let r = { ...s };
    if (drag.h === 'move') {
      const mx = Math.min(Math.max(dx, -s.left), 1 - s.right), my = Math.min(Math.max(dy, -s.top), 1 - s.bottom);
      r = { left: s.left + mx, right: s.right + mx, top: s.top + my, bottom: s.bottom + my };
    } else {
      if (drag.h.includes('l')) r.left = cl(Math.min(s.left + dx, s.right - min));
      if (drag.h.includes('r')) r.right = cl(Math.max(s.right + dx, s.left + min));
      if (drag.h.includes('t')) r.top = cl(Math.min(s.top + dy, s.bottom - min));
      if (drag.h.includes('b')) r.bottom = cl(Math.max(s.bottom + dy, s.top + min));
    }
    state.capture.rect = r; placeCropBox();
  });
  const end = () => { drag = null; };
  wrap.addEventListener('pointerup', end); wrap.addEventListener('pointercancel', end);
}

// ---------------------------------------------------------------------------------------------------------- capture
async function onImageFile(file) {
  if (!file) return;
  state.capture = { ...emptyCapture(), ocr: 'running' };
  go('crop', { replace: state.route === 'crop' });
  let canvas;
  try { canvas = await ocr.decode(file); } catch {
    state.capture = { ...emptyCapture(), ocr: 'failed', error: "Couldn't open that image." }; return render();
  }
  state.capture.canvas = canvas;
  state.capture.imageUrl = await new Promise((res) => canvas.toBlob((b) => res(urlFor(b)), 'image/jpeg', 0.9));
  if (state.route === 'crop') render();
  try {
    const p = await ocr.extract(canvas, (v) => {
      state.capture.progress = v;
      const bar = $('.progress > i'); if (bar) bar.style.width = `${Math.max(5, v * 100)}%`;
    });
    Object.assign(state.capture, { ocr: 'done', name: p.name, size: p.size, category: p.category, rect: p.productRect, isPickScreen: p.isPickScreen });
  } catch (e) {
    console.warn('OCR failed', e);
    Object.assign(state.capture, { ocr: 'failed', error: navigator.onLine ? null : 'The OCR engine downloads on first use — connect once, then it works offline.' });
  }
  if (state.route === 'crop') render();
}

async function lookupFromCapture() {
  const c = state.capture;
  const query = buildQuery(c.name, c.size);
  if (!query) return;
  const thumb = c.canvas ? await ocr.cropToBlob(c.canvas, c.rect) : null;
  state.result = { ...emptyResult(), query, category: c.category, thumb, loading: true };
  go('result');
  runLookup(query, c.category, thumb);
}

function lookupText(q, keepThumb = false) {
  q = q.trim(); if (!q) return;
  const prev = state.result;
  state.result = { ...emptyResult(), query: q, category: keepThumb ? prev.category : '', thumb: keepThumb ? prev.thumb : null, loading: true };
  if (state.route !== 'result') go('result'); else render();
  runLookup(q, state.result.category, state.result.thumb);
}

let lookupToken = 0;
async function runLookup(query, category, thumb) {
  const token = ++lookupToken;
  const live = () => token === lookupToken;
  const set = (patch) => { if (live()) { Object.assign(state.result, patch); if (state.route === 'result') render(); } };

  const cachedRow = await repo.cached(query);
  if (cachedRow && live()) {
    set({ historyId: cachedRow.id, candidates: cachedRow.candidates?.length ? cachedRow.candidates : [rowToCandidate(cachedRow)],
      selectedUpc: cachedRow.upc, fromCache: true, favorite: cachedRow.favorite, userSelected: true, thumb: thumb ?? cachedRow.thumb });
  }
  let online = null;
  try { online = await repo.searchOnline(query); } catch (e) { console.warn('lookup failed', e); }
  if (!live()) return;
  let found = online?.candidates ?? [];

  if (!found.length) {
    if (cachedRow) return set({ loading: false, notes: online?.failures ?? [] });
    const off = online == null || online.offline ? await repo.searchOffline(query) : [];
    return set({ loading: false, candidates: off, selectedUpc: off[0]?.upc ?? null, fromCache: off.length > 0, notes: online?.failures ?? [],
      error: off.length ? null : online == null || online.offline ? 'offline' : 'notfound' });
  }
  // Your saved choice (picked, scanned or typed) always wins over fresh database results.
  const savedChoice = cachedRow ? (cachedRow.candidates?.find((c) => c.upc === cachedRow.upc) ?? rowToCandidate(cachedRow)) : null;
  if (savedChoice && !found.some((c) => c.upc === savedChoice.upc)) found = [savedChoice, ...found];
  const sel = savedChoice?.upc ?? found[0].upc;
  const chosen = found.find((c) => c.upc === sel);
  const worth = savedChoice != null || chosen.confidence >= repo.MIN_AUTO_CONFIDENCE;
  const id = worth ? await repo.save(query, category, chosen, found, thumb) : cachedRow?.id ?? null;
  const row = id != null ? await db.get(id) : null;
  set({ loading: false, candidates: found, selectedUpc: sel, fromCache: false, historyId: id, favorite: row?.favorite ?? false,
    notes: online.failures, error: null, userSelected: savedChoice != null, thumb: thumb ?? cachedRow?.thumb ?? null });
  refreshHistory();
}

const rowToCandidate = (e) => ({ upc: e.upc, title: e.title, brand: e.brand, size: e.size, imageUrl: e.imageUrl, sources: e.sources ?? [], confidence: e.confidence });

async function openHistory(id) {
  const e = await db.get(id); if (!e) return;
  lookupToken++;
  state.result = { ...emptyResult(), query: e.query, category: e.category, thumb: e.thumb, historyId: e.id,
    candidates: e.candidates?.length ? e.candidates : [rowToCandidate(e)], selectedUpc: e.upc, fromCache: true, favorite: e.favorite, userSelected: true };
  go('result');
}

async function selectCandidate(upc) {
  const r = state.result, c = r.candidates.find((x) => x.upc === upc); if (!c) return;
  buzz(); r.selectedUpc = upc; r.userSelected = true; render();
  r.historyId = await repo.save(r.query, r.category, c, r.candidates, r.thumb);
  refreshHistory();
}

async function rejectUpc(upc) {
  const before = structuredClone({ ...state.result, thumb: null }); before.thumb = state.result.thumb;
  const r = state.result, wasShown = selected(r)?.upc === upc;
  buzz(25);
  r.candidates = r.candidates.filter((c) => c.upc !== upc);
  if (wasShown) Object.assign(r, { selectedUpc: r.candidates[0]?.upc ?? null, userSelected: false, historyId: null, favorite: false, fromCache: false });
  if (!r.candidates.length) r.error = 'notfound';
  render();
  const deleted = await repo.reject(before.query, upc);
  refreshHistory();
  snackbar(`Removed ${upc}. It won't be used for this item again.`, 'Undo', async () => {
    await repo.unreject(before.query, upc);
    if (deleted) await repo.restore(deleted);
    if (state.result.query === before.query) { state.result = before; if (state.route === 'result') render(); }
    refreshHistory();
  });
}

// ---------------------------------------------------------------------------------------------------------- sheet
function openDraft(name) { state.draft = { name, upc: '', scanned: false }; renderSheet(); }

function renderSheet() {
  const d = state.draft, dlg = $('#sheet');
  if (!d) { if (dlg.open) dlg.close(); return; }
  dlg.innerHTML = `<div class="inner">
    <button class="grab" data-act="sheet-close" aria-label="Close"></button>
    <h2 id="sheetTitle" style="font-size:20px;margin:0">Save your own barcode</h2>
    <p class="muted" style="margin:0">Scan the barcode on the product, or type the numbers printed under it. It will be used for this item from now on, even offline.</p>
    <div class="field"><label for="d-name">Item name</label><textarea id="d-name" rows="2" data-draft="name">${esc(d.name)}</textarea></div>
    <div class="field" id="d-upc-field"><label for="d-upc">UPC / EAN number</label>
      <input id="d-upc" class="upc" inputmode="numeric" autocomplete="off" data-draft="upc" value="${esc(d.upc)}" enterkeyhint="done">
      <button class="icon-btn clear" data-act="draft-clear" aria-label="Clear number">${icon('close')}</button></div>
    <p class="note" id="d-valid" style="margin:0" aria-live="polite"></p>
    <div class="pad small" id="d-preview" hidden><canvas id="d-canvas" aria-hidden="true"></canvas><span class="digits" id="d-digits"></span></div>
    <div class="row"><button class="btn btn-secondary grow" data-act="scan-open">${icon('scan')}Scan product</button>
      <button class="btn btn-primary grow" data-act="draft-save" id="d-save">${icon('save')}Save</button></div></div>`;
  if (!dlg.open) dlg.showModal();
  updateDraftValidation();
}

function updateDraftValidation() {
  const d = state.draft; if (!d) return;
  const digits = d.upc.replace(/\D/g, ''), n = normalizeInput(digits);
  const v = $('#d-valid'), field = $('#d-upc-field'), prev = $('#d-preview');
  let cls, ic, text;
  if (n && d.scanned) [cls, ic, text] = ['ok', 'ok', 'Scanned from the product — check digit OK'];
  else if (n) [cls, ic, text] = ['ok', 'ok', `Valid ${n.length === 12 ? 'UPC-A' : 'EAN'} — check digit OK`];
  else if (digits.length >= 8) [cls, ic, text] = ['err', 'info', "Check digit doesn't match. Re-check the numbers (usually 12 digits)."];
  else [cls, ic, text] = ['', 'info', `Usually 12 digits on US products. ${digits.length} entered.`];
  v.className = `note ${cls}`; v.innerHTML = `${icon(ic)}<span>${text}</span>`;
  field.classList.toggle('error', cls === 'err');
  prev.hidden = !n;
  if (n) { drawBarcode($('#d-canvas'), n); $('#d-digits').textContent = formatUpc(n); }
  $('#d-save').disabled = !(n && d.name.trim());
}

async function saveDraft() {
  const d = state.draft; if (!d) return;
  const upc = normalizeInput(d.upc);
  const query = d.name.trim().replace(/\s+/g, ' ');
  if (!upc) return snackbar("That number's check digit is wrong");
  if (!query) return;
  const r = state.result, same = queryKey(query) === queryKey(r.query);
  const id = await repo.saveManual(query, same ? r.category : '', upc, d.scanned ? 'SCANNED' : 'MANUAL', same ? r.candidates : [], same ? r.thumb : null);
  const e = await db.get(id);
  lookupToken++;
  state.result = { ...emptyResult(), query: e.query, category: e.category, thumb: e.thumb, historyId: e.id, candidates: e.candidates,
    selectedUpc: e.upc, fromCache: true, favorite: e.favorite, userSelected: true };
  state.draft = null; renderSheet(); buzz(20);
  if (state.route !== 'result') go('result'); else render();
  refreshHistory();
  snackbar(`Saved ${e.upc} for this item`);
}

// ---------------------------------------------------------------------------------------------------------- scanner
let scanSession = null;
async function openScanner() {
  const ov = $('#scanner'); ov.hidden = false;
  $('#scanHint').textContent = 'Point at the barcode on the product';
  if ($('#sheet').open) $('#sheet').close();
  try {
    scanSession = await scanner.start($('#scanVideo'), (code) => {
      buzz(30);
      closeScanner();
      state.draft = { ...(state.draft ?? { name: state.result.query }), upc: code, scanned: true };
      renderSheet();
    });
    const t = $('[data-act="scan-torch"]'); t.hidden = !scanSession.torchSupported;
  } catch (e) {
    console.warn('camera', e);
    $('#scanHint').textContent = e.name === 'NotAllowedError' ? 'Camera access is off. Allow it in site settings, or type the number.' : "Couldn't start the camera. Type the number instead.";
  }
}
function closeScanner() {
  scanSession?.stop(); scanSession = null; torchOn = false;
  $('#scanner').hidden = true;
}
let torchOn = false;

// ---------------------------------------------------------------------------------------------------------- full screen & wake lock
function openFull() {
  const c = confident(); if (!c) return;
  const f = $('#full'); f.hidden = false;
  $('#fullDigits').textContent = formatUpc(c.upc); $('#fullTitle').textContent = c.title;
  drawBarcode($('#fullCanvas'), c.upc);
  f.requestFullscreen?.().catch(() => {});
  updateWakeLock();
}
function closeFull() {
  $('#full').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  updateWakeLock();
}

let wakeLock = null;
async function updateWakeLock() {
  const want = (state.route === 'result' && confident() && state.keepAwake) || !$('#full').hidden;
  try {
    if (want && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', updateWakeLock);

// ---------------------------------------------------------------------------------------------------------- snackbar
let snackTimer;
function snackbar(msg, action, onAction) {
  const s = $('#snackbar'), b = $('button', s);
  $('.msg', s).textContent = msg;
  b.hidden = !action; b.textContent = action ?? '';
  b.onclick = () => { s.hidden = true; onAction?.(); };
  s.hidden = false;
  clearTimeout(snackTimer); snackTimer = setTimeout(() => { s.hidden = true; }, action ? 6000 : 3000);
}

// ---------------------------------------------------------------------------------------------------------- events
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, r = state.result;
  switch (act) {
    case 'camera': $('#pickCamera').click(); break;
    case 'gallery': $('#pickGallery').click(); break;
    case 'go-history': go('history'); break;
    case 'go-home': go('home'); break;
    case 'back': history.length > 1 ? history.back() : go('home', { replace: true }); break;
    case 'find': lookupFromCapture(); break;
    case 'open': openHistory(Number(el.dataset.id)); break;
    case 'select': selectCandidate(el.dataset.upc); break;
    case 'reject': rejectUpc(el.dataset.upc); break;
    case 'retry': lookupText(r.query, true); break;
    case 'edit': state.editing = !state.editing; render(); if (state.editing) $('#rq')?.focus(); break;
    case 'fav': {
      r.favorite = !r.favorite; buzz(); render();
      const e = await db.get(r.historyId); if (e) { e.favorite = r.favorite; await db.put(e); refreshHistory(); }
      break;
    }
    case 'fav-row': { const e = await db.get(Number(el.dataset.id)); e.favorite = !e.favorite; await db.put(e); buzz(); refreshHistory(); break; }
    case 'delete-row': {
      const e = await db.get(Number(el.dataset.id)); await db.remove(e.id); buzz(25); refreshHistory();
      snackbar(`Deleted ${e.title || e.query}`, 'Undo', async () => { await db.put(e); refreshHistory(); });
      break;
    }
    case 'filter': state.histFilter = Number(el.dataset.i); render(); break;
    case 'copy': {
      const c = confident(); if (!c) break;
      try { await navigator.clipboard.writeText(c.upc); buzz(20); snackbar(`Copied ${c.upc}`); } catch { snackbar("Couldn't copy — long-press the digits instead"); }
      break;
    }
    case 'full': openFull(); break;
    case 'full-close': closeFull(); break;
    case 'awake': state.keepAwake = !state.keepAwake; setPref('keepAwake', state.keepAwake); buzz(); render(); break;
    case 'draft-new': openDraft(''); break;
    case 'draft-current': openDraft(r.query); break;
    case 'draft-clear': state.draft.upc = ''; state.draft.scanned = false; $('#d-upc').value = ''; updateDraftValidation(); $('#d-upc').focus(); break;
    case 'draft-save': saveDraft(); break;
    case 'sheet-close': state.draft = null; renderSheet(); break;
    case 'scan-open': openScanner(); break;
    case 'scan-close': closeScanner(); if (state.draft) renderSheet(); break;
    case 'scan-type': closeScanner(); if (!state.draft) state.draft = { name: r.query, upc: '', scanned: false }; renderSheet(); setTimeout(() => $('#d-upc')?.focus(), 50); break;
    case 'scan-torch': torchOn = !torchOn; await scanSession?.torch(torchOn); el.classList.toggle('on', torchOn); el.setAttribute('aria-label', torchOn ? 'Turn torch off' : 'Turn torch on'); break;
    default: break;
  }
});

document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.bind && state.route === 'crop') {
    state.capture[t.dataset.bind] = t.value;
    const find = $('[data-act="find"]'); if (find) find.disabled = !state.capture.name.trim();
  } else if (t.dataset.bind === 'histSearch') {
    state.histSearch = t.value;
    const pos = t.selectionStart; render(); const i = $('[data-bind="histSearch"]'); i.focus(); i.setSelectionRange(pos, pos);
  } else if (t.dataset.draft) {
    state.draft[t.dataset.draft] = t.value;
    if (t.dataset.draft === 'upc') state.draft.scanned = false;
    updateDraftValidation();
  }
});

document.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = ev.target, q = new FormData(f).get('q') ?? '';
  if (f.dataset.form === 'search') { document.activeElement?.blur(); lookupText(String(q)); }
  if (f.dataset.form === 'requery') { state.editing = false; lookupText(String(q), true); }
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.id === 'rq' && !ev.shiftKey) { ev.preventDefault(); ev.target.form.requestSubmit(); }
  if (ev.key === 'Enter' && ev.target.id === 'd-upc' && !$('#d-save').disabled) saveDraft();
  if (ev.key === 'Escape' && !$('#full').hidden) closeFull();
  if (ev.key === 'Escape' && !$('#scanner').hidden) { closeScanner(); if (state.draft) renderSheet(); }
});
$('#sheet').addEventListener('close', () => { if ($('#scanner').hidden) state.draft = null; });
$('#sheet').addEventListener('click', (ev) => { if (ev.target === $('#sheet')) { state.draft = null; renderSheet(); } });
for (const id of ['pickCamera', 'pickGallery']) {
  $(`#${id}`).addEventListener('change', (ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; onImageFile(f); });
}
$('[data-act="scan-close"]').innerHTML = icon('close');
$('[data-act="scan-type"]').innerHTML = `${icon('keyboard')}Type number`;
$('[data-act="scan-torch"]').innerHTML = icon('torch');
$('[data-act="full-close"]').innerHTML = icon('close');

// ---------------------------------------------------------------------------------------------------------- boot
async function boot() {
  db.persist();
  state.history = await db.all();
  // Image shared from another app (installed PWA share target).
  if (new URLSearchParams(location.search).has('shared')) {
    history.replaceState(null, '', location.pathname + '#/home');
    try {
      const cache = await caches.open('shared');
      const res = await cache.match('shared-image');
      if (res) { await cache.delete('shared-image'); render(); return onImageFile(await res.blob()); }
    } catch { /* no share */ }
  }
  history.replaceState(null, '', '#/home');
  state.route = 'home';
  render();
}
boot();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // When a new version takes over (after a deploy), reload once so the fixed code runs right away.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
}
