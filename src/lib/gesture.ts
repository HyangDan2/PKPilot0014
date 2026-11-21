import type { ViewMode } from '../types/study';

/**
 * Pointer gestures for the slide viewport. Kept as a pure function so the
 * thresholds stay testable without a DOM: only a long, mostly-horizontal drag
 * counts, and never while the person is writing or editing text.
 */
export const SWIPE_MIN_DISTANCE = 48;
export const SWIPE_DIRECTION_RATIO = 1.3;

export interface SwipeInput {
  dx: number;
  dy: number;
  penOn: boolean;
  viewMode: ViewMode;
  minDistance?: number;
  ratio?: number;
}

/** -1 = the previous slide, 1 = the next slide, 0 = not a slide swipe. */
export function resolveSwipe({
  dx, dy, penOn, viewMode, minDistance = SWIPE_MIN_DISTANCE, ratio = SWIPE_DIRECTION_RATIO,
}: SwipeInput): -1 | 0 | 1 {
  if (penOn || viewMode === 'edit') return 0;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < minDistance) return 0;
  if (absX < absY * ratio) return 0;
  return dx < 0 ? 1 : -1;
}

/** True when the keyboard belongs to a field, not to slide navigation. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.closest !== 'function') return false;
  return Boolean(
    element.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]',
    ),
  );
}
