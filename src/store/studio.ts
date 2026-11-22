import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Deck, Slide, Stroke, StrokesBySlide, StudioSettings, StudyFile,
} from '../types/study';
import { DEFAULT_SETTINGS } from '../types/study';
import {
  createDeck, createSlide, cycleStatus, deckToMarkdown, importMarkdown, parseStudyFile,
  serializeStudy, uid,
} from '../lib/study';
import {
  deleteStrokes, flushStorage, getWorkspace, loadAllStrokes, replaceWorkspace, setStrokes as saveStrokes,
  setWorkspace, storageStatus, subscribeStorage,
} from '../lib/db';
import type { StorageStatus } from '../lib/db';
import {
  SAMPLE_DECK_ID, SAMPLE_VERSION, createSampleDeck, sampleBuildSignature, sampleDeckSignature,
  upgradeSampleDecks,
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
  /** Signature of the sample deck copy as it was written. */
  sampleDeckFingerprint?: string;
  /**
   * Signature of the sample deck this build shipped at that moment. Kept apart
   * from the copy's own signature so a deck the person edited can never pass
   * for an untouched one when the sample version rises.
   */
  sampleDeckBuildFingerprint?: string;
  /** The copy already differed from the shipped sample when it was written. */
  sampleDeckEdited?: boolean;
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
  storage: StorageStatus;
  setSettings: (patch: Partial<StudioSettings>) => void;
  selectDeck: (deckId: string) => void;
  selectSlide: (slideId: string) => void;
  goSlide: (delta: number) => void;
  createNewDeck: (title?: string, tags?: string[]) => void;
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
  addStrokeTo: (slideId: string, stroke: Stroke) => void;
  undoStroke: () => void;
  clearInk: () => void;
  replaceAll: (file: StudyFile) => void;
  exportStudy: () => string;
  exportMarkdown: (mode?: 'comment' | 'quote' | 'none') => string;
}

function makeDeckFromImport(text: string, filename: string, mode: SplitMode): Deck {
  const result = importMarkdown(text, mode, filename);
  const slides = result.slides.map((chunk) => createSlide(chunk.markdown, chunk.note, chunk.title));
  return createDeck(result.title, slides, result.tags);
}

function deckSlideIds(deck: Deck): string[] {
  return deck.slides.map((slide) => slide.id);
}

/** The workspace record for one moment, fingerprints included. */
function makePersisted(
  decks: Deck[],
  activeDeckId: string,
  activeSlideId: string,
  settings: StudioSettings,
): Persisted {
  const sample = decks.find((item) => item.id === SAMPLE_DECK_ID);
  const build = sample ? sampleBuildSignature() : undefined;
  const signature = sample ? sampleDeckSignature(sample) : undefined;
  return {
    version: 1,
    decks,
    activeDeckId,
    activeSlideId,
    settings,
    sampleDeckVersion: SAMPLE_VERSION,
    sampleDeckFingerprint: signature,
    sampleDeckBuildFingerprint: build,
    sampleDeckEdited: sample && build ? signature !== build : undefined,
  };
}

export function useStudio(): StudioApi {
  const [ready, setReady] = useState(false);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [activeDeckId, setActiveDeckId] = useState('');
  const [activeSlideId, setActiveSlideId] = useState('');
  const [strokes, setStrokes] = useState<StrokesBySlide>({});
  const [settings, setSettingsState] = useState<StudioSettings>(DEFAULT_SETTINGS);
  const [storage, setStorage] = useState<StorageStatus>(() => storageStatus());

  const savedStrokes = useRef<Record<string, string>>({});
  const hydrated = useRef(false);
  // Latest values for callbacks that must not re-subscribe (page-close flush,
  // deck deletion, erase-and-restore ordering).
  const decksRef = useRef<Deck[]>(decks);
  const strokesRef = useRef<StrokesBySlide>(strokes);
  const settingsRef = useRef<StudioSettings>(settings);
  const activeDeckRef = useRef(activeDeckId);
  const activeSlideRef = useRef(activeSlideId);
  decksRef.current = decks;
  strokesRef.current = strokes;
  settingsRef.current = settings;
  activeDeckRef.current = activeDeckId;
  activeSlideRef.current = activeSlideId;

  /** The deck the person is looking at, read from the refs at call time. */
  const currentDeck = useCallback(
    () => decksRef.current.find((item) => item.id === activeDeckRef.current) ?? decksRef.current[0],
    [],
  );

  useEffect(() => subscribeStorage(setStorage), []);

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
            buildFingerprint: stored.sampleDeckBuildFingerprint,
            edited: stored.sampleDeckEdited,
          }, ink as StrokesBySlide);
          if (cancelled) return;
          setDecks(upgraded.decks);
          // Ink is keyed by slide id: anything that no longer belongs to a deck
          // (an upgraded sample's old slides, ink from a deck that is gone) is
          // not loaded back into the room.
          const liveIds = new Set(upgraded.decks.flatMap((item) => item.slides.map((entry) => entry.id)));
          const keptInk: StrokesBySlide = {};
          for (const [slideId, list] of Object.entries(ink)) {
            if (liveIds.has(slideId)) keptInk[slideId] = list as Stroke[];
          }
          // Files written before the build fingerprint existed cannot tell an
          // untouched sample from an edited one; the next save records both so
          // an edit made under this build is never upgraded away.
          const activeDeck = upgraded.decks.find((item) => item.id === stored.activeDeckId) ?? upgraded.decks[0];
          const keepSlide = activeDeck?.slides.some((item) => item.id === stored.activeSlideId);
          setActiveDeckId(activeDeck.id);
          setActiveSlideId(keepSlide ? stored.activeSlideId : activeDeck.slides[0]?.id ?? '');
          setSettingsState({ ...DEFAULT_SETTINGS, ...stored.settings });
          if (Object.keys(keptInk).length) {
            setStrokes(keptInk);
            for (const [slideId, list] of Object.entries(keptInk)) {
              savedStrokes.current[slideId] = JSON.stringify(list);
            }
          }
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
      void setWorkspace(makePersisted(decks, deck.id, slide?.id ?? '', settings));
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

  // Closing the tab or switching apps must not wait for the 350ms debounce:
  // write the newest workspace at once and let the pending ink writes finish.
  useEffect(() => {
    const flush = () => {
      if (!hydrated.current || !ready) return;
      const currentDecks = decksRef.current;
      if (!currentDecks.length) return;
      const currentDeck = currentDecks.find((item) => item.id === activeDeckRef.current) ?? currentDecks[0];
      void setWorkspace(makePersisted(
        currentDecks,
        currentDeck.id,
        activeSlideRef.current,
        settingsRef.current,
      ));
      void flushStorage();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ready]);

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

  /** Writes one exact state now, without waiting for the debounce. */
  const persistNow = useCallback((
    nextDecks: Deck[],
    nextActiveDeckId: string,
    nextActiveSlideId: string,
  ): Promise<void> => setWorkspace(
    makePersisted(nextDecks, nextActiveDeckId, nextActiveSlideId, settingsRef.current),
  ), []);

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

  const createNewDeck = useCallback((title = '새 덱', tags: string[] = []) => {
    const made = createDeck(title, [], tags);
    setDecks((prev) => [made, ...prev]);
    setActiveDeckId(made.id);
    setActiveSlideId(made.slides[0].id);
  }, []);

  const deleteDeck = useCallback((deckId: string) => {
    const current = decksRef.current;
    const target = current.find((item) => item.id === deckId);
    if (!target) return;
    const removedIds = deckSlideIds(target);
    const rest = current.filter((item) => item.id !== deckId);
    const nextDecks = rest.length ? rest : [createSampleDeck()];
    const nextDeck = nextDecks.find((item) => item.id === activeDeckRef.current) ?? nextDecks[0];
    const nextSlide = nextDeck.slides.some((item) => item.id === activeSlideRef.current)
      ? activeSlideRef.current
      : nextDeck.slides[0]?.id ?? '';

    setDecks(nextDecks);
    setActiveDeckId(nextDeck.id);
    setActiveSlideId(nextSlide);
    setStrokes((prev) => {
      if (!removedIds.some((id) => id in prev)) return prev;
      const next = { ...prev };
      for (const id of removedIds) delete next[id];
      return next;
    });
    for (const id of removedIds) delete savedStrokes.current[id];

    // The workspace goes first: a deck must never disappear from storage while
    // its ink is still listed under a deck that no longer exists. Then both the
    // memory map and IndexedDB lose the strokes.
    void persistNow(nextDecks, nextDeck.id, nextSlide)
      .then(() => Promise.all(removedIds.map((id) => deleteStrokes(id))));
  }, [persistNow]);

  const renameDeck = useCallback((title: string) => {
    if (!deck) return;
    patchDeck(deck.id, (item) => ({ ...item, title: title.trim() || item.title }));
  }, [deck, patchDeck]);

  const restoreSample = useCallback(() => {
    const sample = createSampleDeck();
    const previous = decksRef.current.find((item) => item.id === SAMPLE_DECK_ID);
    const staleIds = previous ? deckSlideIds(previous) : [];
    // One sample deck at a time: restore replaces the previous copy instead of
    // stacking a second deck with the same id — and drops the ink that belonged
    // to the copy being replaced.
    const nextDecks = [sample, ...decksRef.current.filter((item) => item.id !== sample.id)];
    setDecks(nextDecks);
    setActiveDeckId(sample.id);
    setActiveSlideId(sample.slides[0].id);
    setStrokes((prev) => {
      if (!staleIds.length) return prev;
      const next = { ...prev };
      for (const id of staleIds) delete next[id];
      return next;
    });
    for (const id of staleIds) delete savedStrokes.current[id];
    void persistNow(nextDecks, sample.id, sample.slides[0].id)
      .then(() => Promise.all(staleIds.map((id) => deleteStrokes(id))));
  }, [persistNow]);

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
    const current = currentDeck();
    if (!current) return;
    if (current.slides.length <= 1) return;
    const index = current.slides.findIndex((entry) => entry.id === slideId);
    if (index < 0) return;
    const nextSlides = current.slides.filter((entry) => entry.id !== slideId);
    const nextDecks = decksRef.current.map((item) =>
      (item.id === current.id ? { ...item, slides: nextSlides, updatedAt: Date.now() } : item));
    const nextSlide = slideId === activeSlideRef.current
      ? (nextSlides[Math.max(0, index - 1)] ?? nextSlides[0]).id
      : activeSlideRef.current;

    setDecks(nextDecks);
    setActiveSlideId(nextSlide);
    setStrokes((prev) => {
      if (!(slideId in prev)) return prev;
      const next = { ...prev };
      delete next[slideId];
      return next;
    });
    delete savedStrokes.current[slideId];

    void persistNow(nextDecks, current.id, nextSlide).then(() => deleteStrokes(slideId));
  }, [currentDeck, persistNow]);

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

  const addStrokeTo = useCallback((slideId: string, stroke: Stroke) => {
    const exists = decksRef.current.some((item) => item.slides.some((entry) => entry.id === slideId));
    // A slide deleted while the pen was down must not get its ink back as an
    // orphan record.
    if (!exists) return;
    setStrokes((prev) => ({ ...prev, [slideId]: [...(prev[slideId] ?? []), stroke] }));
  }, []);

  const addStroke = useCallback((stroke: Stroke) => {
    const target = activeSlideRef.current;
    if (target) addStrokeTo(target, stroke);
  }, [addStrokeTo]);

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

  /**
   * Replaces the whole room with a backup. Ink the backup does not carry is
   * removed, and the workspace, the restored ink and those removals land in one
   * transaction — so a refresh right afterwards shows exactly the restored
   * state instead of old strokes under new decks.
   */
  const replaceAll = useCallback((file: StudyFile) => {
    const nextDecks = file.decks;
    const nextStrokes = file.strokes ?? {};
    const nextActiveDeck = nextDecks.find((item) => item.id === file.activeDeckId) ?? nextDecks[0];
    const nextSlide = nextActiveDeck.slides[0]?.id ?? '';
    const targetIds = new Set(nextDecks.flatMap((item) => deckSlideIds(item)));
    const stale = [...new Set([...Object.keys(strokesRef.current), ...Object.keys(savedStrokes.current)])]
      .filter((id) => !targetIds.has(id));

    setDecks(nextDecks);
    setStrokes(nextStrokes);
    setActiveDeckId(nextActiveDeck.id);
    setActiveSlideId(nextSlide);

    const nextSaved: Record<string, string> = {};
    for (const [slideId, list] of Object.entries(nextStrokes)) {
      nextSaved[slideId] = JSON.stringify(list);
    }
    savedStrokes.current = nextSaved;

    void replaceWorkspace({
      workspace: makePersisted(nextDecks, nextActiveDeck.id, nextSlide, settingsRef.current),
      strokes: nextStrokes,
      removeStrokeIds: stale,
    }).then((ok) => {
      if (ok) return;
      // Storage refused the one-shot restore: let the normal save path retry
      // rather than leaving the screen claiming the backup was written.
      savedStrokes.current = {};
      return Promise.all(Object.entries(nextStrokes).map(([slideId, list]) => saveStrokes(slideId, list)))
        .then(() => undefined);
    });
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
    storage,
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
    addStrokeTo,
    undoStroke,
    clearInk,
    replaceAll,
    exportStudy,
    exportMarkdown,
  };
}

export { parseStudyFile };
