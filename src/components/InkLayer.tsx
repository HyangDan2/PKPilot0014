import { useEffect, useRef, useState } from 'react';
import type { InkPoint, Stroke, StrokeTool } from '../types/study';
import { uid } from '../lib/study';

interface Props {
  strokes: Stroke[];
  enabled: boolean;
  tool: StrokeTool;
  color: string;
  onCommit: (stroke: Stroke) => void;
}

export function inkWidth(tool: StrokeTool): number {
  return tool === 'highlighter' ? 16 : 2.6;
}

/**
 * 형광펜 / 펜 layer. Points are stored normalised (0–1) so a stroke keeps its
 * place when the 16:9 canvas changes size; the SVG is drawn in current pixels.
 */
export function InkLayer({ strokes, enabled, tool, color, onCommit }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [live, setLive] = useState<InkPoint[]>([]);
  const drawing = useRef(false);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const measure = () => setSize({ w: node.clientWidth, h: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

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
    drawing.current = true;
    setLive([toPoint(event)]);
  };

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!enabled || !drawing.current) return;
    const point = toPoint(event);
    setLive((prev) => {
      const last = prev[prev.length - 1];
      if (last && Math.hypot(last.x - point.x, last.y - point.y) < 0.0018) return prev;
      return [...prev, point];
    });
  };

  const finish = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setLive((points) => {
      if (points.length > 0) {
        onCommit({
          id: uid('st'),
          tool,
          color,
          width: inkWidth(tool),
          points: points.length === 1 ? [points[0], points[0]] : points,
        });
      }
      return [];
    });
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
        onPointerUp={finish}
        onPointerCancel={finish}
        onPointerLeave={() => { if (drawing.current) finish(); }}
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
