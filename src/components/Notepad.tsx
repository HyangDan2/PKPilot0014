import { useState } from 'react';
import type { StudioApi } from '../store/studio';
import { RenderedMarkdown } from './RenderedMarkdown';
import { FocusTimer } from './FocusTimer';
import { IconDown, IconEdit, IconEye, IconNote } from './Icons';

interface Props {
  studio: StudioApi;
  onToast: (message: string) => void;
}

export function Notepad({ studio, onToast }: Props) {
  const { deck, slide, settings, setSettings, updateSlide, setSummary } = studio;
  const [mode, setMode] = useState<'edit' | 'preview'>('preview');
  // On a phone the notepad is a bottom drawer; a slim bar keeps the slide big.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const deckTab = settings.noteTab === 'deck';
  const value = deckTab ? deck.summary : slide.note;
  // A note that already has words opens as reading text; an empty one opens as
  // the editor, so the first tap after landing can start typing.
  const editing = !value.trim() || mode === 'edit';
  const position = deck.slides.findIndex((item) => item.id === slide.id) + 1;

  const write = (text: string) => {
    if (deckTab) setSummary(text);
    else updateSlide({ note: text });
  };

  return (
    <aside className={`notepad${drawerOpen ? ' drawer-open' : ''}`} aria-label="슬라이드별 메모장" data-testid="notepad">
      <button
        type="button"
        className="drawer-bar"
        onClick={() => setDrawerOpen((open) => !open)}
        aria-expanded={drawerOpen}
        aria-controls="note-sheet"
        data-testid="note-drawer-toggle"
      >
        <span className="drawer-grip" aria-hidden />
        <span className="drawer-label"><span aria-hidden>📝</span> 현재 슬라이드 메모</span>
        <span className="drawer-count">{position}/{deck.slides.length}장</span>
        <span className="drawer-cue">{drawerOpen ? '▼ 닫기' : '▲ 열기'}</span>
      </button>

      <div className="note-sheet" id="note-sheet">
        <div className="note-sheet-head">
          <span className="drawer-grip" aria-hidden />
          <b>슬라이드 메모</b>
          <small>{position}/{deck.slides.length}장</small>
          <button
            type="button" className="icon-btn small" onClick={() => setDrawerOpen(false)}
            aria-label="메모 드로워 닫기" data-testid="note-drawer-close"
          >
            <IconDown size={16} />
          </button>
        </div>

        <div className="note-tabs" role="tablist" aria-label="메모 종류">
          <button
            type="button" role="tab" aria-selected={!deckTab}
            className={!deckTab ? 'on' : ''}
            onClick={() => setSettings({ noteTab: 'slide' })}
            data-testid="note-tab-slide"
          >
            <IconNote size={15} /><span>현재 슬라이드 메모</span>
          </button>
          <button
            type="button" role="tab" aria-selected={deckTab}
            className={deckTab ? 'on' : ''}
            onClick={() => setSettings({ noteTab: 'deck' })}
            data-testid="note-tab-deck"
          >
            <span>덱 전체 요약</span>
          </button>
        </div>

        <div className="note-head">
          <div className="note-where">
            <b>{deckTab ? deck.title : slide.title}</b>
            <small>{deckTab ? `${deck.slides.length}장 전체 요약 노트` : `${position}장 · 이 슬라이드에 1:1로 묶인 노트`}</small>
          </div>
          <div className="seg small" role="tablist" aria-label="노트 보기">
            <button type="button" role="tab" aria-selected={editing} className={editing ? 'on' : ''} onClick={() => setMode('edit')}>
              <IconEdit size={13} /><span>편집</span>
            </button>
            <button type="button" role="tab" aria-selected={!editing} className={!editing ? 'on' : ''} onClick={() => setMode('preview')}>
              <IconEye size={13} /><span>미리보기</span>
            </button>
          </div>
        </div>

        <div className="note-body">
          {editing ? (
            <textarea
              className="md-input note-input"
              value={value}
              onChange={(event) => write(event.target.value)}
              spellCheck={false}
              placeholder={
                deckTab
                  ? '덱 전체를 한 장으로 정리해 보세요. ==가림막==, - [ ] 체크리스트, $수식$ 모두 됩니다.'
                  : '이 슬라이드에만 붙는 노트입니다. 슬라이드를 넘기면 노트도 함께 전환됩니다.'
              }
              aria-label={deckTab ? '덱 전체 요약 노트' : '현재 슬라이드 메모'}
              data-testid="note-input"
            />
          ) : (
            <div className="note-preview">
              {value.trim() ? (
                <RenderedMarkdown
                  markdown={value}
                  maskAll={settings.maskAll}
                  theme={settings.theme}
                  className="note-md"
                />
              ) : (
                <p className="empty-note">
                  {deckTab ? '아직 덱 요약이 없습니다.' : '이 슬라이드에는 아직 노트가 없습니다.'}
                  <button type="button" className="link-btn" onClick={() => setMode('edit')}>편집으로 쓰기</button>
                </p>
              )}
            </div>
          )}
        </div>

        <div className="note-foot">
          <FocusTimer minutes={settings.timerMinutes} onMinutes={(timerMinutes) => setSettings({ timerMinutes })} />
          <button
            type="button"
            className="ghost-btn tiny"
            onClick={() => {
              void navigator.clipboard?.writeText(value).then(() => onToast('노트를 복사했습니다'));
            }}
          >
            노트 복사
          </button>
        </div>
      </div>

      <button
        type="button"
        className="drawer-scrim"
        onClick={() => setDrawerOpen(false)}
        aria-label="메모 드로워 접기"
        tabIndex={-1}
        data-testid="note-drawer-scrim"
      />
    </aside>
  );
}
