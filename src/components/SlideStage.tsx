import { useMemo } from 'react';
import type { StudioApi } from '../store/studio';
import type { InkPoint } from '../types/study';
import { INK_COLORS, STATUS_LABEL } from '../types/study';
import { maskCount } from '../lib/mask';
import { RenderedMarkdown } from './RenderedMarkdown';
import { InkLayer } from './InkLayer';
import {
  IconEdit, IconEye, IconEyeOff, IconHighlighter, IconPen, IconPresent, IconSplit, IconUndo, IconTrash,
} from './Icons';

interface Props {
  studio: StudioApi;
  onPresent: () => void;
  onToast: (message: string) => void;
}

export function SlideStage({ studio, onPresent, onToast }: Props) {
  const { deck, slide, settings, setSettings, updateSlide, toggleStatus, addStroke, undoStroke } = studio;
  const index = deck.slides.findIndex((item) => item.id === slide.id);
  const masks = useMemo(() => maskCount(slide.markdown), [slide.markdown]);

  const setView = (viewMode: 'view' | 'edit' | 'split') => setSettings({ viewMode });

  const togglePen = () => {
    const next = !settings.penOn;
    setSettings({ penOn: next });
    onToast(next ? '필기 모드 — 슬라이드 위에 바로 그으세요' : '필기 모드 꺼짐');
  };

  return (
    <section className="stage" aria-label="슬라이드 스테이지">
      <div className="stage-bar">
        <div className="seg" role="tablist" aria-label="보기 모드">
          <button
            type="button" role="tab" aria-selected={settings.viewMode === 'view'}
            className={settings.viewMode === 'view' ? 'on' : ''}
            onClick={() => setView('view')}
          >
            <IconEye size={15} /><span>보기</span>
          </button>
          <button
            type="button" role="tab" aria-selected={settings.viewMode === 'edit'}
            className={settings.viewMode === 'edit' ? 'on' : ''}
            onClick={() => setView('edit')}
          >
            <IconEdit size={15} /><span>편집</span>
          </button>
          <button
            type="button" role="tab" aria-selected={settings.viewMode === 'split'}
            className={`split-only${settings.viewMode === 'split' ? ' on' : ''}`}
            onClick={() => setView('split')}
          >
            <IconSplit size={15} /><span>분할</span>
          </button>
        </div>

        <div className="stage-tools">
          <button
            type="button"
            className={`tool-btn${settings.maskAll ? '' : ' on'}`}
            onClick={() => setSettings({ maskAll: !settings.maskAll })}
            title="가림막 전체 숨김 / 공개"
            aria-pressed={!settings.maskAll}
            data-testid="mask-all"
          >
            {settings.maskAll ? <IconEye size={15} /> : <IconEyeOff size={15} />}
            <span>{settings.maskAll ? '가림막 전체 공개' : '가림막 전체 숨김'}</span>
            {masks > 0 && <b className="count">{masks}</b>}
          </button>

          <div className={`ink-tools${settings.penOn ? ' on' : ''}`}>
            <button
              type="button"
              className={`tool-btn ink-toggle${settings.penOn ? ' on' : ''}`}
              onClick={togglePen}
              aria-pressed={settings.penOn}
              title="형광펜 / 펜 켜기"
              data-testid="pen-toggle"
            >
              <IconHighlighter size={15} /><span>필기</span>
            </button>
            {settings.penOn && (
              <>
                <div className="ink-tool-pick" role="group" aria-label="필기 도구">
                  <button
                    type="button" className={settings.tool === 'highlighter' ? 'on' : ''}
                    onClick={() => setSettings({ tool: 'highlighter', color: INK_COLORS.highlighter[0].value })}
                    title="형광펜"
                  >
                    <IconHighlighter size={14} />
                  </button>
                  <button
                    type="button" className={settings.tool === 'pen' ? 'on' : ''}
                    onClick={() => setSettings({ tool: 'pen', color: INK_COLORS.pen[0].value })}
                    title="펜"
                  >
                    <IconPen size={14} />
                  </button>
                </div>
                <div className="ink-palette" role="group" aria-label="필기 색">
                  {INK_COLORS[settings.tool].map((swatch) => (
                    <button
                      key={swatch.value}
                      type="button"
                      className={settings.color === swatch.value ? 'on' : ''}
                      style={{ background: swatch.value }}
                      onClick={() => setSettings({ color: swatch.value })}
                      aria-label={`${swatch.name} 색`}
                      title={swatch.name}
                    />
                  ))}
                </div>
                <button type="button" className="icon-btn small" onClick={undoStroke} title="한 획 되돌리기" aria-label="한 획 되돌리기">
                  <IconUndo size={15} />
                </button>
                <button
                  type="button" className="icon-btn small" title="이 슬라이드 필기 지우기" aria-label="이 슬라이드 필기 지우기"
                  onClick={() => { if (studio.slideStrokes.length) { studio.clearInk(); onToast('이 슬라이드 필기를 지웠습니다'); } }}
                >
                  <IconTrash size={15} />
                </button>
              </>
            )}
          </div>

          <button type="button" className="tool-btn present-btn" onClick={onPresent} data-testid="present-button">
            <IconPresent size={15} /><span>발표 모드</span><kbd>F5</kbd>
          </button>
        </div>
      </div>

      <div className="stage-scroll">
        <div className={`slide-card ${settings.viewMode}`} data-testid="slide-card">
          <header className="slide-head">
            <span className="slide-no">{String(index + 1).padStart(2, '0')}</span>
            <h2 className="slide-title">{slide.title || '제목 없는 슬라이드'}</h2>
            <button
              type="button"
              className={`status-pill ${slide.status}`}
              onClick={() => toggleStatus()}
              title="눌러서 학습 상태 바꾸기"
            >
              {STATUS_LABEL[slide.status]}
            </button>
          </header>

          {settings.viewMode === 'view' && (
            <div className="slide-body">
              <RenderedMarkdown
                markdown={slide.markdown}
                maskAll={settings.maskAll}
                theme={settings.theme}
                className="slide-md"
                onCopy={() => onToast('코드를 복사했습니다')}
              />
            </div>
          )}

          {settings.viewMode === 'edit' && (
            <div className="slide-editor">
              <input
                className="slide-title-input"
                value={slide.title}
                onChange={(event) => updateSlide({ title: event.target.value })}
                aria-label="슬라이드 제목"
                placeholder="슬라이드 제목"
              />
              <textarea
                className="md-input"
                value={slide.markdown}
                onChange={(event) => updateSlide({ markdown: event.target.value })}
                spellCheck={false}
                aria-label="슬라이드 마크다운"
                placeholder={'## 제목\n\n마크다운으로 적으세요. ==가림막==, $수식$, ```mermaid 도 됩니다.'}
              />
            </div>
          )}

          {settings.viewMode === 'split' && (
            <div className="slide-split">
              <div className="slide-editor">
                <textarea
                  className="md-input"
                  value={slide.markdown}
                  onChange={(event) => updateSlide({ markdown: event.target.value })}
                  spellCheck={false}
                  aria-label="슬라이드 마크다운 (분할 편집)"
                />
              </div>
              <div className="slide-body preview">
                <RenderedMarkdown
                  markdown={slide.markdown}
                  maskAll={settings.maskAll}
                  theme={settings.theme}
                  className="slide-md"
                />
              </div>
            </div>
          )}

          {settings.viewMode === 'view' && (
            <InkLayer
              strokes={studio.slideStrokes}
              enabled={settings.penOn}
              tool={settings.tool}
              color={settings.color}
              onCommit={(stroke) => {
                const ink: InkPoint[] = stroke.points;
                if (ink.length) addStroke(stroke);
              }}
            />
          )}

          <footer className="slide-foot">
            <span className="foot-deck">{deck.title}</span>
            <span className="foot-meta">
              {deck.slides.length}장 · {settings.maskAll ? '가림막 공개' : '가림막 숨김'}
              {settings.penOn ? ' · 필기 ON' : ''}
            </span>
          </footer>
        </div>
      </div>
    </section>
  );
}
