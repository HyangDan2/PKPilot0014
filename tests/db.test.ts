import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetMemoryStore, __resetConnection, __setStorageErrorForTest, classifyStorageError, deleteStrokes,
  flushStorage, getStrokes, getWorkspace, pendingWritesCount, replaceWorkspace, setStrokes, setWorkspace,
  storageStatus, subscribeStorage,
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
});

describe('복원 한 번에 workspace + 필기 교체', () => {
  beforeEach(() => {
    __resetMemoryStore();
    __resetConnection();
  });

  it('복원본에 없는 필기는 지우고, 있는 필기는 그대로 남긴다', async () => {
    await setStrokes('sl_old', [{ id: 's1', points: [{ x: 0.1, y: 0.1 }] }]);
    await setStrokes('sl_keep', [{ id: 's2', points: [{ x: 0.2, y: 0.2 }] }]);
    await setWorkspace({ version: 1, decks: [{ id: 'deck_old' }] });

    const ok = await replaceWorkspace({
      workspace: { version: 1, decks: [{ id: 'deck_new' }] },
      strokes: { sl_keep: [{ id: 's2', points: [{ x: 0.2, y: 0.2 }] }] },
      removeStrokeIds: ['sl_old'],
    });
    await flushStorage();

    expect(ok).toBe(true);
    expect(await getWorkspace<{ decks: { id: string }[] }>()).toEqual({ version: 1, decks: [{ id: 'deck_new' }] });
    expect(await getStrokes('sl_old')).toBeUndefined();
    expect(await getStrokes('sl_keep')).toEqual([{ id: 's2', points: [{ x: 0.2, y: 0.2 }] }]);
  });

  it('필기 삭제도 대기열을 비우면 즉시 반영된다', async () => {
    await setStrokes('sl_a', [{ id: 'a' }]);
    await deleteStrokes('sl_a');
    await flushStorage();
    expect(await getStrokes('sl_a')).toBeUndefined();
    expect(pendingWritesCount()).toBe(0);
  });
});

describe('pagehide flush', () => {
  beforeEach(() => {
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

    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, writable: true, value: original });
    __resetConnection();

    expect(seen).toContain('unavailable');
    expect(storageStatus().kind).toBe('memory');
    expect(await getWorkspace<{ version: number }>()).toEqual({ version: 1, decks: [] });
    __setStorageErrorForTest(null);
  });
});
