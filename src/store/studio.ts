import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Deck, Slide, Stroke, StrokesBySlide, StudioSettings, StudyFile,
} from '../types/study';
import { DEFAULT_SETTINGS } from '../types/study';
import {
  createDeck, createSlide, cycleStatus, deckToMarkdown, importMarkdown, parseStudyFile,
  serializeStudy, uid,
} from '../lib/study';
import { deleteStrokes, getWorkspace, loadAllStrokes, setStrokes as saveStrokes, setWorkspace } from '../lib/db';
import {
  SAMPLE_DECK_ID, SAMPLE_VERSION, createSampleDeck, sampleDeckSignature, upgradeSampleDecks,
} from '../lib/sample';
import type { SplitMode } from '../types/study';

interface Persisted {
  version: 1;
  decks: Deck[];
  activeDeckId: string;
  activeSlideId: string;
  settings: StudioSettings;
  /** Which sample deck build the workspace last carried. */
  sampleDeckVersion?: number;
  /** Signature of the sample deck when it was last written. */
  sampleDeckFingerprint?: string;
}

export interface StudioApi {
  ready: boolean;
  decks: Deck[];
  deck: Deck;
  slide: Slide;
  activeDeckId: string;
  activeSlideId: string;
  strokes: StrokesBySlide;
  slideStrokes: Stroke[];
  settings: StudioSettings;
  setSettings: (patch: Partial<StudioSettings>) => void;
  selectDeck: (deckId: string) => void;
  selectSlide: (slideId: string) => void;
  goSlide: (delta: number) => void;
  createNewDeck: (title?: string) => void;
  deleteDeck: (deckId: string) => void;
  renameDeck: (title: string) => void;
  restoreSample: () => void;
  importFromMarkdown: (text: string, filename?: string) => { slides: number; title: string };
  updateSlide: (patch: Partial<Pick<Slide, 'markdown' | 'note' | 'title' | 'status'>>) => void;
  toggleStatus: (slideId?: string) => void;
  addSlide: () => void;
  duplicateSlide: (slideId: string) => void;
  deleteSlide: (slideId: string) => void;
  moveSlide: (slideId: string, delta: number) => void;
  moveSlideTo: (slideId: string, index: number) => void;
  setSummary: (text: string) => void;
  addStroke: (stroke: Stroke) => void;
  undoStroke: () => void;
  clearInk: () => void;
  replaceAll: (file: StudyFile) => void;
  exportStudy: () => string;
  exportMarkdown: (mode?: 'comment' | 'quote' | 'none') => string;
}

function makeDeckFromImport(text: string, filename: string, mode: SplitMode): Deck {
  const result = importMarkdown(text, mode, filename);
  const slides = result.slides.map((chunk) => createSlide(chunk.markdown, chunk.note, chunk.title));
  return createDeck(result.title, slides);
}

export function useStudio(): StudioApi {
  const [ready, setReady] = useState(false);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [activeDeckId, setActiveDeckId] = useState('');
  const [activeSlideId, setActiveSlideId] = useState('');
  const [strokes, setStrokes] = useState<StrokesBySlide>({});
  const [settings, setSettingsState] = useState<StudioSettings>(DEFAULT_SETTINGS);

  const savedStrokes = useRef<Record<string, string>>({});
  const hydrated = useRef(false);

  // ── hydrate ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await getWorkspace<Persisted>();
        if (cancelled) return;
        if (stored?.decks?.length) {
          const ids = stored.decks.flatMap((deck) => deck.slides.map((slide) => slide.id));
          const ink = await loadAllStrokes(ids);
          // An untouched sample deck follows the current build; anything the
          // person edited (or drew on) is kept exactly as it is.
          const upgraded = upgradeSampleDecks(stored.decks, {
            version: stored.sampleDeckVersion,
            fingerprint: stored.sampleDeckFingerprint,
          }, ink as StrokesBySlide);
          if (cancelled) return;
          setDecks(upgraded.decks);
          const activeDeck = upgraded.decks.find((item) => item.id === stored.activeDeckId) ?? upgraded.decks[0];
          const keepSlide = activeDeck?.slides.some((item) => item.id === stored.activeSlideId);
          setActiveDeckId(activeDeck.id);
          setActiveSlideId(keepSlide ? stored.activeSlideId : activeDeck.slides[0]?.id ?? '');
          setSettingsState({ ...DEFAULT_SETTINGS, ...stored.settings });
          if (Object.keys(ink).length) setStrokes(ink as StrokesBySlide);
        } else {
          const sample = createSampleDeck();
          setDecks([sample]);
          setActiveDeckId(sample.id);
          setActiveSlideId(sample.slides[0].id);
        }
      } catch {
        const sample = createSampleDeck();
        setDecks([sample]);
        setActiveDeckId(sample.id);
        setActiveSlideId(sample.slides[0].id);
      } finally {
        if (!cancelled) {
          hydrated.current = true;
          setReady(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── keep selection coherent ────────────────────────────────────────────
  const deck = useMemo(
    () => decks.find((item) => item.id === activeDeckId) ?? decks[0],
    [decks, activeDeckId],
  );

  useEffect(() => {
    if (!deck) return;
    if (deck.id !== activeDeckId) setActiveDeckId(deck.id);
    if (!deck.slides.some((slide) => slide.id === activeSlideId)) {
      setActiveSlideId(deck.slides[0]?.id ?? '');
    }
  }, [deck, activeDeckId, activeSlideId]);

  const slide = useMemo(() => {
    if (!deck) return undefined;
    return deck.slides.find((item) => item.id === activeSlideId) ?? deck.slides[0];
  }, [deck, activeSlideId]);

  // ── persist ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hydrated.current || !ready || !deck) return;
    const timer = window.setTimeout(() => {
      const sampleDeck = decks.find((item) => item.id === SAMPLE_DECK_ID);
      const payload: Persisted = {
        version: 1,
        decks,
        activeDeckId: deck.id,
        activeSlideId: slide?.id ?? '',
        settings,
        sampleDeckVersion: SAMPLE_VERSION,
        sampleDeckFingerprint: sampleDeck ? sampleDeckSignature(sampleDeck) : undefined,
      };
      void setWorkspace(payload);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [decks, settings, deck, slide, ready]);

  useEffect(() => {
    for (const [slideId, list] of Object.entries(strokes)) {
      const json = JSON.stringify(list);
      if (savedStrokes.current[slideId] === json) continue;
      savedStrokes.current[slideId] = json;
      void saveStrokes(slideId, list);
    }
  }, [strokes]);

  // ── settings / theme ───────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', settings.theme === 'dark' ? '#0b1020' : '#fafafd');
  }, [settings.theme]);

  const setSettings = useCallback((patch: Partial<StudioSettings>) => {
    setSettingsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const patchDeck = useCallback((deckId: string, fn: (deck: Deck) => Deck) => {
    setDecks((prev) => prev.map((item) => (item.id === deckId ? { ...fn(item), updatedAt: Date.now() } : item)));
  }, []);

  const selectDeck = useCallback((deckId: string) => {
    setActiveDeckId(deckId);
    setDecks((prev) => {
      const target = prev.find((item) => item.id === deckId);
      if (target) setActiveSlideId(target.slides[0]?.id ?? '');
      return prev;
    });
  }, []);

  const selectSlide = useCallback((slideId: string) => setActiveSlideId(slideId), []);

  const goSlide = useCallback((delta: number) => {
    setActiveSlideId((current) => {
      if (!deck) return current;
      const index = deck.slides.findIndex((item) => item.id === current);
      const next = Math.min(deck.slides.length - 1, Math.max(0, index + delta));
      return deck.slides[next]?.id ?? current;
    });
  }, [deck]);

  const createNewDeck = useCallback((title = '새 덱') => {
    const made = createDeck(title);
    setDecks((prev) => [made, ...prev]);
    setActiveDeckId(made.id);
    setActiveSlideId(made.slides[0].id);
  }, []);

  const deleteDeck = useCallback((deckId: string) => {
    setDecks((prev) => {
      const target = prev.find((item) => item.id === deckId);
      target?.slides.forEach((item) => { void deleteStrokes(item.id); });
      const rest = prev.filter((item) => item.id !== deckId);
      if (rest.length === 0) {
        const sample = createSampleDeck();
        setActiveDeckId(sample.id);
        setActiveSlideId(sample.slides[0].id);
        return [sample];
      }
      if (deckId === activeDeckId) {
        setActiveDeckId(rest[0].id);
        setActiveSlideId(rest[0].slides[0]?.id ?? '');
      }
      return rest;
    });
  }, [activeDeckId]);

  const renameDeck = useCallback((title: string) => {
    if (!deck) return;
    patchDeck(deck.id, (item) => ({ ...item, title: title.trim() || item.title }));
  }, [deck, patchDeck]);

  const restoreSample = useCallback(() => {
    const sample = createSampleDeck();
    // One sample deck at a time: restore replaces the previous copy instead of
    // stacking a second deck with the same id.
    setDecks((prev) => [sample, ...prev.filter((item) => item.id !== sample.id)]);
    setActiveDeckId(sample.id);
    setActiveSlideId(sample.slides[0].id);
  }, []);

  const importFromMarkdown = useCallback((text: string, filename = '') => {
    const made = makeDeckFromImport(text, filename, settings.splitMode);
    setDecks((prev) => [made, ...prev]);
    setActiveDeckId(made.id);
    setActiveSlideId(made.slides[0].id);
    return { slides: made.slides.length, title: made.title };
  }, [settings.splitMode]);

  const updateSlide = useCallback((patch: Partial<Pick<Slide, 'markdown' | 'note' | 'title' | 'status'>>) => {
    if (!deck || !slide) return;
    patchDeck(deck.id, (item) => ({
      ...item,
      slides: item.slides.map((entry) => (entry.id === slide.id ? { ...entry, ...patch } : entry)),
    }));
  }, [deck, slide, patchDeck]);

  const toggleStatus = useCallback((slideId?: string) => {
    if (!deck) return;
    const target = slideId ?? slide?.id;
    patchDeck(deck.id, (item) => ({
      ...item,
      slides: item.slides.map((entry) =>
        entry.id === target ? { ...entry, status: cycleStatus(entry.status) } : entry),
    }));
  }, [deck, slide, patchDeck]);

  const addSlide = useCallback(() => {
    if (!deck) return;
    const fresh = createSlide('## 새 슬라이드\n\n내용을 적어 보세요.');
    patchDeck(deck.id, (item) => {
      const index = item.slides.findIndex((entry) => entry.id === slide?.id);
      const next = [...item.slides];
      next.splice(index >= 0 ? index + 1 : next.length, 0, fresh);
      return { ...item, slides: next };
    });
    setActiveSlideId(fresh.id);
  }, [deck, slide, patchDeck]);

  const duplicateSlide = useCallback((slideId: string) => {
    if (!deck) return;
    const source = deck.slides.find((item) => item.id === slideId);
    if (!source) return;
    const copy: Slide = { ...source, id: uid('sl'), status: 'unlearned' };
    patchDeck(deck.id, (item) => {
      const index = item.slides.findIndex((entry) => entry.id === slideId);
      const next = [...item.slides];
      next.splice(index + 1, 0, copy);
      return { ...item, slides: next };
    });
    setActiveSlideId(copy.id);
  }, [deck, patchDeck]);

  const deleteSlide = useCallback((slideId: string) => {
    if (!deck) return;
    if (deck.slides.length <= 1) return;
    patchDeck(deck.id, (item) => {
      const index = item.slides.findIndex((entry) => entry.id === slideId);
      const next = item.slides.filter((entry) => entry.id !== slideId);
      if (slideId === activeSlideId) {
        const fallback = next[Math.max(0, index - 1)] ?? next[0];
        setActiveSlideId(fallback.id);
      }
      return { ...item, slides: next };
    });
    void deleteStrokes(slideId);
    setStrokes((prev) => {
      const next = { ...prev };
      delete next[slideId];
      return next;
    });
  }, [deck, activeSlideId, patchDeck]);

  const moveSlide = useCallback((slideId: string, delta: number) => {
    if (!deck) return;
    patchDeck(deck.id, (item) => {
      const index = item.slides.findIndex((entry) => entry.id === slideId);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= item.slides.length) return item;
      const next = [...item.slides];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return { ...item, slides: next };
    });
  }, [deck, patchDeck]);

  const moveSlideTo = useCallback((slideId: string, index: number) => {
    if (!deck) return;
    patchDeck(deck.id, (item) => {
      const from = item.slides.findIndex((entry) => entry.id === slideId);
      if (from < 0) return item;
      const target = Math.min(item.slides.length - 1, Math.max(0, index));
      if (from === target) return item;
      const next = [...item.slides];
      const [moved] = next.splice(from, 1);
      next.splice(target, 0, moved);
      return { ...item, slides: next };
    });
  }, [deck, patchDeck]);

  const setSummary = useCallback((text: string) => {
    if (!deck) return;
    patchDeck(deck.id, (item) => ({ ...item, summary: text }));
  }, [deck, patchDeck]);

  const addStroke = useCallback((stroke: Stroke) => {
    if (!slide) return;
    const slideId = slide.id;
    setStrokes((prev) => ({ ...prev, [slideId]: [...(prev[slideId] ?? []), stroke] }));
  }, [slide]);

  const undoStroke = useCallback(() => {
    if (!slide) return;
    const slideId = slide.id;
    setStrokes((prev) => {
      const list = prev[slideId] ?? [];
      return { ...prev, [slideId]: list.slice(0, -1) };
    });
  }, [slide]);

  const clearInk = useCallback(() => {
    if (!slide) return;
    const slideId = slide.id;
    setStrokes((prev) => ({ ...prev, [slideId]: [] }));
  }, [slide]);

  const replaceAll = useCallback((file: StudyFile) => {
    setDecks(file.decks);
    setStrokes(file.strokes ?? {});
    setActiveDeckId(file.activeDeckId || file.decks[0].id);
    setActiveSlideId(file.decks[0].slides[0]?.id ?? '');
    for (const [slideId, list] of Object.entries(file.strokes ?? {})) {
      savedStrokes.current[slideId] = JSON.stringify(list);
      void saveStrokes(slideId, list);
    }
  }, []);

  const exportStudy = useCallback(() => {
    if (!deck) return '';
    return serializeStudy({ decks, activeDeckId: deck.id, strokes });
  }, [decks, deck, strokes]);

  const exportMarkdown = useCallback((mode: 'comment' | 'quote' | 'none' = 'comment') => {
    if (!deck) return '';
    return deckToMarkdown(deck, mode);
  }, [deck]);

  return {
    ready,
    decks,
    deck: (deck ?? decks[0]) as Deck,
    slide: (slide ?? deck?.slides[0]) as Slide,
    activeDeckId: deck?.id ?? '',
    activeSlideId: slide?.id ?? '',
    strokes,
    slideStrokes: (slide && strokes[slide.id]) || [],
    settings,
    setSettings,
    selectDeck,
    selectSlide,
    goSlide,
    createNewDeck,
    deleteDeck,
    renameDeck,
    restoreSample,
    importFromMarkdown,
    updateSlide,
    toggleStatus,
    addSlide,
    duplicateSlide,
    deleteSlide,
    moveSlide,
    moveSlideTo,
    setSummary,
    addStroke,
    undoStroke,
    clearInk,
    replaceAll,
    exportStudy,
    exportMarkdown,
  };
}

export { parseStudyFile };
