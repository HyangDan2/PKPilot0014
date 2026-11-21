import type { Deck } from '../types/study';
import { normalizeTags } from './tags';

/**
 * The landing library: search, tag filter and paging over the decks kept in
 * this browser. Pure functions so the catalog's behaviour can be tested
 * without a browser, and so the page never renders more than one page of cards.
 */

export const CATALOG_PAGE_SIZE = 10;

export interface TagCount {
  tag: string;
  count: number;
}

/** Every tag in use, most-used first, then alphabetically. */
export function collectTags(decks: Deck[]): TagCount[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const deck of decks) {
    for (const tag of normalizeTags(deck.tags)) {
      const key = tag.toLowerCase();
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ko'),
  );
}

function haystack(deck: Deck): string {
  return [deck.title, deck.summary, ...normalizeTags(deck.tags)].join(' ').toLowerCase();
}

/** Title · summary · tag search (case-insensitive) and one optional tag. */
export function filterDecks(decks: Deck[], query = '', tag: string | null = null): Deck[] {
  const needle = query.trim().toLowerCase();
  const wanted = tag?.trim().toLowerCase() ?? '';
  return decks.filter((deck) => {
    if (wanted && !normalizeTags(deck.tags).some((item) => item.toLowerCase() === wanted)) return false;
    if (!needle) return true;
    return haystack(deck).includes(needle);
  });
}

export function pageCount(total: number, size = CATALOG_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

/** Clamps the page into range and returns that page's slice. */
export function pageSlice<T>(items: T[], page: number, size = CATALOG_PAGE_SIZE): T[] {
  const last = pageCount(items.length, size);
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), last);
  return items.slice((current - 1) * size, current * size);
}

/**
 * The page buttons to show: every page when few, otherwise first, last and a
 * window around the current page, with `'…'` for the gaps.
 */
export function pageWindow(page: number, total: number, size = CATALOG_PAGE_SIZE): (number | '…')[] {
  const last = pageCount(total, size);
  const current = Math.min(Math.max(1, page), last);
  if (last <= 7) return Array.from({ length: last }, (_, index) => index + 1);

  const pages = new Set<number>([1, last, current]);
  for (const offset of [-1, 1]) {
    const candidate = current + offset;
    if (candidate > 1 && candidate < last) pages.add(candidate);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  let previous = 0;
  for (const value of sorted) {
    if (previous && value - previous > 1) out.push('…');
    out.push(value);
    previous = value;
  }
  return out;
}
