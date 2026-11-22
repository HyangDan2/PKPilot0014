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
// The revision rides beside the record instead of inside it, so the stored
// workspace keeps exactly the shape older builds (and .study.json) use.
const REVISION_KEY = 'workspace:revision';
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
  | { ok: true; value: T | undefined; revision: number }
  | { ok: false; error: StorageErrorKind };

/**
 * The outcome of a write that carries a revision. When another writer has
 * already moved the record on, the write is refused (`conflict`) instead of
 * quietly replacing that writer's work — the caller decides with the person.
 */
export interface RevisionResult {
  ok: boolean;
  /** The revision now in the store: the new one after a write, the other writer's on a conflict. */
  revision: number;
  conflict?: boolean;
  error?: StorageErrorKind;
}

/** One slide's ink record, with the revision that guards it. */
export interface StrokeRecord<T> {
  revision: number;
  strokes: T[];
}

/**
 * Older builds stored the bare stroke array under the slide id; both shapes
 * read the same way, so a record written before revisions existed still opens.
 */
export function normalizeStrokeRecord<T>(value: unknown): StrokeRecord<T> {
  if (Array.isArray(value)) return { revision: 0, strokes: value as T[] };
  const named = value as { revision?: unknown; strokes?: unknown } | null;
  if (named && Array.isArray(named.strokes)) {
    const revision = typeof named.revision === 'number' && Number.isFinite(named.revision) ? named.revision : 0;
    return { revision, strokes: named.strokes as T[] };
  }
  return { revision: 0, strokes: [] };
}

/** The revision the memory fallback holds (0 before any write). */
function memoryRevision(): number {
  const value = memory.get(REVISION_KEY);
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function reportAndClassify(error: unknown, area: StorageArea): StorageErrorKind {
  const kind = classifyStorageError(error);
  reportStorageError(kind, area, error instanceof Error ? error.message : String(error));
  return kind;
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
  // The same problem reported twice (a retry hitting the same quota) is one
  // state: subscribers are told once, and `at` keeps the moment it began.
  if (
    next.kind === status.kind &&
    next.error === status.error &&
    next.area === status.area &&
    next.detail === status.detail
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
        resolve({ ok: true, value: memory.get(store === STROKES ? `${STROKE_PREFIX}${key}` : key) as T | undefined });
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
        // A read that worked proves the store is readable again: the "읽지
        // 못했습니다" notice goes away with it. A write failure is untouched.
        if (ok && status.error === 'read') clearStorageError(area);
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
  const revision = await readWorkspaceRevision();
  return { ok: true, value: result.value, revision };
}

/** The revision the stored workspace carries (0 when it was written before revisions). */
export async function readWorkspaceRevision(): Promise<number> {
  const read = await readOne<unknown>(WORKSPACE, REVISION_KEY);
  if (!read.ok) return 0;
  return typeof read.value === 'number' && Number.isFinite(read.value) ? read.value : 0;
}

export async function getWorkspace<T>(): Promise<T | undefined> {
  const read = await readWorkspace<T>();
  return read.ok ? read.value : undefined;
}

/** One write plan: the workspace record, ink the same transaction carries, or both. */
interface WorkspacePlan<W> {
  workspace?: W;
  /** Ink records the write replaces (a restore), keyed by slide id. */
  putStrokes?: Record<string, unknown>;
  deleteStrokeIds?: string[];
  /** The restore empties the ink store before writing the copy. */
  clearStrokes?: boolean;
  /**
   * The revision this tab last saw. When it is set and the stored record has
   * moved on, nothing is written and the caller gets `conflict`.
   */
  expectedRevision?: number;
}

function planStores(plan: WorkspacePlan<unknown>): string[] {
  const stores: string[] = [];
  if (plan.workspace !== undefined) stores.push(WORKSPACE);
  if (plan.clearStrokes || plan.deleteStrokeIds?.length || plan.putStrokes) stores.push(STROKES);
  return stores.length ? stores : [WORKSPACE];
}

/** The memory mirror follows a committed transaction, for the fallback path. */
function applyPlanToMemory(plan: WorkspacePlan<unknown>, workspaceRevision: number): void {
  if (plan.workspace !== undefined) {
    memory.set(WORKSPACE_KEY, plan.workspace);
    memory.set(REVISION_KEY, workspaceRevision);
  }
  if (plan.clearStrokes) {
    for (const key of [...memory.keys()]) if (key.startsWith(STROKE_PREFIX)) memory.delete(key);
  }
  for (const id of plan.deleteStrokeIds ?? []) memory.delete(`${STROKE_PREFIX}${id}`);
  for (const [id, value] of Object.entries(plan.putStrokes ?? {})) {
    const { revision } = normalizeStrokeRecord(memory.get(`${STROKE_PREFIX}${id}`));
    memory.set(`${STROKE_PREFIX}${id}`, { revision: revision + 1, strokes: value });
  }
}

/** Issues the ink half of a plan inside an open transaction. */
function writeStrokesInto(
  ink: IDBObjectStore,
  plan: WorkspacePlan<unknown>,
  fail: (error: unknown) => void,
  abort: () => void,
): void {
  try {
    if (plan.clearStrokes) ink.clear();
    for (const id of plan.deleteStrokeIds ?? []) ink.delete(id);
    for (const [id, value] of Object.entries(plan.putStrokes ?? {})) {
      const existing = ink.get(id);
      existing.onsuccess = () => {
        const { revision } = normalizeStrokeRecord(existing.result);
        try {
          ink.put({ revision: revision + 1, strokes: value }, id);
        } catch (error) {
          fail(error);
          abort();
        }
      };
      existing.onerror = () => { /* the transaction reports it */ };
    }
  } catch (error) {
    fail(error);
    abort();
  }
}

/**
 * Runs one plan to completion. The workspace revision is read and compared in
 * the same transaction that would write, so two tabs cannot both write from
 * the same base: the second one is refused and told whose revision won.
 */
function runPlan<W>(plan: WorkspacePlan<W>): Promise<RevisionResult> {
  return track((async () => {
    const db = await openDb();
    const expected = plan.expectedRevision;
    if (!db) {
      const storedRev = memoryRevision();
      if (plan.workspace !== undefined && expected !== undefined && expected >= 0 && storedRev !== expected) {
        return { ok: false, revision: storedRev, conflict: true };
      }
      const next = plan.workspace !== undefined ? storedRev + 1 : storedRev;
      applyPlanToMemory(plan as WorkspacePlan<unknown>, next);
      return { ok: true, revision: next };
    }
    const stores = planStores(plan as WorkspacePlan<unknown>);
    const area = areaOf(stores[0]);
    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, 'readwrite');
    } catch (error) {
      return { ok: false, revision: 0, error: reportAndClassify(error, area) };
    }
    return new Promise<RevisionResult>((resolve) => {
      let settled = false;
      let conflict = false;
      let storedRev = 0;
      let nextRev = 0;
      const done = (result: RevisionResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const fail = (error: unknown) => {
        // The first reason is the specific one; the abort that follows a
        // refused put must not relabel it as a plain write failure.
        if (settled) return;
        done({ ok: false, revision: storedRev, error: reportAndClassify(error, area) });
      };
      const abort = () => { try { tx.abort(); } catch { /* already gone */ } };
      tx.oncomplete = () => {
        if (conflict) {
          done({ ok: false, revision: storedRev, conflict: true });
          return;
        }
        clearStorageError(area);
        applyPlanToMemory(plan as WorkspacePlan<unknown>, nextRev);
        done({ ok: true, revision: nextRev });
      };
      tx.onerror = () => fail(tx.error);
      tx.onabort = () => fail(tx.error);
      try {
        if (plan.workspace !== undefined) {
          const store = tx.objectStore(WORKSPACE);
          const request = store.get(REVISION_KEY);
          request.onsuccess = () => {
            storedRev = typeof request.result === 'number' && Number.isFinite(request.result) ? request.result : 0;
            if (expected !== undefined && expected >= 0 && storedRev !== expected) {
              conflict = true;
              return;
            }
            nextRev = storedRev + 1;
            try {
              store.put(plan.workspace, WORKSPACE_KEY);
              store.put(nextRev, REVISION_KEY);
            } catch (error) {
              fail(error);
              abort();
              return;
            }
            if (stores.includes(STROKES)) {
              writeStrokesInto(tx.objectStore(STROKES), plan as WorkspacePlan<unknown>, fail, abort);
            }
          };
          request.onerror = () => { /* the transaction reports it */ };
        } else if (stores.includes(STROKES)) {
          writeStrokesInto(tx.objectStore(STROKES), plan as WorkspacePlan<unknown>, fail, abort);
        }
      } catch (error) {
        fail(error);
        abort();
      }
    });
  })());
}

/**
 * Writes the workspace record. Resolves true only when IndexedDB committed it
 * (or when the room is running in memory and the value is held here), so a
 * caller that must not delete ink on a failed save can tell the difference.
 */
export function setWorkspace<T>(value: T): Promise<boolean> {
  return runPlan<T>({ workspace: value }).then((result) => result.ok);
}

/**
 * Writes the workspace record only when this tab still holds the revision it
 * last read. A newer stored revision means another tab wrote first; this tab's
 * copy is not put over it — the caller shows the person both and lets them pick.
 */
export function setWorkspaceRevision<T>(value: T, expected: number): Promise<RevisionResult> {
  return runPlan<T>({ workspace: value, expectedRevision: expected });
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
  return runPlan<W>({ workspace: commit.workspace, deleteStrokeIds: commit.deleteStrokeIds })
    .then((result) => result.ok);
}

/** The revision-checked form: a deck deletion refuses to land over another tab's newer save. */
export function commitWorkspaceRevision<W>(
  commit: WorkspaceCommit<W>,
  expected: number,
): Promise<RevisionResult> {
  return runPlan<W>({
    workspace: commit.workspace,
    deleteStrokeIds: commit.deleteStrokeIds,
    expectedRevision: expected,
  });
}

export async function getStrokes<T>(slideId: string): Promise<T[] | undefined> {
  const result = await readOne<unknown>(STROKES, slideId);
  if (!result.ok || result.value === undefined) return undefined;
  return normalizeStrokeRecord<T>(result.value).strokes;
}

/**
 * Reads one slide's ink, keeping "no record for this slide" apart from "the
 * record could not be read". A read that failed must never look like empty ink:
 * the room would then offer to draw over ink it simply could not see.
 */
export async function readStrokes<T>(slideId: string): Promise<
  { ok: true; record: StrokeRecord<T>; present: boolean } | { ok: false; error: StorageErrorKind }
> {
  const read = await readOne<unknown>(STROKES, slideId);
  if (!read.ok) return { ok: false, error: storageStatus().error ?? 'read' };
  if (read.value === undefined) return { ok: true, record: { revision: 0, strokes: [] }, present: false };
  return { ok: true, record: normalizeStrokeRecord<T>(read.value), present: true };
}

export function setStrokes<T>(slideId: string, value: T[]): Promise<boolean> {
  return setStrokeRevision<T>(slideId, value, -1).then((result) => result.ok);
}

/**
 * Writes one slide's ink under a revision check. Two tabs that both edited the
 * same slide cannot merge stroke lists, so the later write is refused and the
 * room asks which copy to keep instead of concatenating or dropping one.
 */
export function setStrokeRevision<T>(slideId: string, value: T[], expected: number): Promise<RevisionResult> {
  return track((async () => {
    const db = await openDb();
    const memKey = `${STROKE_PREFIX}${slideId}`;
    if (!db) {
      const current = normalizeStrokeRecord<T>(memory.get(memKey));
      if (expected >= 0 && current.revision !== expected) {
        return { ok: false, revision: current.revision, conflict: true };
      }
      const next = current.revision + 1;
      memory.set(memKey, { revision: next, strokes: value });
      return { ok: true, revision: next };
    }
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STROKES, 'readwrite');
    } catch (error) {
      return { ok: false, revision: 0, error: reportAndClassify(error, 'strokes') };
    }
    return new Promise<RevisionResult>((resolve) => {
      let settled = false;
      let stored = 0;
      let next = 0;
      let conflict = false;
      const done = (result: RevisionResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        done({ ok: false, revision: stored, error: reportAndClassify(error, 'strokes') });
      };
      const abort = () => { try { tx.abort(); } catch { /* already gone */ } };
      tx.oncomplete = () => {
        if (conflict) {
          done({ ok: false, revision: stored, conflict: true });
          return;
        }
        clearStorageError('strokes');
        memory.set(memKey, { revision: next, strokes: value });
        done({ ok: true, revision: next });
      };
      tx.onerror = () => fail(tx.error);
      tx.onabort = () => fail(tx.error);
      try {
        const store = tx.objectStore(STROKES);
        const request = store.get(slideId);
        request.onsuccess = () => {
          stored = normalizeStrokeRecord(request.result).revision;
          if (expected >= 0 && stored !== expected) {
            conflict = true;
            return;
          }
          next = stored + 1;
          try {
            store.put({ revision: next, strokes: value }, slideId);
          } catch (error) {
            fail(error);
            abort();
          }
        };
        request.onerror = () => { /* the transaction reports it */ };
      } catch (error) {
        fail(error);
        abort();
      }
    });
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
  return runPlan<W>({
    workspace: snapshot.workspace,
    clearStrokes: true,
    putStrokes: snapshot.strokes,
  }).then((result) => result.ok);
}

/** The revision-checked form: a restore refuses to land over another tab's newer save. */
export function replaceWorkspaceRevision<W>(
  snapshot: WorkspaceReplace<W>,
  expected: number,
): Promise<RevisionResult> {
  return runPlan<W>({
    workspace: snapshot.workspace,
    clearStrokes: true,
    putStrokes: snapshot.strokes,
    expectedRevision: expected,
  });
}

export interface StrokesSnapshot<T> {
  strokes: Record<string, T[]>;
  revisions: Record<string, number>;
}

/**
 * The whole ink shelf for a deck list. `ok: false` means at least one record
 * could not be read — which is not the same as that slide having no ink, and
 * the room must not treat it as such (no sample upgrade, no saving until the
 * read works again).
 */
export type StrokesRead<T> =
  | ({ ok: true } & StrokesSnapshot<T>)
  | { ok: false; error: StorageErrorKind; slideIds: string[] };

export async function loadAllStrokes<T>(slideIds: string[]): Promise<StrokesRead<T>> {
  const strokes: Record<string, T[]> = {};
  const revisions: Record<string, number> = {};
  for (const id of slideIds) {
    const read = await readStrokes<T>(id);
    if (!read.ok) return { ok: false, error: read.error, slideIds: [id] };
    if (read.present) {
      strokes[id] = read.record.strokes;
      revisions[id] = read.record.revision;
    } else {
      revisions[id] = 0;
    }
  }
  return { ok: true, strokes, revisions };
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
