/**
 * IndexedDB persistence for the study room. One `workspace` record holds the
 * decks and settings; each slide's ink strokes live under their own key so a
 * long stroke list never rewrites the whole deck.
 *
 * Where IndexedDB is unavailable (tests, private modes), the same calls fall
 * back to an in-memory store instead of throwing — and the caller can see that
 * through {@link storageStatus} so the screen can say the work is not durable.
 *
 * A write is only reported as done once its transaction completes: an
 * `request.onsuccess` can still be followed by an abort, and treating it as
 * saved lost the last note when the quota was hit.
 */

// Legacy database name from before the rename — kept so existing decks and ink
// strokes open in the renamed build instead of starting from an empty shelf.
const DB_NAME = 'saga-glitra';
const DB_VERSION = 1;
const WORKSPACE = 'workspace';
const STROKES = 'strokes';
const WORKSPACE_KEY = 'current';

export type StorageErrorKind = 'quota' | 'unavailable' | 'write';

export interface StorageStatus {
  /** Where the workspace actually is right now. */
  kind: 'indexeddb' | 'memory';
  /** The last write/opening problem, cleared on the next successful write. */
  error: StorageErrorKind | null;
  detail?: string;
  at?: number;
}

const memory = new Map<string, unknown>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

let status: StorageStatus = {
  kind: hasIndexedDb() ? 'indexeddb' : 'memory',
  error: null,
};

const listeners = new Set<(next: StorageStatus) => void>();

export function storageKind(): 'indexeddb' | 'memory' {
  return status.kind;
}

export function storageStatus(): StorageStatus {
  return status;
}

/** Screens subscribe here; the call returns its own unsubscribe. */
export function subscribeStorage(listener: (next: StorageStatus) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function setStatus(patch: Partial<StorageStatus>): void {
  const next = { ...status, ...patch };
  if (
    next.kind === status.kind &&
    next.error === status.error &&
    next.detail === status.detail &&
    next.at === status.at
  ) {
    return;
  }
  status = next;
  for (const listener of listeners) listener(status);
}

/** Maps an IndexedDB failure onto what the person can do about it. */
export function classifyStorageError(error: unknown): StorageErrorKind {
  const named = error as { name?: string; code?: number; message?: string } | null;
  const name = named?.name ?? '';
  const message = named?.message ?? '';
  if (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    named?.code === 22 ||
    /quota/i.test(name) ||
    /quota/i.test(message)
  ) {
    return 'quota';
  }
  if (name === 'InvalidStateError' || name === 'NotFoundError' || name === 'UnknownError') return 'unavailable';
  return 'write';
}

function reportStorageError(kind: StorageErrorKind, detail?: string): void {
  setStatus({ error: kind, detail, at: Date.now() });
}

function clearStorageError(): void {
  if (status.error) setStatus({ error: null, detail: undefined });
}

/** Test hook: forces an error state (or clears it) without a real failure. */
export function __setStorageErrorForTest(kind: StorageErrorKind | null, detail = 'test'): void {
  if (kind) reportStorageError(kind, detail);
  else clearStorageError();
}

/** Pending writes, so a page being closed can wait for them. */
const pendingWrites = new Set<Promise<unknown>>();

function track<T>(promise: Promise<T>): Promise<T> {
  const tracked = promise.finally(() => { pendingWrites.delete(tracked); });
  pendingWrites.add(tracked);
  return tracked;
}

/** Resolves when every write started so far has finished (or failed). */
export async function flushStorage(): Promise<void> {
  let guard = 0;
  while (pendingWrites.size > 0 && guard < 40) {
    guard += 1;
    await Promise.allSettled([...pendingWrites]);
  }
}

export function pendingWritesCount(): number {
  return pendingWrites.size;
}

function openDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) {
    setStatus({ kind: 'memory', error: status.error });
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reportStorageError('unavailable', String(error));
      setStatus({ kind: 'memory' });
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WORKSPACE)) db.createObjectStore(WORKSPACE);
      if (!db.objectStoreNames.contains(STROKES)) db.createObjectStore(STROKES);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgrading the schema or the browser closing the handle
      // must not leave a dead handle cached forever.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => {
      reportStorageError('unavailable', request.error?.message);
      setStatus({ kind: 'memory' });
      resolve(null);
    };
    request.onblocked = () => {
      reportStorageError('unavailable', '다른 탭이 저장소를 붙잡고 있습니다');
      resolve(null);
    };
  });
  return dbPromise;
}

/**
 * Runs one request and waits for its transaction to complete. Resolves with the
 * request's value on `oncomplete`, undefined when the transaction aborts.
 */
async function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise<T | undefined>((resolve) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(store, mode);
    } catch (error) {
      reportStorageError(classifyStorageError(error), error instanceof Error ? error.message : String(error));
      resolve(undefined);
      return;
    }
    let value: T | undefined;
    let settled = false;
    let reported = false;
    const fail = (error: unknown) => {
      // Keep the first, most specific reason: a throw inside put() must not be
      // relabelled as a plain write failure by the abort that follows.
      if (reported) return;
      reported = true;
      reportStorageError(classifyStorageError(error), error instanceof Error ? error.message : String(error ?? ''));
    };
    const finish = (result: T | undefined) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    tx.oncomplete = () => {
      if (mode !== 'readonly') clearStorageError();
      finish(value);
    };
    tx.onerror = () => { fail(tx.error); finish(undefined); };
    tx.onabort = () => { fail(tx.error); finish(undefined); };
    try {
      const request = run(tx.objectStore(store));
      request.onsuccess = () => { value = request.result as T; };
      // The transaction's own handlers report the failure; this keeps the
      // request error from surfacing as an unhandled rejection.
      request.onerror = () => {};
    } catch (error) {
      fail(error);
      try { tx.abort(); } catch { /* already gone */ }
      finish(undefined);
    }
  });
}

export async function getWorkspace<T>(): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return memory.get(WORKSPACE_KEY) as T | undefined;
  return withStore<T>(WORKSPACE, 'readonly', (store) => store.get(WORKSPACE_KEY));
}

export function setWorkspace<T>(value: T): Promise<void> {
  memory.set(WORKSPACE_KEY, value);
  return track((async () => {
    const db = await openDb();
    if (!db) return;
    await withStore(WORKSPACE, 'readwrite', (store) => store.put(value, WORKSPACE_KEY));
  })());
}

export async function getStrokes<T>(slideId: string): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return memory.get(`${STROKES}:${slideId}`) as T | undefined;
  return withStore<T>(STROKES, 'readonly', (store) => store.get(slideId));
}

export function setStrokes<T>(slideId: string, value: T): Promise<void> {
  memory.set(`${STROKES}:${slideId}`, value);
  return track((async () => {
    const db = await openDb();
    if (!db) return;
    await withStore(STROKES, 'readwrite', (store) => store.put(value, slideId));
  })());
}

export function deleteStrokes(slideId: string): Promise<void> {
  memory.delete(`${STROKES}:${slideId}`);
  return track((async () => {
    const db = await openDb();
    if (!db) return;
    await withStore(STROKES, 'readwrite', (store) => store.delete(slideId));
  })());
}

export function deleteStrokesMany(slideIds: string[]): Promise<void> {
  return Promise.all(slideIds.map((id) => deleteStrokes(id))).then(() => undefined);
}

export interface WorkspaceReplace<W> {
  workspace: W;
  /** Ink the restored workspace carries, keyed by slide id. */
  strokes: Record<string, unknown>;
  /** Ink records that must not survive the restore. */
  removeStrokeIds?: string[];
}

/**
 * Restores a whole workspace in one transaction: the workspace record, the ink
 * it carries, and the removal of ink it does not carry. A refresh after this
 * therefore sees exactly one state — never a mix of the old ink and the new
 * decks. Returns false when storage refused the write.
 */
export function replaceWorkspace<W>(snapshot: WorkspaceReplace<W>): Promise<boolean> {
  // The in-memory copy mirrors the restore at once: this session reads from it
  // even when IndexedDB is unavailable.
  memory.set(WORKSPACE_KEY, snapshot.workspace);
  for (const id of snapshot.removeStrokeIds ?? []) memory.delete(`${STROKES}:${id}`);
  for (const [id, value] of Object.entries(snapshot.strokes)) memory.set(`${STROKES}:${id}`, value);

  return track((async () => {
    const db = await openDb();
    if (!db) return true;
    return new Promise<boolean>((resolve) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction([WORKSPACE, STROKES], 'readwrite');
      } catch (error) {
        reportStorageError(classifyStorageError(error), error instanceof Error ? error.message : String(error));
        resolve(false);
        return;
      }
      let settled = false;
      let reported = false;
      const fail = (error: unknown) => {
        if (reported) return;
        reported = true;
        reportStorageError(classifyStorageError(error), error instanceof Error ? error.message : String(error ?? ''));
      };
      const done = (result: boolean) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      tx.oncomplete = () => { clearStorageError(); done(true); };
      tx.onerror = () => { fail(tx.error); done(false); };
      tx.onabort = () => { fail(tx.error); done(false); };
      try {
        tx.objectStore(WORKSPACE).put(snapshot.workspace, WORKSPACE_KEY);
        const inkStore = tx.objectStore(STROKES);
        for (const id of snapshot.removeStrokeIds ?? []) inkStore.delete(id);
        for (const [id, value] of Object.entries(snapshot.strokes)) inkStore.put(value, id);
      } catch (error) {
        fail(error);
        try { tx.abort(); } catch { /* already gone */ }
        done(false);
      }
    });
  })());
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
  pendingWrites.clear();
  clearStorageError();
}

/** Test hook: forgets the opened database so the next call re-opens it. */
export function __resetConnection(): void {
  dbPromise = null;
}
