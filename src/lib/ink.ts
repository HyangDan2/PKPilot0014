import type { InkPoint, Stroke, StrokeTool } from '../types/study';
import { inkWidth } from '../types/study';
import { uid } from './study';

/**
 * One pointer gesture, from the slide it was started on to the stroke it
 * becomes. The session lives outside React state on purpose: committing from
 * inside a state updater ran twice under StrictMode and left duplicate strokes
 * behind, and a slide switch during a stroke could file the ink on the wrong
 * slide. Here a gesture ends exactly once, and the slide id is the one captured
 * at pointerdown.
 */
export interface InkCommit {
  stroke: Stroke;
  slideId: string;
}

export class InkSession {
  private points: InkPoint[] = [];
  private slideId = '';
  private pointerId: number | null = null;

  get drawing(): boolean {
    return this.pointerId !== null;
  }

  get live(): InkPoint[] {
    return this.points;
  }

  /** Starts a gesture on `slideId`; later moves belong to it until it ends. */
  begin(slideId: string, point: InkPoint, pointerId: number | null = null): InkPoint[] {
    this.slideId = slideId;
    this.pointerId = pointerId;
    this.points = [point];
    return this.points;
  }

  /** Adds a point, dropping moves too small to change the stroke. */
  extend(point: InkPoint, minStep = 0.0018): InkPoint[] {
    if (this.pointerId === null) return this.points;
    const last = this.points[this.points.length - 1];
    if (last && Math.hypot(last.x - point.x, last.y - point.y) < minStep) return this.points;
    this.points = [...this.points, point];
    return this.points;
  }

  /** True when `pointerId` is the pointer that opened this gesture. */
  owns(pointerId: number | null): boolean {
    return this.pointerId !== null && (pointerId === null || this.pointerId === pointerId);
  }

  /**
   * Ends the gesture and returns its stroke once. A second call returns null,
   * so a `pointerup` followed by a `pointercancel`/`pointerleave` cannot write
   * the same stroke twice.
   */
  end(tool: StrokeTool, color: string, fallbackSlideId = ''): InkCommit | null {
    if (this.pointerId === null) return null;
    const points = this.points;
    const slideId = this.slideId || fallbackSlideId;
    this.reset();
    if (!points.length) return null;
    return {
      stroke: {
        id: uid('st'),
        tool,
        color,
        width: inkWidth(tool),
        points: points.length === 1 ? [points[0], points[0]] : points,
      },
      slideId,
    };
  }

  /** Drops the gesture without committing (disabled pen, unmounted layer). */
  abandon(): void {
    this.reset();
  }

  private reset(): void {
    this.points = [];
    this.slideId = '';
    this.pointerId = null;
  }
}
