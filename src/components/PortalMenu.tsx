import { useEffect, useRef, useState } from 'react';
import { IconApps, IconCode, IconDeck, IconDots, IconExternal, IconHome } from './Icons';

interface PortalMenuProps {
  /** Back to the top of the lecture catalog — the landing's own home. */
  onHome: () => void;
}

/**
 * The ⋮ menu every HD2Lab title bar carries: this app's home and the way back
 * to the portal, the app catalog and the source. Same order and shape as
 * CodePlayground's, so the top bar reads the same across the apps.
 */
export function PortalMenu({ onHome }: PortalMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="portal" ref={ref}>
      <button
        type="button"
        className={`icon-btn${open ? ' on' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="메뉴 — 강의 목록 · 포털 · 저장소"
        title="더 보기"
        onClick={() => setOpen((value) => !value)}
        data-testid="portal-menu"
      >
        <IconDots size={18} />
      </button>
      {open && (
        <div className="portal-panel" role="menu" aria-label="메뉴" data-testid="portal-panel">
          <p className="portal-head">HD2LAB</p>
          <button
            type="button" className="portal-item" role="menuitem"
            onClick={() => { onHome(); setOpen(false); }}
            data-testid="portal-home"
          >
            <span className="portal-ic"><IconDeck size={15} /></span>
            <span className="portal-text"><b>홈 · 강의 목록</b><small>화면 맨 위로</small></span>
          </button>
          <div className="portal-divider" role="separator" />
          <a
            className="portal-item" role="menuitem"
            href="https://hyangdan2.github.io/" target="_blank" rel="noopener noreferrer"
          >
            <span className="portal-ic"><IconHome size={15} /></span>
            <span className="portal-text"><b>HD2Lab Web-HQ</b><small>Main Portal</small></span>
            <IconExternal size={13} />
          </a>
          <a
            className="portal-item" role="menuitem"
            href="https://hyangdan2.github.io/ApplicationHub/" target="_blank" rel="noopener noreferrer"
          >
            <span className="portal-ic"><IconApps size={15} /></span>
            <span className="portal-text"><b>ApplicationHub</b><small>앱 카탈로그</small></span>
            <IconExternal size={13} />
          </a>
          <a
            className="portal-item" role="menuitem"
            href="https://github.com/HyangDan2/PKPilot0014" target="_blank" rel="noopener noreferrer"
          >
            <span className="portal-ic"><IconCode size={15} /></span>
            <span className="portal-text"><b>GitHub 저장소</b><small>소스 코드 보기</small></span>
            <IconExternal size={13} />
          </a>
        </div>
      )}
    </div>
  );
}
