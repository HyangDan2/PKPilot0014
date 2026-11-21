import { describe, expect, it } from 'vitest';
import { deckOverview, progressShares, updatedLabel } from '../src/lib/overview';
import type { Deck, Slide } from '../src/types/study';

function slide(status: Slide['status'], note = ''): Slide {
  return { id: `sl_${Math.random()}`, title: '장', markdown: '# 장', note, status };
}

function deck(slides: Slide[]): Deck {
  return { id: 'deck_1', title: '강의', slides, summary: '', createdAt: 0, updatedAt: 0 };
}

describe('랜딩 강의 요약', () => {
  it('슬라이드 수와 학습 상태를 센다', () => {
    const overview = deckOverview(deck([
      slide('done', '메모'),
      slide('done'),
      slide('review', '  '),
      slide('unlearned'),
    ]));
    expect(overview.slides).toBe(4);
    expect(overview.done).toBe(2);
    expect(overview.review).toBe(1);
    expect(overview.unlearned).toBe(1);
    expect(overview.notes).toBe(1);
    expect(overview.progress).toBe(50);
  });

  it('빈 덱은 0%이고 0으로 나누지 않는다', () => {
    expect(deckOverview(deck([]))).toEqual({
      slides: 0, notes: 0, done: 0, review: 0, unlearned: 0, progress: 0,
    });
    expect(progressShares(deckOverview(deck([])))).toEqual({ done: 0, review: 0 });
  });

  it('진행 막대 비율은 이해 완료 → 복습 순서다', () => {
    const shares = progressShares(deckOverview(deck([
      slide('done'), slide('review'), slide('review'), slide('unlearned'),
    ])));
    expect(shares.done).toBe(25);
    expect(shares.review).toBe(50);
    expect(shares.done + shares.review).toBe(75);
  });
});

describe('랜딩 수정 시각 표기', () => {
  const now = new Date(2026, 10, 21, 14, 0, 0).getTime();

  it('오늘 · 어제 · 같은 해 · 다른 해를 구분한다', () => {
    expect(updatedLabel(new Date(2026, 10, 21, 9, 0, 0).getTime(), now)).toBe('오늘');
    expect(updatedLabel(new Date(2026, 10, 20, 23, 0, 0).getTime(), now)).toBe('어제');
    expect(updatedLabel(new Date(2026, 10, 3, 10, 0, 0).getTime(), now)).toBe('11월 3일');
    expect(updatedLabel(new Date(2025, 11, 31, 10, 0, 0).getTime(), now)).toBe('2025. 12. 31.');
  });
});
