import { useState } from 'react';
import type { StudioApi } from '../store/studio';
import { STATUS_LABEL, STATUS_SHORT } from '../types/study';
import { plainText } from '../lib/markdown';
import {
  IconCopy, IconDown, IconPlus, IconTrash, IconUp, IconUpload,
} from './Icons';

interface Props {
  studio: StudioApi;
  onOpenMarkdown: () => void;
  onToast: (message: string) => void;
  onClose?: () => void;
}

export function DeckRail({ studio, onOpenMarkdown, onToast, onClose }: Props) {
  const { deck, slide, selectSlide, addSlide, duplicateSlide, deleteSlide, moveSlide, moveSlideTo, toggleStatus } = studio;
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const drop = (targetId: string, index: number) => {
    if (dragId && dragId !== targetId) {
      moveSlideTo(dragId, index);
      onToast('슬라이드 순서를 옮겼습니다');
    }
    setDragId(null);
    setOverId(null);
  };

  return (
    <aside className="rail" aria-label="슬라이드 덱 레일">
      <div className="rail-head">
        <span className="rail-kicker">SLIDES</span>
        <b className="rail-count">{deck.slides.length}</b>
        <span className="rail-deck" title={deck.title}>{deck.title}</span>
        <button type="button" className="icon-btn small" onClick={addSlide} title="슬라이드 추가" aria-label="슬라이드 추가" data-testid="add-slide">
          <IconPlus size={16} />
        </button>
      </div>

      <ol className="rail-list">
        {deck.slides.map((item, index) => {
          const active = item.id === slide.id;
          return (
            <li
              key={item.id}
              className={`rail-item${active ? ' active' : ''}${overId === item.id ? ' drop-target' : ''}`}
              draggable
              onDragStart={() => setDragId(item.id)}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              onDragOver={(event) => { event.preventDefault(); setOverId(item.id); }}
              onDrop={(event) => { event.preventDefault(); drop(item.id, index); }}
            >
              <button
                type="button"
                className="rail-card"
                onClick={() => { selectSlide(item.id); onClose?.(); }}
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

              <div className="rail-actions">
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
            </li>
          );
        })}
      </ol>

      <div className="rail-foot">
        <button type="button" className="ghost-btn" onClick={onOpenMarkdown} data-testid="open-markdown">
          <IconUpload size={15} /><span>.md 파일 열기 / 붙여넣기</span>
        </button>
        <p className="rail-hint"><b>드래그</b>로 순서를 바꾸고, 배지를 눌러 학습 상태를 돌립니다.</p>
      </div>
    </aside>
  );
}
