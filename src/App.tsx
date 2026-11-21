import { useCallback, useEffect, useRef, useState } from 'react';
import { useStudio } from './store/studio';
import { Header } from './components/Header';
import { Landing } from './components/Landing';
import { DeckRail } from './components/DeckRail';
import { SlideStage } from './components/SlideStage';
import { Notepad } from './components/Notepad';
import { PresentMode } from './components/PresentMode';
import { PrintSheet } from './components/PrintSheet';
import { ExportModal, HelpModal, MarkdownModal, NewDeckModal } from './components/Modals';
import { parseStudyFile } from './lib/study';
import { downloadBytes, downloadText, readTextFile } from './lib/files';
import { buildExportZip, deckNotesMarkdown, exportBaseName, exportFilename } from './lib/exportBundle';
import type { ExportKind } from './lib/exportBundle';

/** The app opens on the landing; the studio is one deck click away. */
type View = 'landing' | 'studio';

export default function App() {
  const studio = useStudio();
  const [view, setView] = useState<View>('landing');
  const [openMd, setOpenMd] = useState(false);
  const [newDeckOpen, setNewDeckOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [present, setPresent] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [toast, setToast] = useState('');
  const jsonRef = useRef<HTMLInputElement | null>(null);

  const notify = useCallback((message: string) => setToast(message), []);
  const goHome = useCallback(() => { setView('landing'); setRailOpen(false); }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // The studio's shortcuts belong to the studio; the landing has none of them.
  useEffect(() => {
    if (view !== 'studio') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'F5') {
        event.preventDefault();
        setPresent(true);
      } else if (event.key === '?') {
        const target = event.target as HTMLElement | null;
        if (target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]')) return;
        event.preventDefault();
        setHelpOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);

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

  const openDeck = (deckId: string) => {
    studio.selectDeck(deckId);
    setView('studio');
    setRailOpen(false);
  };

  const createDeckFromLanding = (title: string) => {
    studio.createNewDeck(title);
    setNewDeckOpen(false);
    setView('studio');
    notify(`‘${title}’ 강의를 만들었습니다`);
  };

  const downloadExport = (kind: ExportKind, noteMode: 'comment' | 'quote') => {
    const deck = studio.deck;
    const base = exportBaseName(deck);
    const name = exportFilename(base, kind);
    if (kind === 'study') {
      downloadText(name, studio.exportStudy(), 'application/json');
    } else if (kind === 'zip') {
      downloadBytes(
        name,
        buildExportZip({
          deck,
          decks: studio.decks,
          activeDeckId: studio.activeDeckId,
          strokes: studio.strokes,
        }),
        'application/zip',
      );
    } else if (kind === 'notes') {
      downloadText(name, deckNotesMarkdown(deck), 'text/markdown;charset=utf-8');
    } else if (kind === 'slides') {
      downloadText(name, studio.exportMarkdown('none'), 'text/markdown;charset=utf-8');
    } else {
      downloadText(name, studio.exportMarkdown(noteMode), 'text/markdown;charset=utf-8');
    }
    setExportOpen(false);
    notify(kind === 'zip' ? 'ZIP 번들을 내려받았습니다 — 슬라이드 · 메모 · 백업 3개 파일' : `‘${name}’ 파일을 내려받았습니다`);
  };

  const noteTotal = studio.deck.slides.filter((slide) => slide.note.trim()).length;
  const inkTotal = Object.values(studio.strokes).reduce((sum, list) => sum + list.length, 0);

  const importStudy = async (file: File) => {
    try {
      const text = await readTextFile(file);
      const parsed = parseStudyFile(text);
      studio.replaceAll(parsed);
      setView('studio');
      notify(`백업을 복원했습니다 — 덱 ${parsed.decks.length}개`);
    } catch (error) {
      notify(error instanceof Error ? error.message : '백업을 복원하지 못했습니다');
    }
  };

  return (
    <>
      {view === 'landing' ? (
        <Landing
          decks={studio.decks}
          activeDeckId={studio.activeDeckId}
          theme={studio.settings.theme}
          onToggleTheme={() => studio.setSettings({ theme: studio.settings.theme === 'dark' ? 'light' : 'dark' })}
          onOpenDeck={openDeck}
          onNewDeck={() => setNewDeckOpen(true)}
          onImportMarkdown={() => setOpenMd(true)}
          onImportStudy={() => jsonRef.current?.click()}
        />
      ) : (
        <div className={`app${railOpen ? ' rail-open' : ''}`}>
          <Header
            studio={studio}
            onOpenHelp={() => setHelpOpen(true)}
            onOpenMarkdown={() => setOpenMd(true)}
            onGoHome={goHome}
            onPrint={() => setPrinting(true)}
            onOpenExport={() => setExportOpen(true)}
            onImportStudy={() => jsonRef.current?.click()}
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
              keysEnabled={!present && !openMd && !exportOpen && !helpOpen}
            />

            <Notepad studio={studio} onToast={notify} />
          </main>
        </div>
      )}

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

      {newDeckOpen && (
        <NewDeckModal onClose={() => setNewDeckOpen(false)} onCreate={createDeckFromLanding} />
      )}

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
              setView('studio');
              notify(`‘${result.title}’ — ${result.slides}장을 가져왔습니다`);
            } catch (error) {
              notify(error instanceof Error ? error.message : '가져오지 못했습니다');
            }
          }}
        />
      )}

      {exportOpen && (
        <ExportModal
          baseName={exportBaseName(studio.deck)}
          slideCount={studio.deck.slides.length}
          noteCount={noteTotal}
          inkCount={inkTotal}
          onClose={() => setExportOpen(false)}
          onExport={downloadExport}
        />
      )}

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}

      {present && <PresentMode studio={studio} onClose={() => setPresent(false)} />}

      {printing && <PrintSheet studio={studio} />}

      <div className={`toast${toast ? ' on' : ''}`} role="status" aria-live="polite">{toast}</div>
    </>
  );
}
