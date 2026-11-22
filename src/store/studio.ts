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
  commitWorkspaceRevision, flushStorage, loadAllStrokes, readWorkspace, replaceWorkspaceRevision,
  setStrokeRevision, setWorkspaceRevision, storageStatus, subscribeStorage,
} from '../lib/db';
import type { RevisionResult, StorageStatus } from '../lib/db';
import {
  SAMPLE_DECK_ID, SAMPLE_VERSION, createSampleDeck, sampleBuildSignature, sampleDeckSignature,
  upgradeSampleDecks,
} from '../lib/sample';
import type { SavePhase, SaveState } from '../lib/saveStatus';
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

/** A write another tab landed first: the person has to say which copy stays. */
export interface EditConflict {
  area: 'workspace' | 'strokes';
  /** Which slide's ink clashes, for an ink conflict. */
  slideId?: string;
  title: string;
  storedRevision: number;
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
  /** True while the stored workspace could not be read and saving is paused. */
  storageReadFailed: boolean;
  /** Where saving stands in each area (워크스페이스 문서 / 필기). */
  saveState: SaveState;
  /** Set when another tab's write landed first; saving waits for a choice. */
  conflict: EditConflict | null;
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
  /** Retries the writes that failed (ink and workspace). */
  retrySave: () => Promise<boolean>;
  /** Settles a cross-tab conflict, keeping the stored copy or this tab's. */
  resolveConflict: (choice: 'stored' | 'local') => Promise<boolean>;
  exportStudy: () => string;
  exportMarkdown: (mode?: 'comment' | 'quote' | 'none') => string;
}

/** BroadcastChannel name for the same room in another tab. */
const CHANNEL = 'slidedeck-room';
/** How long one edit waits before the workspace is written. */
const SAVE_DEBOUNCE = 350;
/** An ink write is attempted this many times before the chip says 저장 실패. */
const MAX_SAVE_ATTEMPTS = 3;

function retryDelay(attempt: number): number {
  return Math.min(6000, 600 * 2 ** (attempt - 1));
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

interface SavedIdentity {
  decks: Deck[];
  strokes: StrokesBySlide;
  settings: StudioSettings;
  activeDeckId: string;
  activeSlideId: string;
}

interface PendingInk {
  /** The exact stroke list waiting for the store. */
  json: string;
  attempts: number;
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
  const [saveState, setSaveState] = useState<SaveState>({ workspace: 'idle', strokes: 'idle' });
  const [conflict, setConflict] = useState<EditConflict | null>(null);

  /** The stroke list each slide's record held when it was last confirmed. */
  const savedStrokes = useRef<Record<string, string>>({});
  /** The revision each slide's ink record carries (0 for a record without one). */
  const strokeRevisions = useRef<Record<string, number>>({});
  /** Ink that has changed and is not in the store yet, keyed by slide. */
  const pendingInk = useRef<Map<string, PendingInk>>(new Map());
  const inkInFlight = useRef<Set<string>>(new Set());
  const inkTimers = useRef<Map<string, number>>(new Map());
  /** The workspace revision this tab last read or wrote. */
  const workspaceRevision = useRef(0);
  const workspaceAttempts = useRef(0);
  const workspaceTimer = useRef(0);
  /** The last state that is known to be in the store, by identity. */
  const savedIdentity = useRef<SavedIdentity | null>(null);
  /** True while a backup restore is being committed: no ink write may run. */
  const restoreInFlight = useRef(false);
  const tabId = useRef<string>(Math.random().toString(36).slice(2));
  const conflictRef = useRef<EditConflict | null>(null);

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

  const setPhase = useCallback((area: keyof SaveState, phase: SavePhase) => {
    setSaveState((prev) => (prev[area] === phase ? prev : { ...prev, [area]: phase }));
  }, []);

  const markConflict = useCallback((next: EditConflict) => {
    conflictRef.current = next;
    setConflict(next);
  }, []);

  const clearConflict = useCallback(() => {
    conflictRef.current = null;
    setConflict(null);
  }, []);

  /**
   * Every write goes through one queue. A restore or a deletion and the
   * debounced autosave therefore reach IndexedDB in the order they were asked
   * for, never with the older state landing last.
   */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(task, task);
    queue.current = run.then(() => undefined, () => undefined);
    return run;
  }, []);

  /** Waits for every queued write, so a read after it sees the final state. */
  const settleWrites = useCallback(() => enqueue(() => Promise.resolve()), [enqueue]);

  /** The deck the person is looking at, read from the refs at call time. */
  const currentDeck = useCallback(
    () => decksRef.current.find((item) => item.id === activeDeckRef.current) ?? decksRef.current[0],
    [],
  );

  const slideTitleOf = useCallback((slideId?: string): string => {
    if (!slideId) return '강의 목록';
    for (const item of decksRef.current) {
      const found = item.slides.find((entry) => entry.id === slideId);
      if (found) return found.title || '슬라이드';
    }
    return '슬라이드';
  }, []);

  /** True while the room on screen is exactly what the store holds. */
  const stateIsSaved = useCallback((): boolean => {
    const last = savedIdentity.current;
    if (!last) return false;
    return last.decks === decksRef.current
      && last.strokes === strokesRef.current
      && last.settings === settingsRef.current
      && last.activeDeckId === activeDeckRef.current
      && last.activeSlideId === activeSlideRef.current;
  }, []);

  /** Drops an ink write that belongs to a slide this room just removed. */
  const dropPendingInk = useCallback((slideId: string) => {
    pendingInk.current.delete(slideId);
    const timer = inkTimers.current.get(slideId);
    if (timer !== undefined) window.clearTimeout(timer);
    inkTimers.current.delete(slideId);
    delete strokeRevisions.current[slideId];
    delete savedStrokes.current[slideId];
  }, []);

  const clearInkQueue = useCallback(() => {
    for (const timer of inkTimers.current.values()) window.clearTimeout(timer);
    inkTimers.current.clear();
    inkInFlight.current.clear();
    pendingInk.current.clear();
  }, []);

  useEffect(() => subscribeStorage(setStorage), []);

  /** Tells another tab of this room that a write landed. */
  const announce = useCallback((payload: { area: 'workspace' | 'strokes'; slideId?: string; revision: number }) => {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      const channel = new BroadcastChannel(CHANNEL);
      channel.postMessage({ type: 'saved', from: tabId.current, ...payload });
      channel.close();
    } catch { /* another tab is a bonus, not a requirement */ }
  }, []);

  /** Puts a stored workspace on screen, ink included. */
  const adopt = useCallback((
    stored: Persisted,
    ink: Record<string, Stroke[]>,
    revisions: Record<string, number>,
    storedRevision: number,
  ) => {
    const upgraded = upgradeSampleDecks(stored.decks, {
      version: stored.sampleDeckVersion,
      fingerprint: stored.sampleDeckFingerprint,
      buildFingerprint: stored.sampleDeckBuildFingerprint,
      edited: stored.sampleDeckEdited,
    }, ink);
    // Ink is keyed by slide id: anything that no longer belongs to a deck
    // (an upgraded sample's old slides, ink from a deck that is gone) is
    // not loaded back into the room.
    const liveIds = new Set(upgraded.decks.flatMap((item) => item.slides.map((entry) => entry.id)));
    const keptInk: StrokesBySlide = {};
    savedStrokes.current = {};
    const nextRevisions: Record<string, number> = {};
    for (const [slideId, list] of Object.entries(ink)) {
      if (!liveIds.has(slideId)) continue;
      keptInk[slideId] = list;
      savedStrokes.current[slideId] = JSON.stringify(list);
      nextRevisions[slideId] = revisions[slideId] ?? 0;
    }
    strokeRevisions.current = nextRevisions;
    // The stored copy replaces the room: nothing typed here is still waiting
    // for a write of its own.
    clearInkQueue();
    workspaceAttempts.current = 0;
    workspaceRevision.current = storedRevision;
    const activeDeck = upgraded.decks.find((item) => item.id === stored.activeDeckId) ?? upgraded.decks[0];
    const keepSlide = activeDeck?.slides.some((item) => item.id === stored.activeSlideId);
    const nextActiveSlide = keepSlide ? stored.activeSlideId : activeDeck.slides[0]?.id ?? '';
    const nextSettings = { ...DEFAULT_SETTINGS, ...stored.settings };
    setDecks(upgraded.decks);
    setActiveDeckId(activeDeck.id);
    setActiveSlideId(nextActiveSlide);
    setSettingsState(nextSettings);
    setStrokes(keptInk);
    // The room now shows the stored copy, by identity too: it must not
    // rewrite it just because it was loaded. A sample deck that the upgrade
    // replaced is the exception — that newer copy has to reach the store.
    savedIdentity.current = upgraded.upgraded
      ? null
      : {
        decks: upgraded.decks,
        strokes: keptInk,
        settings: nextSettings,
        activeDeckId: activeDeck.id,
        activeSlideId: nextActiveSlide,
      };
    setSaveState({
      workspace: upgraded.upgraded ? 'pending' : 'saved',
      strokes: 'saved',
    });
  }, [clearInkQueue]);

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
    setSaveState({ workspace: 'paused', strokes: 'paused' });
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
          const ink = await loadAllStrokes<Stroke>(ids);
          if (cancelled) return;
          // One ink record that could not be read is enough to hold the room
          // still: adopting the rest would show ink that is not there, and the
          // sample upgrade would judge the deck "untouched" from missing ink.
          if (!ink.ok) {
            openPaused();
            return;
          }
          // An untouched sample deck follows the current build; anything the
          // person edited (or drew on) is kept exactly as it is.
          adopt(stored, ink.strokes, ink.revisions, read.revision);
        } else {
          const sample = createSampleDeck();
          const opened = [sample];
          setDecks(opened);
          setActiveDeckId(sample.id);
          setActiveSlideId(sample.slides[0].id);
          savedIdentity.current = {
            decks: opened,
            strokes: {},
            settings: settingsRef.current,
            activeDeckId: sample.id,
            activeSlideId: sample.slides[0].id,
          };
          setSaveState({ workspace: 'saved', strokes: 'saved' });
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

  // ── ink: write after the transaction, retry what failed ────────────────
  const drainInkRef = useRef<(slideId: string) => void>(() => {});

  /**
   * Writes one slide's ink. The confirmed copy is remembered only once the
   * transaction has committed, so a refused write stays dirty and is retried
   * (or reported) instead of being taken as saved.
   */
  const drainInk = useCallback((slideId: string) => {
    if (!hydrated.current || blocked.current || conflictRef.current) return;
    if (inkInFlight.current.has(slideId)) return;
    const entry = pendingInk.current.get(slideId);
    if (!entry) return;
    const json = entry.json;
    inkInFlight.current.add(slideId);
    setPhase('strokes', pendingInk.current.size > 1 ? 'pending' : 'saving');
    void enqueue(async () => {
      let result: RevisionResult;
      try {
        result = await setStrokeRevision<Stroke>(
          slideId,
          JSON.parse(json) as Stroke[],
          strokeRevisions.current[slideId] ?? 0,
        );
      } catch {
        result = { ok: false, revision: strokeRevisions.current[slideId] ?? 0, error: 'write' };
      }
      inkInFlight.current.delete(slideId);
      const current = pendingInk.current.get(slideId);
      if (result.ok) {
        strokeRevisions.current[slideId] = result.revision;
        if (current && current.json === json) {
          pendingInk.current.delete(slideId);
          savedStrokes.current[slideId] = json;
        }
        announce({ area: 'strokes', slideId, revision: result.revision });
        if (pendingInk.current.size === 0) {
          setPhase('strokes', 'saved');
          // Every ink record the room shows is now stored: this tab is idle
          // again, so another tab's write may be followed instead of kept.
          if (savedIdentity.current) {
            savedIdentity.current = { ...savedIdentity.current, strokes: strokesRef.current };
          }
        }
        // A newer stroke landed while this one was in flight.
        if (current && current.json !== json) drainInkRef.current(slideId);
        return;
      }
      if (result.conflict) {
        // The other tab's ink is the stored copy now: this tab's list is not
        // put over it, and the person chooses which one stays.
        markConflict({
          area: 'strokes',
          slideId,
          title: slideTitleOf(slideId),
          storedRevision: result.revision,
        });
        setPhase('strokes', 'failed');
        return;
      }
      if (!current) return;
      current.attempts += 1;
      if (current.attempts >= MAX_SAVE_ATTEMPTS) {
        // Still dirty: a retry button or the next edit starts over.
        setPhase('strokes', 'failed');
        return;
      }
      setPhase('strokes', 'pending');
      const timer = inkTimers.current.get(slideId);
      if (timer !== undefined) window.clearTimeout(timer);
      inkTimers.current.set(slideId, window.setTimeout(() => {
        inkTimers.current.delete(slideId);
        drainInkRef.current(slideId);
      }, retryDelay(current.attempts)));
    });
  }, [announce, enqueue, markConflict, setPhase, slideTitleOf]);

  drainInkRef.current = drainInk;

  useEffect(() => {
    if (!hydrated.current || blocked.current || restoreInFlight.current) return;
    let changed = false;
    for (const [slideId, list] of Object.entries(strokes)) {
      const json = JSON.stringify(list);
      if (savedStrokes.current[slideId] === json) continue;
      const pending = pendingInk.current.get(slideId);
      if (pending && pending.json === json) continue;
      pendingInk.current.set(slideId, { json, attempts: pending?.attempts ?? 0 });
      changed = true;
    }
    if (!changed) return;
    setPhase('strokes', 'pending');
    for (const slideId of [...pendingInk.current.keys()]) drainInkRef.current(slideId);
  }, [strokes, setPhase]);

  // ── workspace: debounced write, one at a time, retried on failure ──────
  const writeWorkspaceNowRef = useRef<() => Promise<boolean>>(async () => false);

  const writeWorkspaceNow = useCallback(async (): Promise<boolean> => {
    if (!hydrated.current || blocked.current) return false;
    if (conflictRef.current) return false;
    const currentDecks = decksRef.current;
    if (!currentDecks.length) return false;
    if (stateIsSaved()) return true;
    const currentDeck = currentDecks.find((item) => item.id === activeDeckRef.current) ?? currentDecks[0];
    const writtenDecks = currentDecks;
    const writtenStrokes = strokesRef.current;
    const writtenSettings = settingsRef.current;
    const writtenSlide = activeSlideRef.current;
    setPhase('workspace', 'saving');
    const result = await enqueue(() => setWorkspaceRevision(
      makePersisted(writtenDecks, currentDeck.id, writtenSlide, writtenSettings),
      workspaceRevision.current,
    ));
    if (result.ok) {
      workspaceRevision.current = result.revision;
      workspaceAttempts.current = 0;
      savedIdentity.current = {
        decks: writtenDecks,
        strokes: writtenStrokes,
        settings: writtenSettings,
        activeDeckId: currentDeck.id,
        activeSlideId: writtenSlide,
      };
      if (!conflictRef.current) setPhase('workspace', 'saved');
      announce({ area: 'workspace', revision: result.revision });
      return true;
    }
    if (result.conflict) {
      markConflict({ area: 'workspace', title: '강의 목록', storedRevision: result.revision });
      setPhase('workspace', 'failed');
      return false;
    }
    workspaceAttempts.current += 1;
    if (workspaceAttempts.current >= MAX_SAVE_ATTEMPTS) {
      setPhase('workspace', 'failed');
      return false;
    }
    setPhase('workspace', 'pending');
    window.clearTimeout(workspaceTimer.current);
    workspaceTimer.current = window.setTimeout(() => {
      void writeWorkspaceNowRef.current();
    }, retryDelay(workspaceAttempts.current));
    return false;
  }, [announce, enqueue, markConflict, setPhase, stateIsSaved]);

  writeWorkspaceNowRef.current = writeWorkspaceNow;

  useEffect(() => {
    if (!hydrated.current || !ready || !deck || blocked.current) return;
    if (conflictRef.current) return;
    if (stateIsSaved()) return;
    setPhase('workspace', 'pending');
    const timer = window.setTimeout(() => {
      void writeWorkspaceNowRef.current();
    }, SAVE_DEBOUNCE);
    return () => window.clearTimeout(timer);
  }, [decks, settings, deck, slide, ready, setPhase, stateIsSaved]);

  // Closing the tab or switching apps must not wait for the 350ms debounce:
  // write the newest workspace at once and let the pending ink writes finish.
  useEffect(() => {
    const flush = () => {
      if (!hydrated.current || !ready || blocked.current) return;
      const currentDecks = decksRef.current;
      if (!currentDecks.length) return;
      const currentDeck = currentDecks.find((item) => item.id === activeDeckRef.current) ?? currentDecks[0];
      // The page can die before a queued task runs, so the newest workspace and
      // ink are written from this event itself: the transaction is created in
      // the same task, which is what survives an unload.
      if (!stateIsSaved()) {
        void setWorkspaceRevision(
          makePersisted(currentDecks, currentDeck.id, activeSlideRef.current, settingsRef.current),
          workspaceRevision.current,
        );
      }
      for (const [slideId, entry] of pendingInk.current) {
        void setStrokeRevision<Stroke>(
          slideId,
          JSON.parse(entry.json) as Stroke[],
          strokeRevisions.current[slideId] ?? 0,
        );
      }
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
  }, [ready, stateIsSaved]);

  // ── the same room in another tab ───────────────────────────────────────
  const adoptLatest = useCallback(async (): Promise<boolean> => {
    if (blocked.current || !hydrated.current || conflictRef.current) return false;
    // Only a room with nothing typed since its last write follows the other
    // tab; local edits stay, and the revision check stops a later save from
    // quietly covering what the other tab wrote.
    if (!stateIsSaved()) return false;
    // A write still in flight would land after this read; wait for it so the
    // comparison below is against the state the store will actually hold.
    await settleWrites();
    const read = await readWorkspace<Persisted>();
    if (!read.ok || !read.value?.decks?.length || blocked.current) return false;
    const stored = read.value;
    const storedRevision = read.revision;
    const ids = stored.decks.flatMap((item) => item.slides.map((entry) => entry.id));
    const ink = await loadAllStrokes<Stroke>(ids);
    if (!ink.ok || blocked.current) return false;
    const inkChanged = ids.some((id) => (ink.revisions[id] ?? 0) !== (strokeRevisions.current[id] ?? 0));
    if (storedRevision === workspaceRevision.current && !inkChanged) return false;
    adopt(stored, ink.strokes, ink.revisions, storedRevision);
    return true;
  }, [adopt, settleWrites, stateIsSaved]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; from?: string; area?: 'workspace' | 'strokes'; slideId?: string; revision?: number }
        | undefined;
      if (!data || data.type !== 'saved' || data.from === tabId.current) return;
      if (data.area === 'strokes' && data.slideId) {
        const waiting = pendingInk.current.has(data.slideId);
        const base = strokeRevisions.current[data.slideId] ?? 0;
        // This tab has ink for that slide that is not stored yet, and the
        // other tab already moved the record on: neither copy is thrown away.
        if (waiting && (data.revision ?? 0) > base && !inkInFlight.current.has(data.slideId)) {
          markConflict({
            area: 'strokes',
            slideId: data.slideId,
            title: slideTitleOf(data.slideId),
            storedRevision: data.revision ?? base,
          });
          setPhase('strokes', 'failed');
          return;
        }
        // Nothing unsaved here: the other tab's ink is the newest copy.
        void adoptLatest();
        return;
      }
      void adoptLatest();
    };
    const onFocus = () => { void adoptLatest(); };
    window.addEventListener('focus', onFocus);
    return () => {
      channel.close();
      window.removeEventListener('focus', onFocus);
    };
  }, [adoptLatest, markConflict, setPhase, slideTitleOf]);

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
    if (blocked.current || conflictRef.current) return false;
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

    const result = await enqueue(() => commitWorkspaceRevision({
      workspace: makePersisted(nextDecks, nextDeck.id, nextSlide, settingsRef.current),
      deleteStrokeIds: removedIds,
    }, workspaceRevision.current));
    if (!result.ok) {
      setDecks(current);
      setActiveDeckId(previousActiveDeck);
      setActiveSlideId(previousActiveSlide);
      setStrokes(previousStrokes);
      if (result.conflict) {
        markConflict({ area: 'workspace', title: '강의 목록', storedRevision: result.revision });
      } else {
        setPhase('workspace', 'failed');
      }
      return false;
    }
    workspaceRevision.current = result.revision;
    for (const id of removedIds) dropPendingInk(id);
    savedIdentity.current = {
      decks: nextDecks,
      strokes: nextStrokes,
      settings: settingsRef.current,
      activeDeckId: nextDeck.id,
      activeSlideId: nextSlide,
    };
    setPhase('workspace', 'saved');
    announce({ area: 'workspace', revision: result.revision });
    return true;
  }, [announce, dropPendingInk, enqueue, markConflict, setPhase]);

  const renameDeck = useCallback((title: string) => {
    if (!deck) return;
    patchDeck(deck.id, (item) => ({ ...item, title: title.trim() || item.title }));
  }, [deck, patchDeck]);

  const restoreSample = useCallback(async (): Promise<boolean> => {
    if (blocked.current || conflictRef.current) return false;
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

    const result = await enqueue(() => commitWorkspaceRevision({
      workspace: makePersisted(nextDecks, sample.id, sample.slides[0].id, settingsRef.current),
      deleteStrokeIds: staleIds,
    }, workspaceRevision.current));
    if (!result.ok) {
      setDecks(previousDecks);
      setActiveDeckId(previousActiveDeck);
      setActiveSlideId(previousActiveSlide);
      setStrokes(previousStrokes);
      if (result.conflict) {
        markConflict({ area: 'workspace', title: '강의 목록', storedRevision: result.revision });
      } else {
        setPhase('workspace', 'failed');
      }
      return false;
    }
    workspaceRevision.current = result.revision;
    for (const id of staleIds) dropPendingInk(id);
    savedIdentity.current = {
      decks: nextDecks,
      strokes: nextStrokes,
      settings: settingsRef.current,
      activeDeckId: sample.id,
      activeSlideId: sample.slides[0].id,
    };
    setPhase('workspace', 'saved');
    announce({ area: 'workspace', revision: result.revision });
    return true;
  }, [announce, dropPendingInk, enqueue, markConflict, setPhase]);

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
        entry.id === target ? { ...entry, status: cycleStatus(entry.status) } : entry,
      ),
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
    if (blocked.current || conflictRef.current) return false;
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

    const result = await enqueue(() => commitWorkspaceRevision({
      workspace: makePersisted(nextDecks, current.id, nextSlide, settingsRef.current),
      deleteStrokeIds: [slideId],
    }, workspaceRevision.current));
    if (!result.ok) {
      setDecks(previousDecks);
      setActiveSlideId(previousActiveSlide);
      setStrokes(previousStrokes);
      if (result.conflict) {
        markConflict({ area: 'workspace', title: '강의 목록', storedRevision: result.revision });
      } else {
        setPhase('workspace', 'failed');
      }
      return false;
    }
    workspaceRevision.current = result.revision;
    dropPendingInk(slideId);
    savedIdentity.current = {
      decks: nextDecks,
      strokes: nextStrokes,
      settings: settingsRef.current,
      activeDeckId: current.id,
      activeSlideId: nextSlide,
    };
    setPhase('workspace', 'saved');
    announce({ area: 'workspace', revision: result.revision });
    return true;
  }, [announce, currentDeck, dropPendingInk, enqueue, markConflict, setPhase]);

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
    if (blocked.current || conflictRef.current) return false;
    const nextDecks = file.decks;
    const nextStrokes = file.strokes ?? {};
    const nextActiveDeck = nextDecks.find((item) => item.id === file.activeDeckId) ?? nextDecks[0];
    const nextSlide = nextActiveDeck.slides[0]?.id ?? '';
    const previousDecks = decksRef.current;
    const previousStrokes = strokesRef.current;
    const previousActiveDeck = activeDeckRef.current;
    const previousActiveSlide = activeSlideRef.current;
    const previousSaved = savedStrokes.current;
    const previousRevisions = strokeRevisions.current;

    setDecks(nextDecks);
    setStrokes(nextStrokes);
    setActiveDeckId(nextActiveDeck.id);
    setActiveSlideId(nextSlide);

    // The backup's ink is what the store will hold: nothing typed here may be
    // written after the restore and put an old stroke back.
    clearInkQueue();
    restoreInFlight.current = true;
    const nextSaved: Record<string, string> = {};
    const nextRevisions: Record<string, number> = {};
    for (const [slideId, list] of Object.entries(nextStrokes)) {
      nextSaved[slideId] = JSON.stringify(list);
      nextRevisions[slideId] = 1;
    }

    const result = await enqueue(() => replaceWorkspaceRevision({
      workspace: makePersisted(nextDecks, nextActiveDeck.id, nextSlide, settingsRef.current),
      strokes: nextStrokes,
    }, workspaceRevision.current));
    restoreInFlight.current = false;
    if (!result.ok) {
      // Storage refused the restore: put the room back as it was rather than
      // showing a backup that is not on disk.
      setDecks(previousDecks);
      setStrokes(previousStrokes);
      setActiveDeckId(previousActiveDeck);
      setActiveSlideId(previousActiveSlide);
      savedStrokes.current = previousSaved;
      strokeRevisions.current = previousRevisions;
      if (result.conflict) {
        markConflict({ area: 'workspace', title: '강의 목록', storedRevision: result.revision });
      } else {
        setPhase('workspace', 'failed');
      }
      return false;
    }
    // Committed: only now is the backup's ink the confirmed copy. A restore
    // writes each slide's record fresh, so every revision starts at 1.
    savedStrokes.current = nextSaved;
    strokeRevisions.current = nextRevisions;
    workspaceRevision.current = result.revision;
    savedIdentity.current = {
      decks: nextDecks,
      strokes: nextStrokes,
      settings: settingsRef.current,
      activeDeckId: nextActiveDeck.id,
      activeSlideId: nextSlide,
    };
    setSaveState({ workspace: 'saved', strokes: 'saved' });
    announce({ area: 'workspace', revision: result.revision });
    return true;
  }, [announce, clearInkQueue, enqueue, markConflict, setPhase]);

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
      savedIdentity.current = {
        decks: decksRef.current,
        strokes: strokesRef.current,
        settings: settingsRef.current,
        activeDeckId: activeDeckRef.current,
        activeSlideId: activeSlideRef.current,
      };
      setSaveState({ workspace: 'saved', strokes: 'saved' });
      return 'empty';
    }
    const ids = read.value.decks.flatMap((item) => item.slides.map((entry) => entry.id));
    const ink = await loadAllStrokes<Stroke>(ids);
    if (!ink.ok) return 'failed';
    adopt(read.value, ink.strokes, ink.revisions, read.revision);
    blocked.current = false;
    blockedSnapshot.current = null;
    setStorageReadFailed(false);
    return 'adopted';
  }, [adopt]);

  /** Retries the ink and workspace writes that failed. */
  const retrySave = useCallback(async (): Promise<boolean> => {
    if (blocked.current || conflictRef.current) return false;
    workspaceAttempts.current = 0;
    for (const [slideId, entry] of pendingInk.current) {
      entry.attempts = 0;
      const timer = inkTimers.current.get(slideId);
      if (timer !== undefined) window.clearTimeout(timer);
      inkTimers.current.delete(slideId);
    }
    if (pendingInk.current.size) setPhase('strokes', 'pending');
    for (const slideId of [...pendingInk.current.keys()]) drainInkRef.current(slideId);
    const ok = await writeWorkspaceNowRef.current();
    return ok && pendingInk.current.size === 0;
  }, [setPhase]);

  /**
   * Settles a cross-tab conflict. `stored` follows the other tab's copy; `local`
   * writes this tab's copy over it — both are the person's explicit choice, so
   * neither loses the work silently.
   */
  const resolveConflict = useCallback(async (choice: 'stored' | 'local'): Promise<boolean> => {
    const active = conflictRef.current;
    if (!active) return false;
    if (choice === 'stored') {
      await settleWrites();
      const read = await readWorkspace<Persisted>();
      if (!read.ok || !read.value?.decks?.length) return false;
      const ids = read.value.decks.flatMap((item) => item.slides.map((entry) => entry.id));
      const ink = await loadAllStrokes<Stroke>(ids);
      if (!ink.ok) return false;
      adopt(read.value, ink.strokes, ink.revisions, read.revision);
      clearConflict();
      return true;
    }
    if (active.area === 'strokes' && active.slideId) {
      const slideId = active.slideId;
      const json = pendingInk.current.get(slideId)?.json ?? savedStrokes.current[slideId];
      if (!json) {
        clearConflict();
        return false;
      }
      const result = await enqueue(() => setStrokeRevision<Stroke>(
        slideId,
        JSON.parse(json) as Stroke[],
        active.storedRevision,
      ));
      if (!result.ok) {
        setPhase('strokes', 'failed');
        return false;
      }
      strokeRevisions.current[slideId] = result.revision;
      pendingInk.current.delete(slideId);
      savedStrokes.current[slideId] = json;
      clearConflict();
      if (pendingInk.current.size === 0) setPhase('strokes', 'saved');
      announce({ area: 'strokes', slideId, revision: result.revision });
      for (const id of [...pendingInk.current.keys()]) drainInkRef.current(id);
      return true;
    }
    const currentDecks = decksRef.current;
    const currentDeck = currentDecks.find((item) => item.id === activeDeckRef.current) ?? currentDecks[0];
    const writtenSettings = settingsRef.current;
    const writtenSlide = activeSlideRef.current;
    const result = await enqueue(() => setWorkspaceRevision(
      makePersisted(currentDecks, currentDeck.id, writtenSlide, writtenSettings),
      active.storedRevision,
    ));
    if (!result.ok) {
      setPhase('workspace', 'failed');
      return false;
    }
    workspaceRevision.current = result.revision;
    savedIdentity.current = {
      decks: currentDecks,
      strokes: strokesRef.current,
      settings: writtenSettings,
      activeDeckId: currentDeck.id,
      activeSlideId: writtenSlide,
    };
    clearConflict();
    setPhase('workspace', 'saved');
    announce({ area: 'workspace', revision: result.revision });
    for (const id of [...pendingInk.current.keys()]) drainInkRef.current(id);
    return true;
  }, [adopt, announce, clearConflict, enqueue, setPhase, settleWrites]);

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
    saveState,
    conflict,
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
    retrySave,
    resolveConflict,
    exportStudy,
    exportMarkdown,
  };
}

export { parseStudyFile };
