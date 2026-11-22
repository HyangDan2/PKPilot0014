import { useEffect, useRef, useState } from 'react';
import type { InkPoint, Stroke, StrokeTool } from '../types/study';
import { inkWidth } from '../types/study';
import { InkSession } from '../lib/ink';

interface Props {
  strokes: Stroke[];
  enabled: boolean;
  tool: StrokeTool;
  color: string;
  /** The slide this layer draws on. A stroke stays with it if the slide changes. */
  slideId: string;
  onCommit: (stroke: Stroke, slideId: string) => void;
}

export { inkWidth };

/**
 * 형광펜 / 펜 layer. Points are stored normalised (0–1) so a stroke keeps its
 * place when the 16:9 canvas changes size; the SVG is drawn in current pixels.
 *
 * The gesture state lives in an {@link InkSession} ref, not in React state:
 * one pointer gesture commits exactly one stroke, and the stroke lands on the
 * slide it was started on even if the viewer moves on mid-stroke.
 */
export function InkLayer({ strokes, enabled, tool, color, slideId, onCommit }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [live, setLive] = useState<InkPoint[]>([]);
  const session = useRef(new InkSession());
  const latest = useRef({ tool, color, slideId, onCommit });
  latest.current = { tool, color, slideId, onCommit };

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const measure = () => setSize({ w: node.clientWidth, h: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /** Ends the current gesture: one stroke, on the slide it started on. */
  const finish = () => {
    const { tool: penTool, color: penColor, onCommit: commit } = latest.current;
    const done = session.current.end(penTool, penColor, latest.current.slideId);
    setLive([]);
    if (done) commit(done.stroke, done.slideId);
  };

  // A slide switch (arrow key, drawer, swipe) must not leave a stale live path
  // on the new slide, and ink already drawn stays with the slide it started on.
  useEffect(() => {
    if (!session.current.drawing) {
      setLive([]);
      return;
    }
    finish();
    // `finish` reads the newest tool/color through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideId]);

  // Turning the pen off mid-stroke keeps what was drawn.
  useEffect(() => {
    if (enabled || !session.current.drawing) return;
    finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const toPoint = (event: React.PointerEvent<SVGSVGElement>): InkPoint => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
  };

  const onDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!enabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const points = session.current.begin(slideId, toPoint(event), event.pointerId);
    setLive([...points]);
  };

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!enabled || !session.current.owns(event.pointerId)) return;
    const before = session.current.live.length;
    const points = session.current.extend(toPoint(event));
    if (points.length !== before) setLive([...points]);
  };

  const onEnd = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!session.current.owns(event.pointerId)) return;
    finish();
  };

  const pathFor = (points: InkPoint[]): string =>
    points.map((p, index) => `${index === 0 ? 'M' : 'L'}${(p.x * size.w).toFixed(1)} ${(p.y * size.h).toFixed(1)}`).join(' ');

  return (
    <div className={`ink-wrap${enabled ? ' is-drawing' : ''}`} ref={wrapRef} data-testid="ink-layer">
      <svg
        className="ink-canvas"
        width={size.w || 1}
        height={size.h || 1}
        viewBox={`0 0 ${size.w || 1} ${size.h || 1}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onEnd}
        onPointerCancel={onEnd}
        onPointerLeave={(event) => {
          // While the pointer is captured the stroke keeps going outside the
          // canvas; only an uncaptured leave ends it here.
          if (!session.current.owns(event.pointerId)) return;
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
          finish();
        }}
        style={{ cursor: enabled ? 'crosshair' : 'default' }}
      >
        {strokes.map((stroke) => (
          <path
            key={stroke.id}
            d={pathFor(stroke.points)}
            fill="none"
            stroke={stroke.color}
            strokeWidth={stroke.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={stroke.tool === 'highlighter' ? 0.42 : 0.92}
            style={{ mixBlendMode: stroke.tool === 'highlighter' ? 'multiply' : 'normal' }}
          />
        ))}
        {live.length > 0 && (
          <path
            d={pathFor(live)}
            fill="none"
            stroke={color}
            strokeWidth={inkWidth(tool)}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={tool === 'highlighter' ? 0.42 : 0.92}
            style={{ mixBlendMode: tool === 'highlighter' ? 'multiply' : 'normal' }}
          />
        )}
      </svg>
    </div>
  );
}
