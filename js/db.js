// IndexedDB: the on-device barcode database (history, favorites, your own codes, rejected codes).
// lookups: {id, queryKey (unique), query, category, upc, title, brand, size, imageUrl, sources[], confidence,
//           thumb (Blob|null), candidates[], favorite, createdAt, updatedAt}
// rejected: {queryKey, upc (canonical 13-digit key), createdAt}

const DB_NAME = 'upc-finder';
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const lookups = db.createObjectStore('lookups', { keyPath: 'id', autoIncrement: true });
      lookups.createIndex('queryKey', 'queryKey', { unique: true });
      lookups.createIndex('updatedAt', 'updatedAt');
      db.createObjectStore('rejected', { keyPath: ['queryKey', 'upc'] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = fn(tx.objectStore(store));
    // An IDBRequest's result is undefined when nothing matched — return that, never the request itself.
    tx.oncomplete = () => resolve(request instanceof IDBRequest ? request.result : request);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const all = () => run('lookups', 'readonly', (s) => s.getAll())
  .then((rows) => rows.sort((a, b) => b.updatedAt - a.updatedAt));
export const get = (id) => run('lookups', 'readonly', (s) => s.get(id));
export const findByKey = (queryKey) => run('lookups', 'readonly', (s) => s.index('queryKey').get(queryKey));
export const put = (row) => run('lookups', 'readwrite', (s) => s.put(row));
export const remove = (id) => run('lookups', 'readwrite', (s) => s.delete(id));

export const rejectedFor = (queryKey) =>
  run('rejected', 'readonly', (s) => s.getAll(IDBKeyRange.bound([queryKey, ''], [queryKey, '￿'])))
    .then((rows) => new Set(rows.map((r) => r.upc)));
export const addRejected = (queryKey, upc) => run('rejected', 'readwrite', (s) => s.put({ queryKey, upc, createdAt: Date.now() }));
export const deleteRejected = (queryKey, upc) => run('rejected', 'readwrite', (s) => s.delete([queryKey, upc]));

/** Ask the browser not to evict the database under storage pressure. */
export async function persist() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* optional */ }
}
