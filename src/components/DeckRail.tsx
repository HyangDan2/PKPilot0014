import { useCallback, useEffect, useRef, useState } from 'react';
import type { StudioApi } from '../store/studio';
import { STATUS_LABEL, STATUS_SHORT } from '../types/study';
import { plainText } from '../lib/markdown';
import { IconCopy, IconDown, IconPlus, IconTrash, IconUp } from './Icons';

interface Props {
  studio: StudioApi;
  onToast: (message: string) => void;
  /** Only set while the rail is a drawer (a phone) — a slide pick folds it. */
  onClose?: () => void;
  drawerOpen?: boolean;
}

/** Palette width estimate: four 21px buttons, gaps, padding and border. */
const PALETTE_WIDTH = 104;

/**
 * The slide drawer. On a wide screen it is the fixed left rail; on a phone it
 * slides over the stage and folds again as soon as a slide is picked.
 *
 * The 순서/복제/삭제 palette floats *outside* the drawer's right edge, level
 * with the hovered (or current) slide, so it never covers the slide list. It is
 * a fixed-position child of the row: fixed keeps it out of the list's scroll
 * clipping, and being a child keeps the row's hover while the pointer is on it.
 */
export function DeckRail({ studio, onToast, onClose, drawerOpen = false }: Props) {
  const { deck, slide, selectSlide, addSlide, duplicateSlide, deleteSlide, moveSlide, moveSlideTo, toggleStatus } = studio;
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ id: string; top: number; left: number } | null>(null);
  const [isDrawer, setIsDrawer] = useState(false);
  const itemRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const listRef = useRef<HTMLOListElement | null>(null);
  const railRef = useRef<HTMLElement | null>(null);

  // Below 920px the rail is an overlay drawer; above it, a fixed rail. The
  // palette follows the pointer on the fixed rail, and the current slide inside
  // the drawer (a phone has no hover to aim with).
  useEffect(() => {
    const query = window.matchMedia('(max-width: 920px)');
    const sync = () => setIsDrawer(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  const visibleId = hoverId ?? (isDrawer ? slide.id : null);

  const measure = useCallback((id: string | null) => {
    if (!id) return;
    const el = itemRefs.current[id];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // Outside the drawer's own right edge, level with the slide row.
    const railRight = railRef.current?.getBoundingClientRect().right ?? rect.right;
    const top = Math.max(6, Math.min(rect.top + rect.height / 2 - 15, window.innerHeight - 36));
    const left = Math.max(6, Math.min(Math.max(rect.right + 6, railRight + 6), window.innerWidth - PALETTE_WIDTH - 6));
    setAnchor((prev) =>
      prev && prev.id === id && Math.abs(prev.top - top) < 0.5 && Math.abs(prev.left - left) < 0.5
        ? prev
        : { id, top, left },
    );
  }, []);

  useEffect(() => {
    measure(visibleId);
  }, [visibleId, deck.slides.length, drawerOpen, measure]);

  useEffect(() => {
    const onResize = () => measure(visibleId);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [visibleId, measure]);

  const drop = (targetId: string, index: number) => {
    if (dragId && dragId !== targetId) {
      moveSlideTo(dragId, index);
      onToast('슬라이드 순서를 옮겼습니다');
    }
    setDragId(null);
    setOverId(null);
  };

  const pick = (slideId: string) => {
    selectSlide(slideId);
    // The drawer is an overlay on a phone: picking a slide puts it away. The
    // fixed rail on a wide screen has nothing to fold.
    if (drawerOpen) onClose?.();
  };

  return (
    <aside className="rail" aria-label="슬라이드 덱 레일" data-testid="deck-rail" ref={railRef}>
      <div className="rail-head">
        <span className="rail-kicker">SLIDES</span>
        <b className="rail-count">{deck.slides.length}</b>
        <span className="rail-deck" title={deck.title}>{deck.title}</span>
        <button type="button" className="icon-btn small" onClick={addSlide} title="슬라이드 추가" aria-label="슬라이드 추가" data-testid="add-slide">
          <IconPlus size={16} />
        </button>
      </div>

      <ol
        className="rail-list"
        ref={listRef}
        onScroll={() => measure(visibleId)}
      >
        {deck.slides.map((item, index) => {
          const active = item.id === slide.id;
          const showPalette = visibleId === item.id && anchor?.id === item.id;
          return (
            <li
              key={item.id}
              ref={(node) => { itemRefs.current[item.id] = node; }}
              className={`rail-item${active ? ' active' : ''}${overId === item.id ? ' drop-target' : ''}`}
              draggable
              onMouseEnter={() => { setHoverId(item.id); measure(item.id); }}
              onMouseLeave={() => setHoverId((current) => (current === item.id ? null : current))}
              onDragStart={() => setDragId(item.id)}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              onDragOver={(event) => { event.preventDefault(); setOverId(item.id); }}
              onDrop={(event) => { event.preventDefault(); drop(item.id, index); }}
            >
              <button
                type="button"
                className="rail-card"
                onClick={() => pick(item.id)}
                aria-current={active ? 'true' : undefined}
                data-testid={`rail-slide-${index}`}
              >
                <span className="rail-no">{String(index + 1).padStart(2, '0')}</span>
                <span className="rail-text">
                  <b>{item.title || '제목 없는 슬라이드'}</b>
                  <small>{plainText(item.markdown, 54) || '비어 있는 슬라이드'}</small>
                </span>
              </button>

              <button
                type="button"
                className={`rail-status ${item.status}`}
                onClick={() => toggleStatus(item.id)}
                title={`${STATUS_LABEL[item.status]} — 눌러서 바꾸기`}
                aria-label={`학습 상태: ${STATUS_LABEL[item.status]}`}
                data-testid={`rail-status-${index}`}
              >
                {STATUS_SHORT[item.status]}
              </button>

              {showPalette && (
                <div
                  className="rail-actions"
                  role="group"
                  aria-label={`${index + 1}번 슬라이드 순서 · 복제 · 삭제`}
                  style={{ top: anchor.top, left: anchor.left }}
                  data-testid={`rail-actions-${index}`}
                >
                  <button type="button" onClick={() => moveSlide(item.id, -1)} disabled={index === 0} title="위로" aria-label="위로 이동">
                    <IconUp size={13} />
                  </button>
                  <button type="button" onClick={() => moveSlide(item.id, 1)} disabled={index === deck.slides.length - 1} title="아래로" aria-label="아래로 이동">
                    <IconDown size={13} />
                  </button>
                  <button type="button" onClick={() => duplicateSlide(item.id)} title="복제" aria-label="슬라이드 복제">
                    <IconCopy size={13} />
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => { deleteSlide(item.id); onToast('슬라이드를 삭제했습니다'); }}
                    disabled={deck.slides.length <= 1}
                    title={deck.slides.length <= 1 ? '마지막 슬라이드는 지울 수 없습니다' : '삭제'}
                    aria-label="슬라이드 삭제"
                  >
                    <IconTrash size={13} />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
