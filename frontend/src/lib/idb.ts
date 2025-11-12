// Minimal IndexedDB helpers (no external deps)
// DB: funly, Stores: previews, sw-config

const DB_NAME = "funly";
const DB_VERSION = 3;
const STORE_PREVIEWS = "previews"; // key: id (groupId or dmId), value: Preview
const STORE_SW_CONFIG = "sw-config"; // key: string, value: any
const STORE_MESSAGES = "messages"; // key: threadId, value: Message[] window
const STORE_COMPOSER_RECORDINGS = "composer-recordings"; // key: scope, value: { blob, durationMs, mimeType, updatedAt }

export type IDBStoreName =
  | typeof STORE_PREVIEWS
  | typeof STORE_SW_CONFIG
  | typeof STORE_MESSAGES
  | typeof STORE_COMPOSER_RECORDINGS;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PREVIEWS)) {
        db.createObjectStore(STORE_PREVIEWS);
      }
      if (!db.objectStoreNames.contains(STORE_SW_CONFIG)) {
        db.createObjectStore(STORE_SW_CONFIG);
      }
      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        db.createObjectStore(STORE_MESSAGES);
      }
      if (!db.objectStoreNames.contains(STORE_COMPOSER_RECORDINGS)) {
        db.createObjectStore(STORE_COMPOSER_RECORDINGS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSet<T = any>(
  store: IDBStoreName,
  key: IDBValidKey,
  value: T
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const st = tx.objectStore(store);
    st.put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbGet<T = any>(
  store: IDBStoreName,
  key: IDBValidKey
): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const st = tx.objectStore(store);
    const req = st.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGetAll<T = any>(
  store: IDBStoreName
): Promise<Array<{ key: IDBValidKey; value: T }>> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const st = tx.objectStore(store);
    const items: Array<{ key: IDBValidKey; value: T }> = [];
    // Use openCursor for broad compatibility
    const req = st.openCursor();
    req.onsuccess = () => {
      const cursor = req.result as IDBCursorWithValue | null;
      if (!cursor) {
        resolve(items);
        return;
      }
      items.push({ key: cursor.key, value: cursor.value as T });
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function idbRemove(
  store: IDBStoreName,
  key: IDBValidKey
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const st = tx.objectStore(store);
    st.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const STORES = {
  PREVIEWS: STORE_PREVIEWS as IDBStoreName,
  SW_CONFIG: STORE_SW_CONFIG as IDBStoreName,
  MESSAGES: STORE_MESSAGES as IDBStoreName,
  COMPOSER_RECORDINGS: STORE_COMPOSER_RECORDINGS as IDBStoreName,
};
