import { beforeEach, describe, expect, it } from 'vitest';
import { formatClock } from '../src/components/FocusTimer';
import { cycleStatus } from '../src/lib/study';
import {
  __resetMemoryStore, deleteStrokes, getStrokes, getWorkspace, setStrokes, setWorkspace, storageKind,
} from '../src/lib/db';

describe('focus timer clock', () => {
  it('formats mm:ss', () => {
    expect(formatClock(1500)).toBe('25:00');
    expect(formatClock(59)).toBe('00:59');
    expect(formatClock(0)).toBe('00:00');
  });

  it('never shows a negative clock', () => {
    expect(formatClock(-4)).toBe('00:00');
  });
});

describe('학습 상태 순환', () => {
  it('goes 미학습 → 복습 필요 → 이해 완료 → 미학습', () => {
    expect(cycleStatus('unlearned')).toBe('review');
    expect(cycleStatus('review')).toBe('done');
    expect(cycleStatus('done')).toBe('unlearned');
  });
});

describe('스토리지 (IndexedDB 폴백)', () => {
  beforeEach(() => {
    __resetMemoryStore();
  });

  it('reports which storage is in use', () => {
    expect(['indexeddb', 'memory']).toContain(storageKind());
  });

  it('stores and reads the workspace record', async () => {
    await setWorkspace({ version: 1, decks: [] });
    expect(await getWorkspace<{ version: number }>()).toEqual({ version: 1, decks: [] });
  });

  it('keeps slide ink under its own key', async () => {
    const strokes = [{ id: 'a', tool: 'pen', color: '#000', width: 2, points: [{ x: 0, y: 0 }] }];
    await setStrokes('sl_1', strokes);
    expect(await getStrokes('sl_1')).toEqual(strokes);
    await deleteStrokes('sl_1');
    expect(await getStrokes('sl_1')).toBeUndefined();
  });
});
