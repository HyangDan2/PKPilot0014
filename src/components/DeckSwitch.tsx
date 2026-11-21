import { useEffect, useRef, useState } from 'react';
import type { StudioApi } from '../store/studio';
import { IconCheck, IconDeck, IconSpark, IconTrash } from './Icons';

interface Props {
  studio: StudioApi;
  onRestoreSample: () => void;
  onToast: (message: string) => void;
}

/**
 * The deck switcher that lives in the second bar, right after the drawer
 * button: the open deck's name, its slide count, and every deck in this
 * browser a click away — plus new deck, sample restore and delete.
 */
export function DeckSwitch({ studio, onRestoreSample, onToast }: Props) {
  const { decks, deck, selectDeck, createNewDeck, deleteDeck } = studio;
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const make = () => {
    createNewDeck(newName.trim() || '새 덱');
    setNewName('');
    setOpen(false);
  };

  return (
    <div className="deck-switch" ref={wrapRef}>
      <button
        type="button"
        className={`deck-btn${open ? ' open' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`덱 전환 — ${deck.title}, 슬라이드 ${deck.slides.length}장`}
        title="덱 전환"
        data-testid="deck-button"
      >
        <IconDeck size={15} />
        <span className="deck-btn-name">{deck.title}</span>
        <b className="deck-btn-count">{deck.slides.length}</b>
      </button>

      {open && (
        <div className="popover deck-pop" role="menu" data-testid="deck-menu">
          <p className="pop-head">DECKS</p>
          {decks.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={`pop-item${item.id === deck.id ? ' current' : ''}`}
              onClick={() => { selectDeck(item.id); setOpen(false); }}
            >
              <span className="pop-ic">{item.id === deck.id ? <IconCheck size={14} /> : <IconDeck size={14} />}</span>
              <span className="pop-text">
                <b>{item.title}</b>
                <small>{item.slides.length}장 · {new Date(item.updatedAt).toLocaleDateString('ko-KR')}</small>
              </span>
            </button>
          ))}
          <span className="pop-sep" />
          <div className="pop-new">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="새 덱 이름"
              aria-label="새 덱 이름"
              onKeyDown={(event) => { if (event.key === 'Enter') make(); }}
            />
            <button type="button" className="primary-btn tiny" onClick={make}>만들기</button>
          </div>
          <button
            type="button" role="menuitem" className="pop-item"
            onClick={() => { setOpen(false); onRestoreSample(); }}
          >
            <span className="pop-ic"><IconSpark size={14} /></span>
            <span className="pop-text"><b>샘플 덱 복원</b><small>Sága Glitra 사용법 5장</small></span>
          </button>
          <button
            type="button" role="menuitem" className="pop-item danger"
            onClick={() => {
              if (window.confirm(`‘${deck.title}’ 덱을 삭제할까요? 이 덱의 필기도 함께 지워집니다.`)) {
                deleteDeck(deck.id);
                onToast('덱을 삭제했습니다');
              }
              setOpen(false);
            }}
          >
            <span className="pop-ic"><IconTrash size={14} /></span>
            <span className="pop-text"><b>이 덱 삭제</b><small>필기 스트로크도 함께 삭제</small></span>
          </button>
        </div>
      )}
    </div>
  );
}
