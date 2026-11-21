import { useCallback, useEffect, useRef, useState } from 'react';
import { useStudio } from './store/studio';
import { Header } from './components/Header';
import { DeckRail } from './components/DeckRail';
import { SlideStage } from './components/SlideStage';
import { Notepad } from './components/Notepad';
import { PresentMode } from './components/PresentMode';
import { PrintSheet } from './components/PrintSheet';
import { ExportMdModal, MarkdownModal } from './components/Modals';
import { parseStudyFile } from './lib/study';
import { downloadText, readTextFile, safeFilename } from './lib/files';
import type { NoteExportMode } from './lib/study';

export default function App() {
  const studio = useStudio();
  const [openMd, setOpenMd] = useState(false);
  const [exportMd, setExportMd] = useState(false);
  const [present, setPresent] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [toast, setToast] = useState('');
  const jsonRef = useRef<HTMLInputElement | null>(null);

  const notify = useCallback((message: string) => setToast(message), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'F5') {
        event.preventDefault();
        setPresent(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!printing) return;
    const timer = window.setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 240);
    return () => window.clearTimeout(timer);
  }, [printing]);

  if (!studio.ready) {
    return (
      <div className="boot">
        <span className="boot-mark">SG</span>
        <p>공부방을 여는 중…</p>
      </div>
    );
  }

  const downloadStudy = () => {
    downloadText(`${safeFilename(studio.deck.title)}.study.json`, studio.exportStudy(), 'application/json');
    notify('.study.json 백업을 내려받았습니다');
  };

  const downloadMarkdown = (mode: NoteExportMode) => {
    downloadText(`${safeFilename(studio.deck.title)}.md`, studio.exportMarkdown(mode), 'text/markdown;charset=utf-8');
    setExportMd(false);
    notify('마크다운으로 내보냈습니다');
  };

  const importStudy = async (file: File) => {
    try {
      const text = await readTextFile(file);
      const parsed = parseStudyFile(text);
      studio.replaceAll(parsed);
      notify(`백업을 복원했습니다 — 덱 ${parsed.decks.length}개`);
    } catch (error) {
      notify(error instanceof Error ? error.message : '백업을 복원하지 못했습니다');
    }
  };

  return (
    <div className={`app${railOpen ? ' rail-open' : ''}`}>
      <Header
        studio={studio}
        onOpenMarkdown={() => setOpenMd(true)}
        onPresent={() => setPresent(true)}
        onPrint={() => setPrinting(true)}
        onExportStudy={downloadStudy}
        onImportStudy={() => jsonRef.current?.click()}
        onExportMarkdown={() => setExportMd(true)}
        onRestoreSample={() => { studio.restoreSample(); notify('샘플 덱을 복원했습니다'); }}
        onToast={notify}
      />

      <main className="studio">
        <DeckRail
          studio={studio}
          onOpenMarkdown={() => setOpenMd(true)}
          onToast={notify}
          onClose={() => setRailOpen(false)}
        />

        <SlideStage
          studio={studio}
          onPresent={() => setPresent(true)}
          onToast={notify}
          onToggleRail={() => setRailOpen((value) => !value)}
        />

        <Notepad studio={studio} onToast={notify} />
      </main>

      <input
        ref={jsonRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importStudy(file);
          event.target.value = '';
        }}
        aria-label=".study.json 백업 복원"
      />

      {openMd && (
        <MarkdownModal
          splitMode={studio.settings.splitMode}
          onSplitMode={(splitMode) => studio.setSettings({ splitMode })}
          onClose={() => setOpenMd(false)}
          onImport={(text, filename) => {
            try {
              const result = studio.importFromMarkdown(text, filename);
              setOpenMd(false);
              setRailOpen(false);
              notify(`‘${result.title}’ — ${result.slides}장을 가져왔습니다`);
            } catch (error) {
              notify(error instanceof Error ? error.message : '가져오지 못했습니다');
            }
          }}
        />
      )}

      {exportMd && <ExportMdModal onClose={() => setExportMd(false)} onExport={downloadMarkdown} />}

      {present && <PresentMode studio={studio} onClose={() => setPresent(false)} />}

      {printing && <PrintSheet studio={studio} />}

      <div className={`toast${toast ? ' on' : ''}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}
