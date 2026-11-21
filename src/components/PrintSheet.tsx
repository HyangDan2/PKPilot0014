import type { StudioApi } from '../store/studio';
import { RenderedMarkdown } from './RenderedMarkdown';
import { STATUS_LABEL } from '../types/study';

/**
 * The study sheet: every slide with the note that belongs to it, laid out for
 * `@media print` so it becomes a clean PDF. Hidden on screen.
 */
export function PrintSheet({ studio }: { studio: StudioApi }) {
  const { deck } = studio;
  return (
    <section className="print-sheet" aria-hidden="true">
      <header className="print-head">
        <div>
          <p className="print-kicker">HD2LAB · SÁGA GLITRA · STUDY SHEET</p>
          <h1>{deck.title}</h1>
          <p className="print-meta">
            {deck.slides.length}장 · {new Date().toLocaleDateString('ko-KR')} · hyangdan2.github.io/PKPilot0014
          </p>
        </div>
        <span className="print-mark">SG</span>
      </header>

      {deck.summary.trim() && (
        <article className="print-block print-summary">
          <h3>덱 전체 요약</h3>
          <RenderedMarkdown markdown={deck.summary} maskAll theme="light" className="note-md print-md" />
        </article>
      )}

      {deck.slides.map((slide, index) => (
        <article className="print-block" key={slide.id}>
          <header className="print-slide-head">
            <span className="print-no">{String(index + 1).padStart(2, '0')}</span>
            <h2>{slide.title}</h2>
            <span className="print-status">{STATUS_LABEL[slide.status]}</span>
          </header>
          <div className="print-cols">
            <div className="print-slide">
              <RenderedMarkdown markdown={slide.markdown} maskAll theme="light" className="slide-md print-md" />
            </div>
            <div className="print-note">
              <p className="print-note-label">노트</p>
              {slide.note.trim()
                ? <RenderedMarkdown markdown={slide.note} maskAll theme="light" className="note-md print-md" />
                : <p className="print-empty">노트 없음</p>}
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}
