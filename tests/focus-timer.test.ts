import { describe, expect, it } from 'vitest';
import { formatClock, remainingSeconds } from '../src/components/FocusTimer';

describe('집중 타이머 — 실제 경과 시간', () => {
  it('벽시계 기준으로 남은 초를 센다', () => {
    const endAt = 1_000_000 + 25 * 60 * 1000;
    expect(remainingSeconds(endAt, 1_000_000)).toBe(1500);
    expect(remainingSeconds(endAt, 1_000_000 + 90_000)).toBe(1410);
    expect(remainingSeconds(endAt, endAt)).toBe(0);
    expect(remainingSeconds(endAt, endAt + 5_000)).toBe(0);
  });

  it('백그라운드에서 돌아와도 흐른 시간이 그대로 반영된다', () => {
    // Counting interval ticks in a hidden tab drifts; reading the deadline
    // after a long gap lands exactly where the clock is.
    const start = 1_000_000;
    const total = 25 * 60;
    const endAt = start + total * 1000;
    const afterHidden = start + 7 * 60 * 1000 + 40 * 1000;
    expect(formatClock(remainingSeconds(endAt, afterHidden))).toBe('17:20');
  });

  it('끝난 시각을 넘겨도 음수가 되지 않는다', () => {
    expect(formatClock(remainingSeconds(0, 10_000))).toBe('00:00');
    expect(remainingSeconds(Number.NaN, 1)).toBe(0);
  });
});
