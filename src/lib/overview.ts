import type { Deck } from '../types/study';
import { deckStats } from './study';

/**
 * Everything the landing page shows about one deck, computed once from the
 * deck itself so the catalog and the studio can never disagree about it.
 */
export interface DeckOverview {
  /** Slides in the deck. */
  slides: number;
  /** Slides that carry their own note. */
  notes: number;
  done: number;
  review: number;
  unlearned: number;
  /** Share of slides marked 이해 완료, 0–100, rounded. */
  progress: number;
}

export function deckOverview(deck: Deck): DeckOverview {
  const slides = deck.slides.length;
  const stats = deckStats(deck);
  const notes = deck.slides.filter((slide) => slide.note.trim().length > 0).length;
  return {
    slides,
    notes,
    done: stats.done,
    review: stats.review,
    unlearned: stats.unlearned,
    progress: slides === 0 ? 0 : Math.round((stats.done / slides) * 100),
  };
}

/** Bar widths for the learning-progress track: done, then review. */
export function progressShares(overview: DeckOverview): { done: number; review: number } {
  if (overview.slides === 0) return { done: 0, review: 0 };
  return {
    done: (overview.done / overview.slides) * 100,
    review: (overview.review / overview.slides) * 100,
  };
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * A short Korean stamp for the catalog card: 오늘 / 어제 / 11월 21일, and the
 * year only when it is a different one.
 */
export function updatedLabel(timestamp: number, now: number = Date.now()): string {
  const date = new Date(timestamp);
  const today = new Date(now);
  const days = Math.round((startOfDay(today) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  if (date.getFullYear() === today.getFullYear()) {
    return `${date.getMonth() + 1}월 ${date.getDate()}일`;
  }
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
}
