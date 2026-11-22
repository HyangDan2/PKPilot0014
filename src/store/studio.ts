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
  commitWorkspace, flushStorage, loadAllStrokes, readWorkspace, replaceWorkspace,
  setStrokes as saveStrokes, setWorkspace, storageStatus, subscribeStorage,
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

/** How a read of the stored workspace ended. */
export type StorageReadOutcome = 'adopted' | 'untouched' | 'empty' | 'failed' | 'kept';

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
  /** True while the stored workspace could not be read and saving is paused. */
  storageReadFailed: boolean;
  setSettings: (patch: Partial<StudioSettings>) => void;
  selectDeck: (deckId: string) => void;
  selectSlide: (slideId: string) => void;
  goSlide: (delta: number) => void;
  createNewDeck: (title?: string, tags?: string[]) => void;
  deleteDeck: (deckId: string) => Promise<boolean>;
  renameDeck: (title: string) => void;
  restoreSample: () => Promise<boolean>;
  importFromMarkdown: (text: string, filename?: string) => { slides: number; title: string };
  updateSlide: (patch: Partial<Pick<Slide, 'markdown' | 'note' | 'title' | 'status'>>) => void;
  toggleStatus: (slideId?: string) => void;
  addSlide: () => void;
  duplicateSlide: (slideId: string) => void;
  deleteSlide: (slideId: string) => Promise<boolean>;
  moveSlide: (slideId: string, delta: number) => void;
  moveSlideTo: (slideId: string, index: number) => void;
  setSummary: (text: string) => void;
  addStroke: (stroke: Stroke) => void;
  addStrokeTo: (slideId: string, stroke: Stroke) => void;
  undoStroke: () => void;
  clearInk: () => void;
  replaceAll: (file: StudyFile) => Promise<boolean>;
  /** Retries a failed workspace read; the room keeps its work when it cannot. */
  retryStorageRead: () => Promise<StorageReadOutcome>;
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

/** Runs in a plain function, so a pagehide can start it without React state. */
async function writeWorkspace(
  decks: Deck[],
  activeDeckId: string,
  activeSlideId: string,
  settings: StudioSettings,
): Promise<boolean> {
  return setWorkspace(makePersisted(decks, activeDeckId, activeSlideId, settings));
}

export function useStudio(): StudioApi {
  const [ready, setReady] = useState(false);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [activeDeckId, setActiveDeckId] = useState('');
  const [activeSlideId, setActiveSlideId] = useState('');
  const [strokes, setStrokes] = useState<StrokesBySlide>({});
  const [settings, setSettingsState] = useState<StudioSettings>(DEFAULT_SETTINGS);
  const [storage, setStorage] = useState<StorageStatus>(() => storageStatus());
  const [storageReadFailed, setStorageReadFailed] = useState(false);

  const savedStrokes = useRef<Record<string, string>>({});
  const hydrated = useRef(false);
  // Saving is paused while the stored workspace is unreadable: writing now
  // would overwrite decks with the in-memory fallback.
  const blocked = useRef(false);
  // What the room showed when the read failed — an untouched room may adopt
  // the stored workspace as soon as a retry succeeds.
  const blockedSnapshot = useRef<{ decks: Deck[]; strokes: StrokesBySlide } | null>(null);
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

  /** Puts a stored workspace on screen, ink included. */
  const adopt = useCallback((stored: Persisted, ink: Record<string, unknown>) => {
    const upgraded = upgradeSampleDecks(stored.decks, {
      version: stored.sampleDeckVersion,
      fingerprint: stored.sampleDeckFingerprint,
      buildFingerprint: stored.sampleDeckBuildFingerprint,
      edited: stored.sampleDeckEdited,
    }, ink as StrokesBySlide);
    setDecks(upgraded.decks);
    // Ink is keyed by slide id: anything that no longer belongs to a deck
    // (an upgraded sample's old slides, ink from a deck that is gone) is
    // not loaded back into the room.
    const liveIds = new Set(upgraded.decks.flatMap((item) => item.slides.map((entry) => entry.id)));
    const keptInk: StrokesBySlide = {};
    for (const [slideId, list] of Object.entries(ink)) {
      if (liveIds.has(slideId)) keptInk[slideId] = list as Stroke[];
    }
    const activeDeck = upgraded.decks.find((item) => item.id === stored.activeDeckId) ?? upgraded.decks[0];
    const keepSlide = activeDeck?.slides.some((item) => item.id === stored.activeSlideId);
    setActiveDeckId(activeDeck.id);
    setActiveSlideId(keepSlide ? stored.activeSlideId : activeDeck.slides[0]?.id ?? '');
    setSettingsState({ ...DEFAULT_SETTINGS, ...stored.settings });
    savedStrokes.current = {};
    if (Object.keys(keptInk).length) {
      setStrokes(keptInk);
      for (const [slideId, list] of Object.entries(keptInk)) {
        savedStrokes.current[slideId] = JSON.stringify(list);
      }
    } else {
      setStrokes({});
    }
  }, []);

  /** Tells another tab of this room that a write landed. */
  const announce = useCallback(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      const channel = new BroadcastChannel('slidedeck-room');
      channel.postMessage('saved');
      channel.close();
    } catch { /* another tab is a bonus, not a requirement */ }
  }, []);

  // The state that reached storage last, so a tab with nothing unsaved can
  // follow another tab's write instead of overwriting it with its own older
  // copy.
  const savedIdentity = useRef<{ decks: Deck[]; strokes: StrokesBySlide } | null>(null);

  // ── hydrate ────────────────────────────────────────────────────────────
  /**
   * Opens the room on a sample copy with saving paused. Used when the stored
   * workspace could not be read: showing the sample is fine, but writing it
   * would replace decks the person still has on disk.
   */
  const openPaused = useCallback(() => {
    const sample = createSampleDeck();
    const openedDecks: Deck[] = [sample];
    const openedStrokes: StrokesBySlide = {};
    blocked.current = true;
    setStorageReadFailed(true);
    setDecks(openedDecks);
    setActiveDeckId(sample.id);
    setActiveSlideId(sample.slides[0].id);
    setStrokes(openedStrokes);
    // The very objects on screen: retry compares identity to tell an untouched
    // room from one where the person already typed.
    blockedSnapshot.current = { decks: openedDecks, strokes: openedStrokes };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const read = await readWorkspace<Persisted>();
      if (cancelled) return;
      try {
        // A read that failed is not an empty store.
        if (!read.ok) {
          openPaused();
          return;
        }
        const stored = read.value;
        if (stored?.decks?.length) {
          const ids = stored.decks.flatMap((deck) => deck.slides.map((slide) => slide.id));
          const ink = await loadAllStrokes(ids);
          if (cancelled) return;
          // An untouched sample deck follows the current build; anything the
          // person edited (or drew on) is kept exactly as it is.
          adopt(stored, ink);
        } else {
          const sample = createSampleDeck();
          setDecks([sample]);
          setActiveDeckId(sample.id);
          setActiveSlideId(sample.slides[0].id);
        }
      } catch {
        // Loading broke partway through (ink included): same rule — the
        // sample may be shown, but it may not go over the stored workspace.
        if (!cancelled) openPaused();
      } finally {
        if (!cancelled) {
          hydrated.current = true;
          setReady(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [adopt, openPaused]);

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
    if (!hydrated.current || !ready || !deck || blocked.current) return;
    const timer = window.setTimeout(() => {
      if (blocked.current) return;
      const writtenDecks = decks;
      const writtenStrokes = strokesRef.current;
      void writeWorkspace(decks, deck.id, slide?.id ?? '', settings).then((ok) => {
        if (!ok) return;
        // Remember exactly which state reached storage: a room that still
        // holds this state has nothing to lose by following another tab.
        savedIdentity.current = { decks: writtenDecks, strokes: writtenStrokes };
        announce();
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [decks, settings, deck, slide, ready, announce]);

  useEffect(() => {
    if (blocked.current) return;
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
      if (!hydrated.current || !ready || blocked.current) return;
      const currentDecks = decksRef.current;
      if (!currentDecks.length) return;
      const currentDeck = currentDecks.find((item) => item.id === activeDeckRef.current) ?? currentDecks[0];
      void writeWorkspace(currentDecks, currentDeck.id, activeSlideRef.current, settingsRef.current);
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

  // ── the same room in another tab ───────────────────────────────────────
  const adoptLatest = useCallback(async () => {
    if (blocked.current || !hydrated.current) return;
    const last = savedIdentity.current;
    // Only a room with nothing typed since its last write follows the other
    // tab; local edits stay, even at the price of a later clobber.
    if (!last || last.decks !== decksRef.current || last.strokes !== strokesRef.current) return;
    const read = await readWorkspace<Persisted>();
    if (!read.ok || !read.value?.decks?.length || blocked.current) return;
    const stored = read.value;
    const mine = makePersisted(decksRef.current, activeDeckRef.current, activeSlideRef.current, settingsRef.current);
    if (JSON.stringify(stored.decks) === JSON.stringify(mine.decks)) return;
    const ids = stored.decks.flatMap((item) => item.slides.map((entry) => entry.id));
    const ink = await loadAllStrokes(ids);
    if (blocked.current) return;
    adopt(stored, ink);
  }, [adopt]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('slidedeck-room');
    channel.onmessage = () => { void adoptLatest(); };
    const onFocus = () => { void adoptLatest(); };
    window.addEventListener('focus', onFocus);
    return () => {
      channel.close();
      window.removeEventListener('focus', onFocus);
    };
  }, [adoptLatest]);

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

  const createNewDeck = useCallback((title = '새 덱', tags: string[] = []) => {
    const made = createDeck(title, [], tags);
    setDecks((prev) => [made, ...prev]);
    setActiveDeckId(made.id);
    setActiveSlideId(made.slides[0].id);
  }, []);

  /**
   * Removes a deck and its ink in one transaction. The screen follows the
   * transaction: it is put back exactly as it was when storage refused, so the
   * room never shows a deck gone while it is still on disk.
   */
  const deleteDeck = useCallback(async (deckId: string): Promise<boolean> => {
    const current = decksRef.current;
    const target = current.find((item) => item.id === deckId);
    if (!target) return false;
    // While the stored room is unreadable, nothing may be written over it.
    if (blocked.current) return false;
    const removedIds = deckSlideIds(target);
    const rest = current.filter((item) => item.id !== deckId);
    const nextDecks = rest.length ? rest : [createSampleDeck()];
    const nextDeck = nextDecks.find((item) => item.id === activeDeckRef.current) ?? nextDecks[0];
    const nextSlide = nextDeck.slides.some((item) => item.id === activeSlideRef.current)
      ? activeSlideRef.current
      : nextDeck.slides[0]?.id ?? '';
    const previousActiveDeck = activeDeckRef.current;
    const previousActiveSlide = activeSlideRef.current;
    const previousStrokes = strokesRef.current;

    setDecks(nextDecks);
    setActiveDeckId(nextDeck.id);
    setActiveSlideId(nextSlide);
    const nextStrokes: StrokesBySlide = { ...previousStrokes };
    for (const id of removedIds) delete nextStrokes[id];
    setStrokes(nextStrokes);

    const ok = await commitWorkspace({
      workspace: makePersisted(nextDecks, nextDeck.id, nextSlide, settingsRef.current),
      deleteStrokeIds: removedIds,
    });
    if (!ok) {
      setDecks(current);
      setActiveDeckId(previousActiveDeck);
      setActiveSlideId(previousActiveSlide);
      setStrokes(previousStrokes);
      return false;
    }
    for (const id of removedIds) delete savedStrokes.current[id];
    announce();
    return true;
  }, [announce]);

  const renameDeck = useCallback((title: string) => {
    if (!deck) return;
    patchDeck(deck.id, (item) => ({ ...item, title: title.trim() || item.title }));
  }, [deck, patchDeck]);

  const restoreSample = useCallback(async (): Promise<boolean> => {
    if (blocked.current) return false;
    const sample = createSampleDeck();
    const previous = decksRef.current.find((item) => item.id === SAMPLE_DECK_ID);
    const staleIds = previous ? deckSlideIds(previous) : [];
    // One sample deck at a time: restore replaces the previous copy instead of
    // stacking a second deck with the same id — and drops the ink that belonged
    // to the copy being replaced.
    const previousDecks = decksRef.current;
    const previousActiveDeck = activeDeckRef.current;
    const previousActiveSlide = activeSlideRef.current;
    const previousStrokes = strokesRef.current;
    const nextDecks = [sample, ...previousDecks.filter((item) => item.id !== sample.id)];
    setDecks(nextDecks);
    setActiveDeckId(sample.id);
    setActiveSlideId(sample.slides[0].id);
    const nextStrokes: StrokesBySlide = { ...previousStrokes };
    for (const id of staleIds) delete nextStrokes[id];
    setStrokes(nextStrokes);

    const ok = await commitWorkspace({
      workspace: makePersisted(nextDecks, sample.id, sample.slides[0].id, settingsRef.current),
      deleteStrokeIds: staleIds,
    });
    if (!ok) {
      setDecks(previousDecks);
      setActiveDeckId(previousActiveDeck);
      setActiveSlideId(previousActiveSlide);
      setStrokes(previousStrokes);
      return false;
    }
    for (const id of staleIds) delete savedStrokes.current[id];
    announce();
    return true;
  }, [announce]);

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

  /**
   * Removes a slide and its ink in one transaction. The screen follows the
   * transaction and is put back when storage refused it.
   */
  const deleteSlide = useCallback(async (slideId: string): Promise<boolean> => {
    const current = currentDeck();
    if (!current) return false;
    if (current.slides.length <= 1) return false;
    if (blocked.current) return false;
    const index = current.slides.findIndex((entry) => entry.id === slideId);
    if (index < 0) return false;
    const nextSlides = current.slides.filter((entry) => entry.id !== slideId);
    const nextDecks = decksRef.current.map((item) =>
      (item.id === current.id ? { ...item, slides: nextSlides, updatedAt: Date.now() } : item));
    const nextSlide = slideId === activeSlideRef.current
      ? (nextSlides[Math.max(0, index - 1)] ?? nextSlides[0]).id
      : activeSlideRef.current;
    const previousDecks = decksRef.current;
    const previousActiveSlide = activeSlideRef.current;
    const previousStrokes = strokesRef.current;

    setDecks(nextDecks);
    setActiveSlideId(nextSlide);
    const nextStrokes: StrokesBySlide = { ...previousStrokes };
    delete nextStrokes[slideId];
    setStrokes(nextStrokes);

    const ok = await commitWorkspace({
      workspace: makePersisted(nextDecks, current.id, nextSlide, settingsRef.current),
      deleteStrokeIds: [slideId],
    });
    if (!ok) {
      setDecks(previousDecks);
      setActiveSlideId(previousActiveSlide);
      setStrokes(previousStrokes);
      return false;
    }
    delete savedStrokes.current[slideId];
    announce();
    return true;
  }, [currentDeck, announce]);

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
   * Replaces the whole room with a backup. The workspace, the restored ink and
   * the clearing of every ink record the backup does not carry land in one
   * transaction — so a refresh right afterwards shows exactly the restored
   * state instead of old strokes under new decks. The screen is only left on
   * the restored deck when storage took it; the caller reports that outcome.
   */
  const replaceAll = useCallback(async (file: StudyFile): Promise<boolean> => {
    if (blocked.current) return false;
    const nextDecks = file.decks;
    const nextStrokes = file.strokes ?? {};
    const nextActiveDeck = nextDecks.find((item) => item.id === file.activeDeckId) ?? nextDecks[0];
    const nextSlide = nextActiveDeck.slides[0]?.id ?? '';
    const previousDecks = decksRef.current;
    const previousStrokes = strokesRef.current;
    const previousActiveDeck = activeDeckRef.current;
    const previousActiveSlide = activeSlideRef.current;
    const previousSaved = savedStrokes.current;

    setDecks(nextDecks);
    setStrokes(nextStrokes);
    setActiveDeckId(nextActiveDeck.id);
    setActiveSlideId(nextSlide);

    const nextSaved: Record<string, string> = {};
    for (const [slideId, list] of Object.entries(nextStrokes)) {
      nextSaved[slideId] = JSON.stringify(list);
    }
    savedStrokes.current = nextSaved;

    const ok = await replaceWorkspace({
      workspace: makePersisted(nextDecks, nextActiveDeck.id, nextSlide, settingsRef.current),
      strokes: nextStrokes,
    });
    if (!ok) {
      // Storage refused the restore: put the room back as it was rather than
      // showing a backup that is not on disk.
      setDecks(previousDecks);
      setStrokes(previousStrokes);
      setActiveDeckId(previousActiveDeck);
      setActiveSlideId(previousActiveSlide);
      savedStrokes.current = previousSaved;
      return false;
    }
    announce();
    return true;
  }, [announce]);

  /**
   * Retries a workspace read after it failed. An untouched room adopts the
   * stored workspace; a room where the person already typed keeps its work and
   * stays paused, so the two are never silently merged or overwritten.
   */
  const retryStorageRead = useCallback(async (): Promise<StorageReadOutcome> => {
    if (!blocked.current) return 'untouched';
    const read = await readWorkspace<Persisted>();
    if (!read.ok) return 'failed';
    const snapshot = blockedSnapshot.current;
    const untouched = snapshot !== null
      && decksRef.current === snapshot.decks
      && strokesRef.current === snapshot.strokes;
    if (!untouched) return 'kept';
    if (!read.value?.decks?.length) {
      // Nothing was stored after all: the sample on screen is the whole room.
      blocked.current = false;
      blockedSnapshot.current = null;
      setStorageReadFailed(false);
      hydrated.current = true;
      return 'empty';
    }
    const ids = read.value.decks.flatMap((item) => item.slides.map((entry) => entry.id));
    const ink = await loadAllStrokes(ids);
    adopt(read.value, ink);
    blocked.current = false;
    blockedSnapshot.current = null;
    setStorageReadFailed(false);
    return 'adopted';
  }, [adopt]);

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
    storageReadFailed,
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
    retryStorageRead,
    exportStudy,
    exportMarkdown,
  };
}

export { parseStudyFile };
