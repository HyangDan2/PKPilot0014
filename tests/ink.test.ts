import { describe, expect, it } from 'vitest';
import { InkSession } from '../src/lib/ink';
import type { InkPoint } from '../src/types/study';

const P = (x: number, y: number): InkPoint => ({ x, y });

describe('필기 한 획 — InkSession', () => {
  it('포인터 종료에서 정확히 한 번만 커밋한다', () => {
    const session = new InkSession();
    session.begin('sl_a', P(0.1, 0.1), 1);
    session.extend(P(0.2, 0.2), 0);
    const first = session.end('pen', '#23203a');
    expect(first?.stroke.points).toHaveLength(2);
    expect(session.end('pen', '#23203a')).toBeNull();
    expect(session.end('pen', '#23203a')).toBeNull();
  });

  it('StrictMode처럼 end가 두 번 불려도 획은 하나다', () => {
    const session = new InkSession();
    session.begin('sl_a', P(0.1, 0.1), 7);
    const commits = [session.end('highlighter', '#f5c542'), session.end('highlighter', '#f5c542')]
      .filter(Boolean);
    expect(commits).toHaveLength(1);
  });

  it('시작한 슬라이드에 획이 남는다 — 도중에 슬라이드가 바뀌어도', () => {
    const session = new InkSession();
    session.begin('sl_first', P(0.3, 0.3), 2);
    session.extend(P(0.4, 0.4), 0);
    // The viewer moves to another slide; the gesture still belongs to the first.
    const done = session.end('pen', '#23203a', 'sl_second');
    expect(done?.slideId).toBe('sl_first');
  });

  it('다른 포인터의 이동·종료는 이 획에 섞이지 않는다', () => {
    const session = new InkSession();
    session.begin('sl_a', P(0.1, 0.1), 1);
    // The layer asks `owns` before feeding a move, so a second finger cannot
    // extend or end the stroke that the first one started.
    expect(session.owns(2)).toBe(false);
    expect(session.owns(1)).toBe(true);
    expect(session.owns(null)).toBe(true);
  });

  it('아주 작은 이동은 점을 늘리지 않는다', () => {
    const session = new InkSession();
    session.begin('sl_a', P(0.5, 0.5), 1);
    session.extend(P(0.5001, 0.5001));
    expect(session.live).toHaveLength(1);
  });

  it('점 하나짜리 탭도 보이는 획이 된다', () => {
    const session = new InkSession();
    session.begin('sl_a', P(0.5, 0.5), 1);
    const done = session.end('pen', '#23203a');
    expect(done?.stroke.points).toEqual([P(0.5, 0.5), P(0.5, 0.5)]);
    expect(done?.stroke.width).toBe(2.6);
  });

  it('버려진 획은 커밋되지 않는다', () => {
    const session = new InkSession();
    session.begin('sl_a', P(0.5, 0.5), 1);
    session.abandon();
    expect(session.end('pen', '#23203a')).toBeNull();
    expect(session.drawing).toBe(false);
  });

  it('도구별 굵기를 지킨다', () => {
    const session = new InkSession();
    session.begin('sl_a', P(0.1, 0.1), 1);
    expect(session.end('highlighter', '#f5c542')?.stroke.width).toBe(16);
  });
});
