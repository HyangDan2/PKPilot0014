import { useEffect, useRef, useState } from 'react';
import type { StudioApi } from '../store/studio';
import {
  IconCheck, IconDeck, IconDots, IconDownload, IconEdit, IconExternal, IconHelp,
  IconMoon, IconPresent, IconPrinter, IconSpark, IconSun, IconTrash, IconUpload,
} from './Icons';

interface Props {
  studio: StudioApi;
  onOpenHelp: () => void;
  onOpenMarkdown: () => void;
  onPresent: () => void;
  onPrint: () => void;
  onOpenExport: () => void;
  onImportStudy: () => void;
  onRestoreSample: () => void;
  onToast: (message: string) => void;
}

export function Header({
  studio, onOpenHelp, onOpenMarkdown, onPresent, onPrint, onOpenExport, onImportStudy,
  onRestoreSample, onToast,
}: Props) {
  const { decks, deck, settings, setSettings, selectDeck, createNewDeck, deleteDeck } = studio;
  const [deckOpen, setDeckOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setDeckOpen(false);
        setMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setDeckOpen(false); setMenuOpen(false); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const run = (fn: () => void) => () => { setDeckOpen(false); setMenuOpen(false); fn(); };
  const dark = settings.theme === 'dark';

  return (
    <header className="topbar">
      <button type="button" className="brand" onClick={() => setDeckOpen((value) => !value)} title="덱 선택">
        <span className="brand-mark" aria-hidden><span className="mark" /></span>
        <span className="brand-name">HD2Lab</span>
        <span className="brand-div" aria-hidden />
        <span className="brand-app">Sága Glitra</span>
        <span className="brand-badge">STUDY</span>
      </button>

      <div className="topbar-actions" ref={wrapRef}>
        <div className="deck-switch">
          <button
            type="button"
            className={`deck-btn${deckOpen ? ' open' : ''}`}
            onClick={() => { setDeckOpen((value) => !value); setMenuOpen(false); }}
            aria-haspopup="menu"
            aria-expanded={deckOpen}
            data-testid="deck-button"
          >
            <IconDeck size={15} />
            <span className="deck-btn-name">{deck.title}</span>
            <b className="deck-btn-count">{deck.slides.length}</b>
          </button>

          {deckOpen && (
            <div className="popover deck-pop" role="menu" data-testid="deck-menu">
              <p className="pop-head">DECKS</p>
              {decks.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  className={`pop-item${item.id === deck.id ? ' current' : ''}`}
                  onClick={run(() => selectDeck(item.id))}
                >
                  <span className="pop-ic">{item.id === deck.id ? <IconCheck size={14} /> : <IconDeck size={14} />}</span>
                  <span className="pop-text"><b>{item.title}</b><small>{item.slides.length}장 · {new Date(item.updatedAt).toLocaleDateString('ko-KR')}</small></span>
                </button>
              ))}
              <span className="pop-sep" />
              <div className="pop-new">
                <input
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="새 덱 이름"
                  aria-label="새 덱 이름"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      createNewDeck(newName.trim() || '새 덱');
                      setNewName('');
                      setDeckOpen(false);
                    }
                  }}
                />
                <button
                  type="button"
                  className="primary-btn tiny"
                  onClick={() => { createNewDeck(newName.trim() || '새 덱'); setNewName(''); setDeckOpen(false); }}
                >
                  만들기
                </button>
              </div>
              <button type="button" role="menuitem" className="pop-item" onClick={run(onRestoreSample)}>
                <span className="pop-ic"><IconSpark size={14} /></span>
                <span className="pop-text"><b>샘플 덱 복원</b><small>Sága Glitra 사용법 5장</small></span>
              </button>
              <button
                type="button" role="menuitem" className="pop-item danger"
                onClick={run(() => {
                  if (window.confirm(`‘${deck.title}’ 덱을 삭제할까요? 이 덱의 필기도 함께 지워집니다.`)) {
                    deleteDeck(deck.id);
                    onToast('덱을 삭제했습니다');
                  }
                })}
              >
                <span className="pop-ic"><IconTrash size={14} /></span>
                <span className="pop-text"><b>이 덱 삭제</b><small>필기 스트로크도 함께 삭제</small></span>
              </button>
            </div>
          )}
        </div>

        <button
          type="button" className="top-btn" onClick={onOpenMarkdown}
          title=".md 파일 열기 / 붙여넣기" aria-label="가져오기 — .md 파일 열기" data-testid="header-open-md"
        >
          <IconUpload size={15} /><span>가져오기</span>
        </button>

        <button
          type="button" className="top-btn present-top" onClick={onPresent}
          title="발표 모드 (F5)" aria-label="발표 모드" data-testid="header-present"
        >
          <IconPresent size={15} /><span>발표 모드</span><kbd>F5</kbd>
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

        <span className="top-div" aria-hidden />

        <a className="ext-link" href="https://hyangdan2.github.io/" target="_blank" rel="noopener noreferrer">
          Web-HQ <IconExternal size={12} />
        </a>
        <a className="ext-link" href="https://hyangdan2.github.io/ApplicationHub/" target="_blank" rel="noopener noreferrer">
          ApplicationHub <IconExternal size={12} />
        </a>

        <div className="menu-wrap">
          <button
            type="button"
            className={`icon-btn menu-btn${menuOpen ? ' open' : ''}`}
            onClick={() => { setMenuOpen((value) => !value); setDeckOpen(false); }}
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
