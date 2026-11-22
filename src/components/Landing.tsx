import { useEffect, useMemo, useRef, useState } from 'react';
import type { Deck, Theme } from '../types/study';
import { SAMPLE_DECK_ID } from '../lib/sample';
import { deckOverview, progressShares, updatedLabel } from '../lib/overview';
import {
  CATALOG_PAGE_SIZE, collectTags, filterDecks, pageCount, pageSlice, pageWindow,
} from '../lib/catalog';
import { normalizeTags } from '../lib/tags';
import {
  IconClose, IconDeck, IconFile, IconMoon, IconPlus, IconRight, IconSearch, IconSun,
  IconTag, IconUpload,
} from './Icons';
import { PortalMenu } from './PortalMenu';

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
 * browser as one card. Ten cards a page, with a live title · summary · tag
 * search and tag chips above them — the catalog stays usable at fifty decks.
 */
export function Landing({
  decks, activeDeckId, theme, onToggleTheme, onOpenDeck, onNewDeck, onImportMarkdown, onImportStudy,
}: LandingProps) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const dark = theme === 'dark';
  const active = decks.find((deck) => deck.id === activeDeckId) ?? decks[0];

  const tagCounts = useMemo(() => collectTags(decks), [decks]);
  const filtered = useMemo(() => filterDecks(decks, query, tag), [decks, query, tag]);
  const lastPage = pageCount(filtered.length);
  const currentPage = Math.min(page, lastPage);
  const visible = pageSlice(filtered, currentPage);
  const filtering = Boolean(query.trim()) || tag !== null;

  let slideTotal = 0;
  let doneTotal = 0;
  for (const deck of decks) {
    const overview = deckOverview(deck);
    slideTotal += overview.slides;
    doneTotal += overview.done;
  }
  const overall = slideTotal === 0 ? 0 : Math.round((doneTotal / slideTotal) * 100);

  // A search that shrinks the list below the current page must not leave the
  // catalog on an empty page.
  useEffect(() => {
    if (page > lastPage) setPage(lastPage);
  }, [page, lastPage]);

  const clearFilters = () => { setQuery(''); setTag(null); setPage(1); };
  const toTop = () => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });

  const rangeStart = filtered.length === 0 ? 0 : (currentPage - 1) * CATALOG_PAGE_SIZE + 1;
  const rangeEnd = Math.min(filtered.length, currentPage * CATALOG_PAGE_SIZE);

  return (
    <div className="landing-app">
      {/* The same 56px bar as the studio: the HD2Lab lockup, the theme toggle
          and the ⋮ portal menu every other HD2Lab app carries. */}
      <header className="topbar landing-top">
        <button
          type="button" className="brand" onClick={toTop}
          title="화면 맨 위로" aria-label="HD2Lab 홈 — 화면 맨 위로" data-testid="landing-brand"
        >
          <span className="brand-mark" aria-hidden><span className="mark" /></span>
          <span className="brand-name">HD2Lab</span>
          <span className="brand-div" aria-hidden />
          <span className="brand-app">SlideDeck</span>
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

          <PortalMenu onHome={toTop} />
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
                <span className="catalog-count" data-testid="deck-count">{filtered.length}</span>
              </h2>
              <span className="catalog-hint">카드를 누르면 그 강의가 열린 공부방으로 들어갑니다.</span>
            </div>

            {decks.length > 0 && (
              <div className="catalog-tools">
                <label className="catalog-search">
                  <IconSearch size={15} />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => { setQuery(event.target.value); setPage(1); }}
                    placeholder="제목 · 요약 · 태그로 검색"
                    aria-label="강의 검색"
                    data-testid="catalog-search"
                  />
                  {query && (
                    <button
                      type="button" className="search-clear"
                      onClick={() => { setQuery(''); setPage(1); }}
                      aria-label="검색어 지우기" title="검색어 지우기"
                    >
                      <IconClose size={13} />
                    </button>
                  )}
                </label>

                {tagCounts.length > 0 && (
                  <div className="tag-row" role="group" aria-label="태그 필터">
                    <button
                      type="button"
                      className={`tag-chip${tag === null ? ' on' : ''}`}
                      onClick={() => { setTag(null); setPage(1); }}
                      aria-pressed={tag === null}
                      data-testid="tag-all"
                    >
                      전체 <b>{decks.length}</b>
                    </button>
                    {tagCounts.map((entry) => (
                      <button
                        key={entry.tag}
                        type="button"
                        className={`tag-chip${tag === entry.tag ? ' on' : ''}`}
                        onClick={() => { setTag(entry.tag); setPage(1); }}
                        aria-pressed={tag === entry.tag}
                        data-testid={`tag-chip-${entry.tag}`}
                      >
                        <IconTag size={11} />{entry.tag} <b>{entry.count}</b>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {decks.length === 0 ? (
              <p className="catalog-empty">아직 강의가 없습니다. ‘새 강의 만들기’로 첫 강의를 시작해 보세요.</p>
            ) : filtered.length === 0 ? (
              <div className="catalog-empty-block" data-testid="catalog-no-result">
                <p className="catalog-empty">
                  {tag ? `‘${tag}’ 태그` : ''}{query.trim() ? ` ‘${query.trim()}’ 검색어` : ''}에 맞는 강의가 없습니다.
                </p>
                <button type="button" className="ghost-btn tiny" onClick={clearFilters} data-testid="catalog-reset">
                  검색 · 태그 초기화
                </button>
              </div>
            ) : (
              <>
                <ul className="deck-grid" data-testid="deck-grid">
                  {visible.map((deck) => {
                    const overview = deckOverview(deck);
                    const shares = progressShares(overview);
                    const isSample = deck.id === SAMPLE_DECK_ID;
                    const isActive = deck.id === active?.id;
                    const deckTags = normalizeTags(deck.tags);
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

                          {deckTags.length > 0 && (
                            <span className="deck-tags" data-testid={`deck-tags-${deck.id}`}>
                              {deckTags.map((item) => <span key={item} className="deck-tag-chip">{item}</span>)}
                            </span>
                          )}

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

                {lastPage > 1 && (
                  <nav className="catalog-pager" aria-label="강의 목록 페이지" data-testid="catalog-pager">
                    <span className="pager-info" data-testid="catalog-range">
                      {rangeStart}–{rangeEnd} / {filtered.length}
                    </span>
                    <button
                      type="button" className="pager-step"
                      onClick={() => setPage(Math.max(1, currentPage - 1))}
                      disabled={currentPage === 1}
                      data-testid="catalog-prev"
                    >이전</button>
                    <span className="pager-pages">
                      {pageWindow(currentPage, filtered.length).map((entry, index) =>
                        entry === '…' ? (
                          <span key={`gap-${index}`} className="pager-gap" aria-hidden>…</span>
                        ) : (
                          <button
                            key={entry}
                            type="button"
                            className={`pager-page${entry === currentPage ? ' on' : ''}`}
                            aria-current={entry === currentPage ? 'page' : undefined}
                            onClick={() => setPage(entry)}
                            data-testid={`catalog-page-${entry}`}
                          >{entry}</button>
                        ),
                      )}
                    </span>
                    <button
                      type="button" className="pager-step"
                      onClick={() => setPage(Math.min(lastPage, currentPage + 1))}
                      disabled={currentPage === lastPage}
                      data-testid="catalog-next"
                    >다음</button>
                  </nav>
                )}
              </>
            )}

            {filtering && filtered.length > 0 && (
              <p className="catalog-filter-note">
                {decks.length}개 중 {filtered.length}개 강의 · <button type="button" onClick={clearFilters} className="link-btn">필터 해제</button>
              </p>
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
