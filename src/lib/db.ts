/**
 * IndexedDB persistence for the study room. One `workspace` record holds the
 * decks and settings; each slide's ink strokes live under their own key so a
 * long stroke list never rewrites the whole deck.
 *
 * Where IndexedDB is unavailable (tests, private modes), the same calls fall
 * back to an in-memory store instead of throwing.
 */

// Legacy database name from before the rename — kept so existing decks and ink
// strokes open in the renamed build instead of starting from an empty shelf.
const DB_NAME = 'saga-glitra';
const DB_VERSION = 1;
const WORKSPACE = 'workspace';
const STROKES = 'strokes';
const WORKSPACE_KEY = 'current';

const memory = new Map<string, unknown>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

export function storageKind(): 'indexeddb' | 'memory' {
  return hasIndexedDb() ? 'indexeddb' : 'memory';
}

function openDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WORKSPACE)) db.createObjectStore(WORKSPACE);
      if (!db.objectStoreNames.contains(STROKES)) db.createObjectStore(STROKES);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

async function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise<T | undefined>((resolve) => {
    let request: IDBRequest;
    try {
      request = run(db.transaction(store, mode).objectStore(store));
    } catch {
      resolve(undefined);
      return;
    }
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => resolve(undefined);
  });
}

export async function getWorkspace<T>(): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return memory.get(WORKSPACE_KEY) as T | undefined;
  return withStore<T>(WORKSPACE, 'readonly', (store) => store.get(WORKSPACE_KEY));
}

export async function setWorkspace<T>(value: T): Promise<void> {
  memory.set(WORKSPACE_KEY, value);
  const db = await openDb();
  if (!db) return;
  await withStore(WORKSPACE, 'readwrite', (store) => store.put(value, WORKSPACE_KEY));
}

export async function getStrokes<T>(slideId: string): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return memory.get(`${STROKES}:${slideId}`) as T | undefined;
  return withStore<T>(STROKES, 'readonly', (store) => store.get(slideId));
}

export async function setStrokes<T>(slideId: string, value: T): Promise<void> {
  memory.set(`${STROKES}:${slideId}`, value);
  const db = await openDb();
  if (!db) return;
  await withStore(STROKES, 'readwrite', (store) => store.put(value, slideId));
}

export async function deleteStrokes(slideId: string): Promise<void> {
  memory.delete(`${STROKES}:${slideId}`);
  const db = await openDb();
  if (!db) return;
  await withStore(STROKES, 'readwrite', (store) => store.delete(slideId));
}

export async function loadAllStrokes(slideIds: string[]): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const id of slideIds) {
    const value = await getStrokes(id);
    if (value) out[id] = value;
  }
  return out;
}

/** Test hook: clears the in-memory fallback between cases. */
export function __resetMemoryStore(): void {
  memory.clear();
}
