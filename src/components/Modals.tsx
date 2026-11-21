import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { splitMarkdown } from '../lib/split';
import type { SplitMode } from '../types/study';
import type { ExportKind } from '../lib/exportBundle';
import { exportFilename } from '../lib/exportBundle';
import { IconClose, IconFile, IconUpload } from './Icons';

interface ModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export function Modal({ title, subtitle, onClose, children, footer, wide }: ModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`modal${wide ? ' wide' : ''}`}>
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기"><IconClose size={18} /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

interface HelpModalProps {
  onClose: () => void;
}

/** `⋮ → 사용법`: the whole manual lives here, so no slide has to carry it. */
export function HelpModal({ onClose }: HelpModalProps) {
  return (
    <Modal
      title="Sága Glitra 사용법"
      subtitle="가이드 · 단축키 · 마크다운 문법 — 필요한 항목만 골라 보세요."
      onClose={onClose}
      wide
      footer={
        <div className="modal-actions">
          <button type="button" className="primary-btn" onClick={onClose} data-testid="help-close">알겠습니다</button>
        </div>
      }
    >
      <div className="help-grid" data-testid="help-modal">
        <section className="help-card help-wide">
          <h3>가이드</h3>
          <ol className="help-list">
            <li><b>.md 열기</b>로 마크다운 파일을 고르거나 붙여넣으면 <code>---</code> 기준으로 슬라이드가 나뉩니다.</li>
            <li>왼쪽 목록에서 장을 고르면 가운데 슬라이드와 오른쪽 노트가 <b>함께</b> 넘어갑니다.</li>
            <li>메모장은 슬라이드마다 1:1로 저장되고, 25:00 집중 타이머로 공부 시간을 나눕니다.</li>
            <li>작업은 이 브라우저(IndexedDB)에 자동 저장됩니다. <code>⋮ → 내보내기</code>에서 .md · ZIP 번들 · 전체 백업을 받아 두세요.</li>
          </ol>
        </section>

        <section className="help-card">
          <h3>마크다운 문법</h3>
          <ul className="help-list help-syntax">
            <li><code># 제목</code> 첫 줄이 슬라이드 제목이 됩니다.</li>
            <li><code>---</code> 수평선, 또는 <code>##</code> 헤딩으로 슬라이드를 나눕니다.</li>
            <li><code>| 표 |</code> · <code>- [ ] 체크리스트</code> · <code>&gt; 인용</code></li>
            <li><code>```ts</code> 코드펜스에는 언어 배지와 복사 버튼이 붙습니다.</li>
            <li><code>&lt;!-- note: … --&gt;</code>는 슬라이드에 붙는 노트가 됩니다.</li>
          </ul>
        </section>

        <section className="help-card">
          <h3>가림막 · 필기</h3>
          <ul className="help-list">
            <li><code>==키워드==</code>는 가림막이 되어 눌러서 하나씩 열립니다.</li>
            <li>상단 <b>가림막 전체</b> 토글로 한 번에 숨기거나 공개합니다.</li>
            <li><b>필기</b>를 켜면 형광펜·펜으로 슬라이드 위에 바로 그립니다. 되돌리기와 획 지우기가 옆에 있습니다.</li>
            <li>필기·편집 중에는 스와이프 넘김이 꺼져 그리기와 글자 선택을 방해하지 않습니다.</li>
          </ul>
        </section>

        <section className="help-card">
          <h3>수식 · 다이어그램</h3>
          <ul className="help-list">
            <li><code>$E=mc^2$</code> 인라인 수식, <code>$$ … $$</code> 블록 수식.</li>
            <li><code>```mermaid</code> 블록은 flowchart·sequence 다이어그램으로 그려집니다.</li>
            <li>수식과 다이어그램은 번들에 들어 있어 오프라인에서도 보입니다.</li>
          </ul>
        </section>

        <section className="help-card">
          <h3>단축키</h3>
          <dl className="help-keys">
            <div><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>이전 / 다음 슬라이드</dd></div>
            <div><dt><kbd>F5</kbd></dt><dd>발표 모드</dd></div>
            <div><dt><kbd>?</kbd></dt><dd>이 사용법</dd></div>
            <div><dt><kbd>Esc</kbd></dt><dd>모달 닫기 · 발표 종료</dd></div>
            <div><dt><kbd>N</kbd></dt><dd>발표 모드에서 발표자 메모</dd></div>
          </dl>
        </section>

        <section className="help-card help-wide">
          <h3>내보내기</h3>
          <ul className="help-list">
            <li><b>내보내기</b> 한 곳에서 <b>슬라이드만</b> · <b>메모만</b> · <b>슬라이드 + 메모 합본</b> · <b>ZIP 번들</b> · <b>전체 백업</b>을 고릅니다.</li>
            <li><b>ZIP 번들</b>에는 슬라이드 .md · 메모 .md · .study.json 백업이 각각 따로 들어 있습니다.</li>
            <li><b>전체 백업(.study.json)</b>은 덱 · 슬라이드 · 메모 · 필기 · 학습 상태를 모두 담고, <code>⋮ → .study.json 복원</code>으로 100% 되돌립니다.</li>
          </ul>
        </section>

        <section className="help-card help-wide">
          <h3>모바일 메모 드로워</h3>
          <ul className="help-list">
            <li>화면 아래 슬림한 <b>📝 현재 슬라이드 메모 · N/M장 · ▲ 열기</b> 바를 누르면 메모 드로워가 위로 올라옵니다.</li>
            <li>드로워 안에서 <b>현재 슬라이드 메모 · 덱 전체 요약 · 편집/미리보기 · 25:00 집중 타이머</b>를 모두 씁니다.</li>
            <li>메모가 비어 있으면 아래 바에 흐린 글씨로 <b>여기에 메모하세요</b>가 바로 보입니다.</li>
            <li>위쪽 바를 다시 누르거나 백드롭을 누르면 드로워가 접혀 슬라이드가 화면을 가득 채웁니다.</li>
            <li>슬라이드 영역을 좌우로 밀어도 넘어갑니다.</li>
          </ul>
        </section>
      </div>
    </Modal>
  );
}

interface NewDeckModalProps {
  onClose: () => void;
  onCreate: (title: string) => void;
}

/** From the landing: name a lecture before its first slide is written. */
export function NewDeckModal({ onClose, onCreate }: NewDeckModalProps) {
  const [title, setTitle] = useState('');
  const submit = () => onCreate(title.trim() || '새 강의');

  return (
    <Modal
      title="새 강의 만들기"
      subtitle="이름을 정하면 빈 슬라이드 한 장으로 공부방이 열립니다."
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>취소</button>
          <button type="button" className="primary-btn" onClick={submit} data-testid="new-deck-create">만들기</button>
        </div>
      }
    >
      <label className="stack">
        <span className="field-label">강의 이름</span>
        <input
          className="text-input"
          value={title}
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') submit(); }}
          placeholder="예: 분산 시스템 3장"
          aria-label="새 강의 이름"
          data-testid="new-deck-name"
        />
      </label>
      <p className="export-hint">첫 줄에 제목을 쓴 마크다운을 붙여넣거나, .md 파일을 가져와도 됩니다.</p>
    </Modal>
  );
}

interface MarkdownModalProps {
  splitMode: SplitMode;
  onSplitMode: (mode: SplitMode) => void;
  onClose: () => void;
  onImport: (text: string, filename: string) => void;
}

const PLACEHOLDER = `# 1장 — 들어가기

==가림막==과 $E=mc^2$ 수식도 됩니다.

---

## 2장 — 다음

- [ ] 체크리스트
- [x] 끝난 항목

<!-- note:
이 슬라이드에 붙는 노트입니다.
-->`;

export function MarkdownModal({ splitMode, onSplitMode, onClose, onImport }: MarkdownModalProps) {
  const [text, setText] = useState('');
  const [filename, setFilename] = useState('');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const count = useMemo(() => {
    if (!text.trim()) return 0;
    try {
      return splitMarkdown(text, splitMode).length;
    } catch {
      return 0;
    }
  }, [text, splitMode]);

  const readFile = async (file: File) => {
    try {
      const content = await file.text();
      setText(content);
      setFilename(file.name);
      setError('');
    } catch {
      setError('파일을 읽지 못했습니다.');
    }
  };

  const submit = () => {
    if (!text.trim()) {
      setError('마크다운을 붙여넣거나 .md 파일을 열어 주세요.');
      return;
    }
    try {
      onImport(text, filename);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '가져오지 못했습니다.');
    }
  };

  return (
    <Modal
      title="마크다운 덱 열기"
      subtitle=".md 파일을 고르거나, 내용을 그대로 붙여넣으세요. PKPilot0008의 frontmatter도 읽습니다."
      onClose={onClose}
      wide
      footer={
        <>
          <div className="split-pick" role="group" aria-label="슬라이드 분할 기준">
            <span>분할 기준</span>
            <button type="button" className={splitMode === 'hr' ? 'on' : ''} onClick={() => onSplitMode('hr')} data-testid="split-hr">
              <code>---</code> 수평선
            </button>
            <button type="button" className={splitMode === 'heading' ? 'on' : ''} onClick={() => onSplitMode('heading')} data-testid="split-heading">
              <code>##</code> 헤딩
            </button>
          </div>
          <div className="modal-actions">
            <span className="count-hint">{count > 0 ? `${count}장으로 나뉩니다` : '내용을 기다리는 중'}</span>
            <button type="button" className="ghost-btn" onClick={onClose}>취소</button>
            <button type="button" className="primary-btn" onClick={submit} data-testid="import-md">덱으로 가져오기</button>
          </div>
        </>
      }
    >
      <div
        className={`drop-zone${dragging ? ' dragging' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void readFile(file);
        }}
      >
        <div className="drop-copy">
          <IconUpload size={22} />
          <b>.md 파일을 여기로 끌어다 놓기</b>
          <small>또는</small>
          <button type="button" className="ghost-btn" onClick={() => fileRef.current?.click()}>
            <IconFile size={15} /> 파일 선택
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".md,.markdown,.mdown,.txt,text/markdown,text/plain"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readFile(file);
            }}
            data-testid="md-file"
          />
          {filename && <span className="file-chip">{filename}</span>}
        </div>
      </div>

      <label className="stack">
        <span className="field-label">또는 마크다운 붙여넣기</span>
        <textarea
          className="md-input paste"
          value={text}
          onChange={(event) => { setText(event.target.value); setError(''); }}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          aria-label="마크다운 붙여넣기"
          data-testid="md-paste"
        />
      </label>

      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  );
}

interface ExportModalProps {
  /** Deck title stem, already filename-safe. */
  baseName: string;
  slideCount: number;
  noteCount: number;
  inkCount: number;
  onClose: () => void;
  onExport: (kind: ExportKind, noteMode: 'comment' | 'quote') => void;
}

/**
 * One export sheet for every way out of the study room: slides, notes, the
 * combined deck (still re-importable), a ZIP bundle, or the full backup.
 */
export function ExportModal({ baseName, slideCount, noteCount, inkCount, onClose, onExport }: ExportModalProps) {
  const [kind, setKind] = useState<ExportKind>('combined');
  const [noteMode, setNoteMode] = useState<'comment' | 'quote'>('comment');
  const options: { value: ExportKind; title: string; hint: string; badge: string }[] = [
    {
      value: 'slides', title: '슬라이드만', badge: '.md',
      hint: `슬라이드 ${slideCount}장 본문만 — 메모는 넣지 않습니다`,
    },
    {
      value: 'notes', title: '메모만', badge: '.md',
      hint: `슬라이드별 메모 ${noteCount}개와 덱 요약을 한 파일로`,
    },
    {
      value: 'combined', title: '슬라이드 + 메모 합본', badge: '.md',
      hint: '---로 나뉜 덱 하나 — 다시 가져오면 메모까지 복원됩니다',
    },
    {
      value: 'zip', title: 'ZIP 번들', badge: '.zip',
      hint: '슬라이드 · 메모 · 전체 백업을 각각의 파일로 묶어서',
    },
    {
      value: 'study', title: '전체 백업', badge: '.study.json',
      hint: `슬라이드 ${slideCount}장 · 메모 ${noteCount}개 · 학습 상태 · ${inkCount ? `필기 ${inkCount}획` : '필기'}`,
    },
  ];
  const filename = exportFilename(baseName, kind);
  const confirmLabel = kind === 'zip' ? 'ZIP 내려받기' : kind === 'study' ? '백업 내려받기' : '.md 내려받기';

  return (
    <Modal
      title="내보내기"
      subtitle="무엇을 내려받을지 고르세요. 파일은 이 브라우저에서 바로 만들어집니다."
      onClose={onClose}
      footer={
        <>
          <span className="file-target" data-testid="export-filename"><IconFile size={13} />{filename}</span>
          <div className="modal-actions">
            <button type="button" className="ghost-btn" onClick={onClose}>취소</button>
            <button
              type="button" className="primary-btn"
              onClick={() => onExport(kind, noteMode)}
              data-testid="export-confirm"
            >
              {confirmLabel}
            </button>
          </div>
        </>
      }
    >
      <div className="option-list" role="radiogroup" aria-label="내보내기 형식" data-testid="export-modal">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={kind === option.value}
            className={`option-row${kind === option.value ? ' on' : ''}`}
            onClick={() => setKind(option.value)}
            data-testid={`export-option-${option.value}`}
          >
            <span className="option-dot" aria-hidden />
            <span className="option-text"><b>{option.title}</b><small>{option.hint}</small></span>
            <code>{option.badge}</code>
          </button>
        ))}
      </div>

      {kind === 'combined' && (
        <div className="split-pick" role="group" aria-label="메모를 담는 방식" data-testid="export-note-mode">
          <span>노트 형식</span>
          <button type="button" className={noteMode === 'comment' ? 'on' : ''} onClick={() => setNoteMode('comment')}>
            HTML 주석 <code>&lt;!-- note --&gt;</code>
          </button>
          <button type="button" className={noteMode === 'quote' ? 'on' : ''} onClick={() => setNoteMode('quote')}>
            인용 블록 <code>&gt; 노트</code>
          </button>
        </div>
      )}

      <p className="export-hint">
        {kind === 'zip'
          ? 'ZIP 안에는 슬라이드 .md · 메모 .md · .study.json 백업이 각각 들어 있어, 필요한 파일만 꺼내 쓸 수 있습니다.'
          : kind === 'study'
            ? '전체 백업은 ⋮ → .study.json 복원으로 언제든 100% 되돌릴 수 있습니다.'
            : kind === 'notes'
              ? '메모만 모은 파일은 슬라이드 번호와 제목으로 묶여 있어 시험 전 복습용으로 읽기 좋습니다.'
              : '파일 맨 앞에 frontmatter가 붙고, 슬라이드는 ---로 나뉩니다.'}
      </p>
    </Modal>
  );
}
