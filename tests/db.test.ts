import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// Registers a spec-compliant IndexedDB as the page global so these tests walk
// the same transaction path a browser does (happy-dom has none).
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  __resetMemoryStore, __resetConnection, __setStorageErrorForTest, classifyStorageError, commitWorkspace,
  flushStorage, getStrokes, getWorkspace, loadAllStrokes, pendingWritesCount, readStrokes, readWorkspace,
  readWorkspaceRevision, replaceWorkspace, setStrokeRevision, setStrokes, setWorkspace,
  setWorkspaceRevision, storageStatus, subscribeStorage,
} from '../src/lib/db';
import { storageNoticeFor } from '../src/lib/storageNotice';

describe('저장 오류 분류', () => {
  it('용량 초과를 quota로 읽는다', () => {
    const quota = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    expect(classifyStorageError(quota)).toBe('quota');
    expect(classifyStorageError(new DOMException('nope', 'NS_ERROR_DOM_QUOTA_REACHED'))).toBe('quota');
    expect(classifyStorageError({ code: 22 })).toBe('quota');
    expect(classifyStorageError({ message: 'Quota exceeded' })).toBe('quota');
  });

  it('저장소를 열 수 없는 오류와 일반 쓰기 실패를 구분한다', () => {
    expect(classifyStorageError(new DOMException('x', 'InvalidStateError'))).toBe('unavailable');
    expect(classifyStorageError(new Error('boom'))).toBe('write');
    expect(classifyStorageError(null)).toBe('write');
  });
});

describe('저장 상태 알림', () => {
  beforeEach(() => {
    __resetMemoryStore();
  });

  it('상태가 바뀌면 구독자에게 알리고, 같은 상태는 다시 알리지 않는다', () => {
    const seen: (string | null)[] = [];
    const off = subscribeStorage((next) => seen.push(next.error));
    __setStorageErrorForTest('quota');
    __setStorageErrorForTest('quota');
    __setStorageErrorForTest(null);
    off();
    __setStorageErrorForTest('write');
    expect(seen).toEqual(['quota', null]);
    expect(storageStatus().error).toBe('write');
    __setStorageErrorForTest(null);
  });

  it('오류 종류마다 다른 안내 문구를 준다', () => {
    const quota = storageNoticeFor({ kind: 'indexeddb', error: 'quota' });
    expect(quota?.tone).toBe('error');
    expect(quota?.body).toContain('.study.json');

    const unavailable = storageNoticeFor({ kind: 'memory', error: 'unavailable' });
    expect(unavailable?.title).toContain('저장소');

    const memory = storageNoticeFor({ kind: 'memory', error: null });
    expect(memory?.key).toBe('memory');
    expect(memory?.tone).toBe('warn');

    expect(storageNoticeFor({ kind: 'indexeddb', error: null })).toBeNull();
  });

  it('읽기 실패는 쓰기 실패와 다른 안내를 준다', () => {
    const read = storageNoticeFor({ kind: 'indexeddb', error: 'read' });
    expect(read?.key).toBe('read');
    expect(read?.tone).toBe('error');
    expect(read?.body).toContain('덮어쓰지');
  });
});

// ── the real IndexedDB code path ─────────────────────────────────────────
// happy-dom ships no IndexedDB, so the store would fall back to memory and
// never exercise a transaction. These cases install a spec-compliant
// implementation (fake-indexeddb) so commit/abort behaviour is real.

describe('IndexedDB 트랜잭션', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: new IDBFactory(),
    });
    __resetMemoryStore();
    __resetConnection();
  });

  afterEach(() => {
    restorePrototypes();
    __setStorageErrorForTest(null);
  });

  it('복원본에 없는 필기는 지우고, 있는 필기는 그대로 남긴다', async () => {
    await setStrokes('sl_old', [{ id: 's1', points: [{ x: 0.1, y: 0.1 }] }]);
    await setStrokes('sl_keep', [{ id: 's2', points: [{ x: 0.2, y: 0.2 }] }]);
    await setWorkspace({ version: 1, decks: [{ id: 'deck_old' }] });

    const ok = await replaceWorkspace({
      workspace: { version: 1, decks: [{ id: 'deck_new' }] },
      strokes: { sl_keep: [{ id: 's2', points: [{ x: 0.2, y: 0.2 }] }] },
    });

    expect(ok).toBe(true);
    expect(await getWorkspace<{ decks: { id: string }[] }>()).toEqual({ version: 1, decks: [{ id: 'deck_new' }] });
    expect(await getStrokes('sl_old')).toBeUndefined();
    expect(await getStrokes('sl_keep')).toEqual([{ id: 's2', points: [{ x: 0.2, y: 0.2 }] }]);
  });

  it('호출자가 모르는 필기 기록까지 저장소를 완전히 비우고 복원본만 남긴다', async () => {
    // A stroke record the room never loaded (written by an older build, or by
    // a slide removed in a previous session).
    await setStrokes('sl_forgotten', [{ id: 's9' }]);
    await setStrokes('sl_keep', [{ id: 's2' }]);

    const ok = await replaceWorkspace({
      workspace: { version: 1, decks: [{ id: 'deck_new' }] },
      strokes: { sl_keep: [{ id: 's2' }] },
    });

    expect(ok).toBe(true);
    expect(await getStrokes('sl_forgotten')).toBeUndefined();
    expect(await getStrokes('sl_keep')).toEqual([{ id: 's2' }]);
  });

  it('같은 슬라이드 ID라도 복원본에 필기가 없으면 지운다', async () => {
    await setStrokes('sl_same', [{ id: 's1' }]);
    await setStrokes('sl_other', [{ id: 's2' }]);

    const ok = await replaceWorkspace({
      workspace: { version: 1, decks: [{ id: 'deck_new' }] },
      // The backup carries the slide, but the person erased its ink.
      strokes: {},
    });

    expect(ok).toBe(true);
    expect(await getStrokes('sl_same')).toBeUndefined();
    expect(await getStrokes('sl_other')).toBeUndefined();
  });

  it('덱 삭제는 workspace 저장과 필기 삭제가 한 트랜잭션으로 끝난다', async () => {
    await setWorkspace({ version: 1, decks: [{ id: 'deck_a' }] });
    await setStrokes('sl_a', [{ id: 'a' }]);

    const ok = await commitWorkspace({
      workspace: { version: 1, decks: [] },
      deleteStrokeIds: ['sl_a'],
    });

    expect(ok).toBe(true);
    expect(await getWorkspace()).toEqual({ version: 1, decks: [] });
    expect(await getStrokes('sl_a')).toBeUndefined();
  });

  it('트랜잭션 도중 실패하면 workspace도 필기도 예전 상태 그대로다', async () => {
    await setWorkspace({ version: 1, decks: [{ id: 'deck_a' }] });
    await setStrokes('sl_a', [{ id: 'a' }]);

    // The workspace put succeeds inside the transaction, then the ink delete
    // is refused: the abort must take the put back with it.
    patchStore('delete', function patched(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['delete']>) {
      if (this.name === 'strokes') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return originalDelete.apply(this, args);
    });

    const ok = await commitWorkspace({
      workspace: { version: 1, decks: [] },
      deleteStrokeIds: ['sl_a'],
    });

    expect(ok).toBe(false);
    expect(await getWorkspace()).toEqual({ version: 1, decks: [{ id: 'deck_a' }] });
    expect(await getStrokes('sl_a')).toEqual([{ id: 'a' }]);
    expect(storageStatus().error).toBe('quota');
  });

  it('setWorkspace는 성공·실패를 명시적으로 돌려준다', async () => {
    expect(await setWorkspace({ version: 1, marker: 'ok' })).toBe(true);

    patchStore('put', function patched(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'workspace') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return originalPut.apply(this, args);
    });
    expect(await setWorkspace({ version: 1, marker: 'failed' })).toBe(false);

    restorePrototypes();
    expect((await getWorkspace<{ marker: string }>())?.marker).toBe('ok');
  });

  it('덱 삭제 후에도 대기 중인 쓰기가 남지 않는다', async () => {
    await setStrokes('sl_a', [{ id: 'a' }]);
    await commitWorkspace({ workspace: { version: 1, decks: [] }, deleteStrokeIds: ['sl_a'] });
    await flushStorage();
    expect(pendingWritesCount()).toBe(0);
  });
});

describe('저장소 읽기 — 실패와 빈 저장소를 구분', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: new IDBFactory(),
    });
    __resetMemoryStore();
    __resetConnection();
  });

  afterEach(() => {
    restorePrototypes();
    __setStorageErrorForTest(null);
  });

  it('처음 여는 저장소는 성공한 빈 값이다', async () => {
    const read = await readWorkspace<unknown>();
    expect(read.ok).toBe(true);
    expect(read.ok && read.value).toBeUndefined();
  });

  it('일시적 읽기 실패는 빈 저장소로 보고하지 않는다', async () => {
    await setWorkspace({ version: 1, decks: [{ id: 'deck_a' }] });

    patchStore('get', function patched(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['get']>) {
      if (this.name === 'workspace') throw new Error('read failed');
      return originalGet.apply(this, args);
    });

    const read = await readWorkspace<unknown>();
    expect(read.ok).toBe(false);
    expect(storageStatus().error).toBe('read');

    restorePrototypes();
    const again = await readWorkspace<{ decks: { id: string }[] }>();
    expect(again.ok).toBe(true);
    expect(again.ok && again.value).toEqual({ version: 1, decks: [{ id: 'deck_a' }] });
  });
});

describe('저장 오류는 다른 저장소의 성공으로 지워지지 않는다', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: new IDBFactory(),
    });
    __resetMemoryStore();
    __resetConnection();
  });

  afterEach(() => {
    restorePrototypes();
    __setStorageErrorForTest(null);
  });

  it('필기 쓰기가 실패한 뒤 workspace 쓰기가 성공해도 오류는 남는다', async () => {
    patchStore('put', function patched(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'strokes') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return originalPut.apply(this, args);
    });

    expect(await setStrokes('sl_a', [{ id: 'a' }])).toBe(false);
    expect(storageStatus().error).toBe('quota');

    expect(await setWorkspace({ version: 1 })).toBe(true);
    expect(storageStatus().error).toBe('quota');

    restorePrototypes();
    expect(await setStrokes('sl_a', [{ id: 'a' }])).toBe(true);
    expect(storageStatus().error).toBeNull();
  });
});

describe('pagehide flush', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: new IDBFactory(),
    });
    __resetMemoryStore();
    __resetConnection();
  });

  it('대기 중인 쓰기를 모두 기다린 뒤 끝난다', async () => {
    const writes = Array.from({ length: 5 }, (_, index) => setWorkspace({ version: 1, marker: index }));
    expect(pendingWritesCount()).toBeGreaterThan(1);
    await flushStorage();
    expect(pendingWritesCount()).toBe(0);
    await Promise.all(writes);
    expect((await getWorkspace<{ marker: number }>())?.marker).toBe(4);
  });
});

describe('쓰기 실패가 조용히 지나가지 않는다', () => {
  it('저장소를 열지 못하면 메모리로 넘어가고 그 사실을 상태로 알린다', async () => {
    const original = globalThis.indexedDB;
    // A browser that blocks IndexedDB (private mode, hardened settings) throws
    // from open(); the room must keep working in memory and say so.
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: { open() { throw new Error('blocked'); } },
    });
    __resetMemoryStore();
    __resetConnection();
    const seen: (string | null)[] = [];
    const off = subscribeStorage((next) => seen.push(next.error));

    await setWorkspace({ version: 1, decks: [] });
    await flushStorage();
    off();
    // While the store is unreadable the value lives in the memory map, which
    // is exactly what the room keeps using for the rest of this session.
    const stored = await getWorkspace<{ version: number }>();
    const kind = storageStatus().kind;

    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, writable: true, value: original });
    __resetConnection();
    __resetMemoryStore();

    expect(seen).toContain('unavailable');
    expect(kind).toBe('memory');
    expect(stored).toEqual({ version: 1, decks: [] });
    __setStorageErrorForTest(null);
  });
});

// ── prototype fault injection ────────────────────────────────────────────

const originalPut = IDBObjectStore.prototype.put;
const originalDelete = IDBObjectStore.prototype.delete;
const originalGet = IDBObjectStore.prototype.get;

function patchStore(
  method: 'put' | 'delete' | 'get',
  replacement: (this: IDBObjectStore, ...args: never[]) => unknown,
): void {
  Object.defineProperty(IDBObjectStore.prototype, method, {
    configurable: true,
    writable: true,
    value: replacement,
  });
}

function restorePrototypes(): void {
  Object.defineProperty(IDBObjectStore.prototype, 'put', { configurable: true, writable: true, value: originalPut });
  Object.defineProperty(IDBObjectStore.prototype, 'delete', { configurable: true, writable: true, value: originalDelete });
  Object.defineProperty(IDBObjectStore.prototype, 'get', { configurable: true, writable: true, value: originalGet });
}

// ── revisions: two tabs, one record ──────────────────────────────────────

describe('revision이 있는 저장 — 다른 탭의 최신 저장을 덮어쓰지 않는다', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: new IDBFactory(),
    });
    __resetMemoryStore();
    __resetConnection();
  });

  afterEach(() => {
    restorePrototypes();
    __setStorageErrorForTest(null);
  });

  it('워크스페이스는 저장된 revision과 다르면 쓰지 않고 알린다', async () => {
    const first = await setWorkspaceRevision({ version: 1, marker: 'first' }, 0);
    expect(first.ok).toBe(true);
    expect(first.revision).toBe(1);

    // A second tab still holds revision 0 — its copy must not land.
    const refused = await setWorkspaceRevision({ version: 1, marker: 'stale' }, 0);
    expect(refused.ok).toBe(false);
    expect(refused.conflict).toBe(true);
    expect(refused.revision).toBe(1);
    expect(await getWorkspace<{ marker: string }>()).toEqual({ version: 1, marker: 'first' });

    // Its own next write goes through with the revision it was told about.
    const kept = await setWorkspaceRevision({ version: 1, marker: 'stale' }, refused.revision);
    expect(kept.ok).toBe(true);
    expect(await getWorkspace<{ marker: string }>()).toEqual({ version: 1, marker: 'stale' });
  });

  it('저장된 워크스페이스 레코드의 모양은 그대로다(revision은 옆 키)', async () => {
    await setWorkspaceRevision({ version: 1, decks: [], settings: { theme: 'light' } }, 0);
    const record = await pageWorkspaceRecord();
    expect(Object.keys(record).sort()).toEqual(['decks', 'settings', 'version']);
    expect(await readWorkspaceRevision()).toBe(1);
  });

  it('필기 기록도 revision이 다르면 다른 탭의 목록을 덮어쓰지 않는다', async () => {
    await setStrokes('sl_a', [{ id: 'mine', strokes: 1 }]);
    const stored = await readStrokes('sl_a');
    expect(stored.ok && stored.record.revision).toBe(1);

    const refused = await setStrokeRevision('sl_a', [{ id: 'other', strokes: 9 }], 0);
    expect(refused.ok).toBe(false);
    expect(refused.conflict).toBe(true);
    expect(await getStrokes('sl_a')).toEqual([{ id: 'mine', strokes: 1 }]);

    const kept = await setStrokeRevision('sl_a', [{ id: 'other', strokes: 9 }], refused.revision);
    expect(kept.ok).toBe(true);
    expect(await getStrokes('sl_a')).toEqual([{ id: 'other', strokes: 9 }]);
  });

  it('revision 이전에 쓰인 배열 기록도 읽고, 다음 쓰기에서 revision을 붙인다', async () => {
    // An older build wrote the bare array under the slide id.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('saga-glitra', 1);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        const opened = request.result;
        if (!opened.objectStoreNames.contains('workspace')) opened.createObjectStore('workspace');
        if (!opened.objectStoreNames.contains('strokes')) opened.createObjectStore('strokes');
      };
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('strokes', 'readwrite');
      tx.objectStore('strokes').put([{ id: 'legacy' }], 'sl_legacy');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });

    const read = await readStrokes('sl_legacy');
    expect(read.ok).toBe(true);
    expect(read.ok && read.record.revision).toBe(0);
    expect(await getStrokes('sl_legacy')).toEqual([{ id: 'legacy' }]);

    const written = await setStrokeRevision('sl_legacy', [{ id: 'legacy' }, { id: 'new' }], 0);
    expect(written.ok).toBe(true);
    expect(written.revision).toBe(1);
    expect(await getStrokes('sl_legacy')).toEqual([{ id: 'legacy' }, { id: 'new' }]);
  });
});

describe('loadAllStrokes — 읽기 실패와 데이터 부재를 구분한다', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: new IDBFactory(),
    });
    __resetMemoryStore();
    __resetConnection();
  });

  afterEach(() => {
    restorePrototypes();
    __setStorageErrorForTest(null);
  });

  it('필기가 없는 슬라이드는 성공한 빈 결과다', async () => {
    await setStrokes('sl_a', [{ id: 'a' }]);
    const read = await loadAllStrokes<{ id: string }>(['sl_a', 'sl_empty']);
    expect(read.ok).toBe(true);
    expect(read.ok && read.strokes).toEqual({ sl_a: [{ id: 'a' }] });
    expect(read.ok && read.revisions.sl_empty).toBe(0);
  });

  it('한 슬라이드라도 읽지 못하면 전체를 실패로 돌려준다', async () => {
    await setStrokes('sl_a', [{ id: 'a' }]);
    await setStrokes('sl_b', [{ id: 'b' }]);

    patchStore('get', function patched(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['get']>) {
      if (this.name === 'strokes' && args[0] === 'sl_b') throw new Error('read failed');
      return originalGet.apply(this, args);
    });

    const read = await loadAllStrokes(['sl_a', 'sl_b']);
    expect(read.ok).toBe(false);
    expect(read.ok === false && read.slideIds).toEqual(['sl_b']);
    expect(storageStatus().error).toBe('read');
  });
});

/** The raw workspace record, without going through the read helpers. */
async function pageWorkspaceRecord(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('saga-glitra', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction('workspace', 'readonly').objectStore('workspace').get('current');
      get.onsuccess = () => { db.close(); resolve(get.result as Record<string, unknown>); };
      get.onerror = () => { db.close(); reject(get.error); };
    };
  });
}
