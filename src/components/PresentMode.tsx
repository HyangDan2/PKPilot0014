import { useEffect, useRef, useState } from 'react';
import type { StudioApi } from '../store/studio';
import { RenderedMarkdown } from './RenderedMarkdown';
import { STATUS_LABEL } from '../types/study';
import { IconClose, IconEye, IconEyeOff, IconLeft, IconNote, IconRight } from './Icons';

interface Props {
  studio: StudioApi;
  onClose: () => void;
}

export function PresentMode({ studio, onClose }: Props) {
  const { deck, settings, setSettings } = studio;
  const [index, setIndex] = useState(() =>
    Math.max(0, deck.slides.findIndex((slide) => slide.id === studio.slide.id)));
  const [showNote, setShowNote] = useState(false);
  const touchStart = useRef<number | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);

  const slide = deck.slides[index];

  const go = (delta: number) => {
    setIndex((value) => Math.min(deck.slides.length - 1, Math.max(0, value + delta)));
  };

  useEffect(() => {
    const shell = shellRef.current;
    if (shell?.requestFullscreen) shell.requestFullscreen().catch(() => undefined);
    return () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        go(1);
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        go(-1);
      } else if (event.key === 'Escape') {
        onClose();
      } else if (event.key.toLowerCase() === 'n') {
        setShowNote((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deck.slides.length, onClose]);

  return (
    <div className="present" ref={shellRef} role="dialog" aria-modal="true" aria-label="발표 모드" data-testid="present-mode">
      <header className="present-bar">
        <span className="present-deck">{deck.title}</span>
        <span className="present-count">{index + 1} / {deck.slides.length}</span>
        <div className="present-tools">
          <button type="button" onClick={() => setSettings({ maskAll: !settings.maskAll })} title="가림막 전체 토글">
            {settings.maskAll ? <IconEye size={16} /> : <IconEyeOff size={16} />}
            <span>가림막</span>
          </button>
          <button type="button" onClick={() => setShowNote((value) => !value)} className={showNote ? 'on' : ''} title="현재 슬라이드 메모 (N)">
            <IconNote size={16} /><span>메모</span>
          </button>
          <button type="button" onClick={onClose} title="나가기 (Esc)">
            <IconClose size={16} /><span>Esc</span>
          </button>
        </div>
      </header>

      <div
        className="present-stage"
        onPointerDown={(event) => { touchStart.current = event.clientX; }}
        onPointerUp={(event) => {
          if (touchStart.current === null) return;
          const delta = event.clientX - touchStart.current;
          if (Math.abs(delta) > 48) go(delta < 0 ? 1 : -1);
          touchStart.current = null;
        }}
      >
        <button type="button" className="present-nav left" onClick={() => go(-1)} disabled={index === 0} aria-label="이전 슬라이드">
          <IconLeft size={22} />
        </button>

        <article className="present-card">
          <div className="present-head">
            <span className="slide-no">{String(index + 1).padStart(2, '0')}</span>
            <h2>{slide.title}</h2>
            <span className={`status-pill ${slide.status}`}>{STATUS_LABEL[slide.status]}</span>
          </div>
          <div className="present-body">
            <RenderedMarkdown
              markdown={slide.markdown}
              maskAll={settings.maskAll}
              theme={settings.theme}
              className="slide-md present-md"
            />
          </div>
        </article>

        <button type="button" className="present-nav right" onClick={() => go(1)} disabled={index === deck.slides.length - 1} aria-label="다음 슬라이드">
          <IconRight size={22} />
        </button>
      </div>

      {showNote && (
        <aside className="present-note">
          <header>
            <b>발표자 메모</b>
            <small>{slide.title}</small>
          </header>
          <div className="present-note-body">
            {slide.note.trim() ? (
              <RenderedMarkdown markdown={slide.note} maskAll={settings.maskAll} theme={settings.theme} className="note-md" />
            ) : (
              <p className="empty-note">이 슬라이드에는 메모가 없습니다.</p>
            )}
          </div>
        </aside>
      )}

      <footer className="present-foot">
        <span>← → 넘기기 · N 메모 · Esc 나가기</span>
        <div className="present-progress" aria-hidden>
          {deck.slides.map((item, dot) => (
            <span key={item.id} className={dot <= index ? 'on' : ''} />
          ))}
        </div>
      </footer>
    </div>
  );
}
