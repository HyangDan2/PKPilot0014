import { useEffect, useRef, useState } from 'react';
import type { StudioApi } from '../store/studio';
import {
  IconDots, IconDownload, IconEdit, IconExternal, IconHelp, IconHome, IconMoon, IconPrinter, IconSun,
  IconUpload,
} from './Icons';

interface Props {
  studio: StudioApi;
  onOpenHelp: () => void;
  onOpenMarkdown: () => void;
  /** Back to the landing page (the lecture catalog). */
  onGoHome: () => void;
  onPrint: () => void;
  onOpenExport: () => void;
  onImportStudy: () => void;
}

/**
 * The 56px title bar: the HD2Lab lockup on the left, then exactly three
 * controls — 가져오기, 테마, ⋮ — so the menu button can never be pushed off a
 * 390px phone. The deck switcher moved down to the stage bar.
 */
export function Header({
  studio, onOpenHelp, onOpenMarkdown, onGoHome, onPrint, onOpenExport, onImportStudy,
}: Props) {
  const { settings, setSettings } = studio;
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const run = (fn: () => void) => () => { setMenuOpen(false); fn(); };
  const dark = settings.theme === 'dark';

  return (
    <header className="topbar">
      <button
        type="button" className="brand" onClick={onGoHome}
        title="강의 목록으로" aria-label="HD2Lab 홈 — 강의 목록으로" data-testid="brand-home"
      >
        <span className="brand-mark" aria-hidden><span className="mark" /></span>
        <span className="brand-name">HD2Lab</span>
        <span className="brand-div" aria-hidden />
        <span className="brand-app">SlideDeck</span>
        <span className="brand-badge">STUDY</span>
      </button>

      <div className="topbar-actions" ref={wrapRef}>
        <button
          type="button" className="top-btn" onClick={onOpenMarkdown}
          title=".md 파일 열기 / 붙여넣기" aria-label="가져오기 — .md 파일 열기" data-testid="header-open-md"
        >
          <IconUpload size={15} /><span>가져오기</span>
        </button>

        <button
          type="button" className="icon-btn"
          onClick={() => setSettings({ theme: dark ? 'light' : 'dark' })}
          aria-label={dark ? '라이트 테마로' : '다크 테마로'}
          title={dark ? 'Soft Iris (라이트)로' : 'Navy & Lavender (다크)로'}
          data-testid="theme-toggle"
        >
          {dark ? <IconSun size={17} /> : <IconMoon size={17} />}
        </button>

        <div className="menu-wrap">
          <button
            type="button"
            className={`icon-btn menu-btn${menuOpen ? ' open' : ''}`}
            onClick={() => setMenuOpen((value) => !value)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="더 보기 — 내보내기 · 백업 · 포털"
            title="더 보기"
            data-testid="menu-button"
          >
            <IconDots size={18} />
          </button>

          {menuOpen && (
            <div className="popover menu-pop" role="menu" data-testid="nav-menu">
              <p className="pop-head">HOME</p>
              <button
                type="button" role="menuitem" className="pop-item"
                onClick={run(onGoHome)} data-testid="menu-home"
              >
                <span className="pop-ic"><IconHome size={14} /></span>
                <span className="pop-text"><b>홈 · 강의 목록</b><small>랜딩 화면으로 돌아가기</small></span>
                <span className="pop-key">HOME</span>
              </button>
              <span className="pop-sep" />
              <button
                type="button" role="menuitem" className="pop-item help-first"
                onClick={run(onOpenHelp)} data-testid="menu-help"
              >
                <span className="pop-ic"><IconHelp size={14} /></span>
                <span className="pop-text"><b>사용법</b><small>가이드 · 단축키 · 마크다운 문법</small></span>
                <span className="pop-key">?</span>
              </button>
              <span className="pop-sep" />
              <p className="pop-head">EXPORT</p>
              <button type="button" role="menuitem" className="pop-item" onClick={run(onPrint)}>
                <span className="pop-ic"><IconPrinter size={14} /></span>
                <span className="pop-text"><b>학습지 PDF 인쇄</b><small>슬라이드 + 슬라이드 메모</small></span>
                <span className="pop-key">PRINT</span>
              </button>
              <button type="button" role="menuitem" className="pop-item" onClick={run(onOpenExport)} data-testid="menu-export">
                <span className="pop-ic"><IconDownload size={14} /></span>
                <span className="pop-text"><b>내보내기</b><small>슬라이드 · 메모 · ZIP 번들 · 전체 백업</small></span>
                <span className="pop-key">EXPORT</span>
              </button>
              <button type="button" role="menuitem" className="pop-item" onClick={run(onImportStudy)} data-testid="menu-restore">
                <span className="pop-ic"><IconUpload size={14} /></span>
                <span className="pop-text"><b>.study.json 복원</b><small>백업 파일을 통째로 되돌리기</small></span>
                <span className="pop-key">RESTORE</span>
              </button>

              <span className="pop-sep" />
              <p className="pop-head">WORKSPACE</p>
              <button type="button" role="menuitem" className="pop-item" onClick={run(onOpenMarkdown)}>
                <span className="pop-ic"><IconEdit size={14} /></span>
                <span className="pop-text"><b>.md 열기 · 붙여넣기</b><small>현재 분할 기준으로 새 덱 만들기</small></span>
              </button>
              <button type="button" role="menuitem" className="pop-item" onClick={run(() => setSettings({ theme: dark ? 'light' : 'dark' }))}>
                <span className="pop-ic">{dark ? <IconSun size={14} /> : <IconMoon size={14} />}</span>
                <span className="pop-text"><b>테마 전환</b><small>{dark ? 'Soft Iris (라이트)' : 'Navy & Lavender (다크)'}</small></span>
              </button>

              <span className="pop-sep" />
              <p className="pop-head">NAVIGATION</p>
              <a className="pop-item" role="menuitem" href="https://hyangdan2.github.io/" target="_blank" rel="noopener noreferrer">
                <span className="pop-ic"><IconExternal size={14} /></span>
                <span className="pop-text"><b>HD2Lab Web-HQ</b><small>Main Portal</small></span>
              </a>
              <a className="pop-item" role="menuitem" href="https://hyangdan2.github.io/ApplicationHub/" target="_blank" rel="noopener noreferrer">
                <span className="pop-ic"><IconExternal size={14} /></span>
                <span className="pop-text"><b>ApplicationHub</b><small>Apps Catalog</small></span>
              </a>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
