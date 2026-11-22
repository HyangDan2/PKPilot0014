/**
 * IndexedDB persistence for the study room. One `workspace` record holds the
 * decks and settings; each slide's ink strokes live under their own key so a
 * long stroke list never rewrites the whole deck.
 *
 * Where IndexedDB is unavailable (tests, private modes), the same calls fall
 * back to an in-memory store instead of throwing — and the caller can see that
 * through {@link storageStatus} so the screen can say the work is not durable.
 *
 * Two rules keep the record honest:
 *
 *  - A write is only reported as done once its transaction completes: an
 *    `request.onsuccess` can still be followed by an abort, and treating it as
 *    saved lost the last note when the quota was hit.
 *  - A read that failed is never reported as an empty store. An empty store
 *    means "first visit" and seeds the sample deck; confusing the two let a
 *    transient read error overwrite the decks a person already had.
 */

// Legacy database name from before the rename — kept so existing decks and ink
// strokes open in the renamed build instead of starting from an empty shelf.
const DB_NAME = 'saga-glitra';
const DB_VERSION = 1;
const WORKSPACE = 'workspace';
const STROKES = 'strokes';
const WORKSPACE_KEY = 'current';
const STROKE_PREFIX = `${STROKES}:`;

export type StorageErrorKind = 'quota' | 'unavailable' | 'write' | 'read';

/** Which part of the store a failure belongs to, so an unrelated success
 *  cannot silently clear it. */
export type StorageArea = 'workspace' | 'strokes' | 'open';

export interface StorageStatus {
  /** Where the workspace actually is right now. */
  kind: 'indexeddb' | 'memory';
  /** The last write/opening problem, cleared by a later success in the same area. */
  error: StorageErrorKind | null;
  /** The store the error came from, when it is known. */
  area?: StorageArea;
  detail?: string;
  at?: number;
}

/** The outcome of a workspace read: empty and unreadable are different facts. */
export type WorkspaceRead<T> =
  | { ok: true; value: T | undefined }
  | { ok: false; error: StorageErrorKind };

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
    next.area === status.area &&
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

function reportStorageError(kind: StorageErrorKind, area?: StorageArea, detail?: string): void {
  setStatus({ error: kind, area, detail, at: Date.now() });
}

/**
 * Clears the last error only for the area that just succeeded. A workspace
 * write succeeding after an ink write hit the quota must not make the screen
 * say everything is saved.
 */
function clearStorageError(area?: StorageArea): void {
  if (!status.error) return;
  if (area && status.area && status.area !== area) return;
  setStatus({ error: null, area: undefined, detail: undefined });
}

/** Test hook: forces an error state (or clears it) without a real failure. */
export function __setStorageErrorForTest(kind: StorageErrorKind | null, detail = 'test'): void {
  if (kind) reportStorageError(kind, undefined, detail);
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

function areaOf(store: string): StorageArea {
  return store === STROKES ? 'strokes' : 'workspace';
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
      reportStorageError('unavailable', 'open', String(error));
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
      reportStorageError('unavailable', 'open', request.error?.message);
      setStatus({ kind: 'memory' });
      resolve(null);
    };
    request.onblocked = () => {
      reportStorageError('unavailable', 'open', '다른 탭이 저장소를 붙잡고 있습니다');
      resolve(null);
    };
  });
  return dbPromise;
}

/**
 * Runs one transaction to completion. `run` issues the requests; the promise
 * resolves true only on `oncomplete`, and false when the transaction aborts —
 * which also rolls back everything `run` already wrote. `readFailure` names the
 * error kind to report when a readonly transaction fails (a read that broke is
 * not a write that broke).
 */
function runTransaction(
  storeNames: string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => void,
  options: { readFailure?: boolean } = {},
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    void (async () => {
      const db = await openDb();
      if (!db) {
        // No IndexedDB (or it refused to open): the room runs on the memory
        // map, where every write does land — the caller only has to know that
        // the work is not durable, which `storageStatus` already says.
        resolve(true);
        return;
      }
      const area = areaOf(storeNames[0]);
      let tx: IDBTransaction;
      try {
        tx = db.transaction(storeNames, mode);
      } catch (error) {
        reportStorageError(classifyStorageError(error), area, error instanceof Error ? error.message : String(error));
        resolve(false);
        return;
      }
      let settled = false;
      let reported = false;
      const fail = (error: unknown) => {
        // Keep the first, most specific reason: a throw inside put() must not
        // be relabelled as a plain write failure by the abort that follows.
        if (reported) return;
        reported = true;
        const kind = classifyStorageError(error);
        reportStorageError(
          options.readFailure && kind === 'write' ? 'read' : kind,
          area,
          error instanceof Error ? error.message : String(error ?? ''),
        );
      };
      const done = (result: boolean) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      tx.oncomplete = () => {
        if (mode !== 'readonly') clearStorageError(area);
        done(true);
      };
      tx.onerror = () => { fail(tx.error); done(false); };
      tx.onabort = () => { fail(tx.error); done(false); };
      try {
        run(tx);
      } catch (error) {
        fail(error);
        try { tx.abort(); } catch { /* already gone */ }
        done(false);
      }
    })();
  });
}

/** Runs one readonly request; resolves with the value or undefined. */
function readOne<T>(store: string, key: string): Promise<{ ok: boolean; value?: T }> {
  return new Promise((resolve) => {
    void (async () => {
      const db = await openDb();
      if (!db) {
        resolve({ ok: true, value: memory.get(store === STROKES ? `${STROKE_PREFIX}${key}` : WORKSPACE_KEY) as T | undefined });
        return;
      }
      const area = areaOf(store);
      let tx: IDBTransaction;
      try {
        tx = db.transaction(store, 'readonly');
      } catch (error) {
        reportStorageError(optionsForRead(error), area, String(error));
        resolve({ ok: false });
        return;
      }
      let value: T | undefined;
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve({ ok, value });
      };
      tx.oncomplete = () => done(true);
      tx.onerror = () => {
        const kind = classifyStorageError(tx.error);
        reportStorageError(kind === 'write' ? 'read' : kind, area, tx.error?.message);
        done(false);
      };
      tx.onabort = () => {
        const kind = classifyStorageError(tx.error);
        reportStorageError(kind === 'write' ? 'read' : kind, area, tx.error?.message);
        done(false);
      };
      try {
        const request = tx.objectStore(store).get(key);
        request.onsuccess = () => { value = request.result as T; };
        // The transaction's own handlers report the failure; this keeps the
        // request error from surfacing as an unhandled rejection.
        request.onerror = () => {};
      } catch (error) {
        const kind = classifyStorageError(error);
        reportStorageError(kind === 'write' ? 'read' : kind, area, error instanceof Error ? error.message : String(error));
        try { tx.abort(); } catch { /* already gone */ }
        done(false);
      }
    })();
  });
}

function optionsForRead(error: unknown): StorageErrorKind {
  const kind = classifyStorageError(error);
  return kind === 'write' ? 'read' : kind;
}

/**
 * Reads the workspace record, keeping "the store is empty" apart from "the
 * store could not be read". The caller seeds a sample deck only for the first.
 */
export async function readWorkspace<T>(): Promise<WorkspaceRead<T>> {
  const result = await readOne<T>(WORKSPACE, WORKSPACE_KEY);
  if (!result.ok) return { ok: false, error: storageStatus().error ?? 'read' };
  return { ok: true, value: result.value };
}

export async function getWorkspace<T>(): Promise<T | undefined> {
  const read = await readWorkspace<T>();
  return read.ok ? read.value : undefined;
}

/**
 * Writes the workspace record. Resolves true only when IndexedDB committed it
 * (or when the room is running in memory and the value is held here), so a
 * caller that must not delete ink on a failed save can tell the difference.
 */
export function setWorkspace<T>(value: T): Promise<boolean> {
  return track((async () => {
    const ok = await runTransaction([WORKSPACE], 'readwrite', (tx) => {
      tx.objectStore(WORKSPACE).put(value, WORKSPACE_KEY);
    });
    if (!ok) return false;
    memory.set(WORKSPACE_KEY, value);
    return true;
  })());
}

export interface WorkspaceCommit<W> {
  workspace: W;
  /** Ink records that belong to the decks this write removes. */
  deleteStrokeIds: string[];
}

/**
 * Removes decks (or slides) and their ink together: the workspace record and
 * the stroke deletions ride in one transaction, so a reload either sees the
 * deck gone with its ink, or both still there. Never one without the other.
 */
export function commitWorkspace<W>(commit: WorkspaceCommit<W>): Promise<boolean> {
  return track((async () => {
    const ok = await runTransaction([WORKSPACE, STROKES], 'readwrite', (tx) => {
      tx.objectStore(WORKSPACE).put(commit.workspace, WORKSPACE_KEY);
      const ink = tx.objectStore(STROKES);
      for (const id of commit.deleteStrokeIds) ink.delete(id);
    });
    if (!ok) return false;
    memory.set(WORKSPACE_KEY, commit.workspace);
    for (const id of commit.deleteStrokeIds) memory.delete(`${STROKE_PREFIX}${id}`);
    return true;
  })());
}

export async function getStrokes<T>(slideId: string): Promise<T | undefined> {
  const result = await readOne<T>(STROKES, slideId);
  return result.ok ? result.value : undefined;
}

export function setStrokes<T>(slideId: string, value: T): Promise<boolean> {
  return track((async () => {
    const ok = await runTransaction([STROKES], 'readwrite', (tx) => {
      tx.objectStore(STROKES).put(value, slideId);
    });
    if (!ok) return false;
    memory.set(`${STROKE_PREFIX}${slideId}`, value);
    return true;
  })());
}

export function deleteStrokes(slideId: string): Promise<boolean> {
  return track((async () => {
    const ok = await runTransaction([STROKES], 'readwrite', (tx) => {
      tx.objectStore(STROKES).delete(slideId);
    });
    if (!ok) return false;
    memory.delete(`${STROKE_PREFIX}${slideId}`);
    return true;
  })());
}

export async function deleteStrokesMany(slideIds: string[]): Promise<boolean> {
  const results = await Promise.all(slideIds.map((id) => deleteStrokes(id)));
  return results.every(Boolean);
}

export interface WorkspaceReplace<W> {
  workspace: W;
  /** Ink the restored workspace carries, keyed by slide id. */
  strokes: Record<string, unknown>;
}

/**
 * Restores a whole workspace in one transaction: the workspace record, the
 * ink it carries, and the clearing of every stroke record it does not. A
 * refresh after this therefore sees exactly one state — never a mix of the old
 * ink and the new decks, and never a stroke left behind for a slide the backup
 * carries without ink. Returns false when storage refused the write.
 */
export function replaceWorkspace<W>(snapshot: WorkspaceReplace<W>): Promise<boolean> {
  return track((async () => {
    const ok = await runTransaction([WORKSPACE, STROKES], 'readwrite', (tx) => {
      tx.objectStore(WORKSPACE).put(snapshot.workspace, WORKSPACE_KEY);
      const ink = tx.objectStore(STROKES);
      // The restored copy is the whole truth: anything else in the store is
      // ink whose slide no longer exists (or whose slide the backup carries
      // with no ink), so the store is emptied before the copy is written.
      ink.clear();
      for (const [id, value] of Object.entries(snapshot.strokes)) ink.put(value, id);
    });
    if (!ok) return false;
    memory.set(WORKSPACE_KEY, snapshot.workspace);
    for (const key of [...memory.keys()]) {
      if (key.startsWith(STROKE_PREFIX)) memory.delete(key);
    }
    for (const [id, value] of Object.entries(snapshot.strokes)) {
      memory.set(`${STROKE_PREFIX}${id}`, value);
    }
    return true;
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
