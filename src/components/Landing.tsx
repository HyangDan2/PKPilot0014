import { useRef } from 'react';
import type { Deck, Theme } from '../types/study';
import { SAMPLE_DECK_ID } from '../lib/sample';
import { deckOverview, progressShares, updatedLabel } from '../lib/overview';
import {
  IconDeck, IconExternal, IconFile, IconMoon, IconPlus, IconRight, IconSun, IconUpload,
} from './Icons';

interface LandingProps {
  decks: Deck[];
  activeDeckId: string;
  theme: Theme;
  onToggleTheme: () => void;
  /** Enters the studio with this deck open. */
  onOpenDeck: (deckId: string) => void;
  onNewDeck: () => void;
  onImportMarkdown: () => void;
  onImportStudy: () => void;
}

function summaryLine(deck: Deck): string {
  const text = deck.summary.replace(/==([^=]*)==/g, '$1').trim().replace(/\s+/g, ' ');
  if (!text) return `슬라이드 ${deck.slides.length}장으로 이루어진 강의입니다.`;
  return text.length > 86 ? `${text.slice(0, 86).trimEnd()}…` : text;
}

/**
 * The first screen: the HD2Lab landing, and every lecture saved in this
 * browser as one card. The studio stays one click away — a card opens its deck,
 * 이어서 공부하기 opens the most recent one.
 */
export function Landing({
  decks, activeDeckId, theme, onToggleTheme, onOpenDeck, onNewDeck, onImportMarkdown, onImportStudy,
}: LandingProps) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const dark = theme === 'dark';
  const active = decks.find((deck) => deck.id === activeDeckId) ?? decks[0];

  let slideTotal = 0;
  let doneTotal = 0;
  for (const deck of decks) {
    const overview = deckOverview(deck);
    slideTotal += overview.slides;
    doneTotal += overview.done;
  }
  const overall = slideTotal === 0 ? 0 : Math.round((doneTotal / slideTotal) * 100);

  const toTop = () => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <div className="landing-app">
      {/* The same 56px bar as the studio, so the landing never loses the
          Web-HQ lockup or the way back to the other HD2Lab apps. */}
      <header className="topbar landing-top">
        <button
          type="button" className="brand" onClick={toTop}
          title="화면 맨 위로" aria-label="HD2Lab 홈 — 화면 맨 위로" data-testid="landing-brand"
        >
          <span className="brand-mark" aria-hidden><span className="mark" /></span>
          <span className="brand-name">HD2Lab</span>
          <span className="brand-div" aria-hidden />
          <span className="brand-app">Sága Glitra</span>
          <span className="brand-badge">STUDY</span>
        </button>

        <div className="topbar-actions">
          <button
            type="button" className="icon-btn"
            onClick={onToggleTheme}
            aria-label={dark ? '라이트 테마로' : '다크 테마로'}
            title={dark ? 'Soft Iris (라이트)로' : 'Navy & Lavender (다크)로'}
            data-testid="landing-theme-toggle"
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
        </div>
      </header>

      <main className="landing" data-testid="landing" ref={scrollRef}>
        <div className="landing-inner">
          <section className="hero">
            <p className="hero-eyebrow"><span className="hero-dot" aria-hidden />HD2Lab · Study Room</p>
            <h1 className="hero-title">읽고, 적고, 가르치는<br />나만의 공부방</h1>
            <p className="hero-lead">
              마크다운으로 만든 강의를 한 장씩 넘기며, 슬라이드마다 1:1로 붙은 노트에 정리합니다.
              형광펜과 가림막, 집중 타이머까지 — 모든 강의는 이 브라우저에만 저장됩니다.
            </p>

            <ul className="hero-stats">
              <li><b>{decks.length}</b><span>강의</span></li>
              <li><b>{slideTotal}</b><span>슬라이드</span></li>
              <li><b>{overall}%</b><span>이해 완료</span></li>
            </ul>

            <div className="hero-actions">
              <button
                type="button" className="primary-btn hero-cta"
                onClick={() => active && onOpenDeck(active.id)}
                disabled={!active}
                data-testid="landing-continue"
              >
                <IconRight size={15} />
                이어서 공부하기
              </button>
              <button type="button" className="ghost-btn" onClick={onNewDeck} data-testid="landing-new-deck">
                <IconPlus size={15} />
                새 강의 만들기
              </button>
              <button type="button" className="ghost-btn" onClick={onImportMarkdown} data-testid="landing-import-md">
                <IconUpload size={15} />
                .md 가져오기
              </button>
              <button type="button" className="ghost-btn" onClick={onImportStudy} data-testid="landing-restore-study">
                <IconFile size={15} />
                .study.json 복원
              </button>
            </div>
            {active && <p className="hero-recent">최근 강의 · <b>{active.title}</b></p>}
          </section>

          <section className="catalog" aria-labelledby="catalog-title">
            <div className="catalog-head">
              <h2 id="catalog-title">
                <IconDeck size={15} />
                강의 라이브러리
                <span className="catalog-count" data-testid="deck-count">{decks.length}</span>
              </h2>
              <span className="catalog-hint">카드를 누르면 그 강의가 열린 공부방으로 들어갑니다.</span>
            </div>

            {decks.length === 0 ? (
              <p className="catalog-empty">아직 강의가 없습니다. ‘새 강의 만들기’로 첫 강의를 시작해 보세요.</p>
            ) : (
              <ul className="deck-grid">
                {decks.map((deck) => {
                  const overview = deckOverview(deck);
                  const shares = progressShares(overview);
                  const isSample = deck.id === SAMPLE_DECK_ID;
                  const isActive = deck.id === active?.id;
                  return (
                    <li key={deck.id}>
                      <button
                        type="button"
                        className={`deck-card${isActive ? ' is-active' : ''}`}
                        onClick={() => onOpenDeck(deck.id)}
                        data-testid={`deck-card-${deck.id}`}
                        aria-label={`${deck.title} — 슬라이드 ${overview.slides}장, 학습 진행률 ${overview.progress}%, 이어서 공부하기`}
                      >
                        <span className="deck-card-top">
                          <span className={`deck-tag${isSample ? ' sample' : ''}`}>{isSample ? 'SAMPLE' : 'STUDY'}</span>
                          <span className="deck-date">{updatedLabel(deck.updatedAt)} 수정</span>
                        </span>

                        <span className="deck-title">{deck.title}</span>
                        <span className="deck-sub">{summaryLine(deck)}</span>

                        <span
                          className="deck-progress"
                          role="img"
                          aria-label={`학습 진행률 ${overview.progress}% — 이해 완료 ${overview.done}장, 복습 필요 ${overview.review}장, 미학습 ${overview.unlearned}장`}
                        >
                          <span className="deck-track" aria-hidden>
                            <i className="is-done" style={{ width: `${shares.done}%` }} />
                            <i className="is-review" style={{ width: `${shares.review}%` }} />
                          </span>
                          <b>{overview.progress}%</b>
                        </span>

                        <span className="deck-meta">
                          <span>슬라이드 {overview.slides}장</span>
                          <span className="meta-dot" aria-hidden />
                          <span>메모 {overview.notes}장</span>
                          <span className="meta-dot" aria-hidden />
                          <span>이해 완료 {overview.done} · 복습 {overview.review}</span>
                        </span>

                        <span className="deck-foot">
                          <span className="deck-cta">이어서 공부하기 <IconRight size={14} /></span>
                          {isActive && <span className="deck-current">최근 강의</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <p className="land-note">
            모든 강의와 필기는 이 브라우저의 IndexedDB에만 저장됩니다 — 서버도, 업로드도 없습니다.
            다른 기기로 옮길 때는 공부방의 <b>⋮ → 내보내기 → 전체 백업(.study.json)</b>을 사용해 주세요.
          </p>
        </div>
      </main>
    </div>
  );
}
