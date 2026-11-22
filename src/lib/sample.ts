import { createDeck, createSlide } from './study';
import { splitMarkdown } from './split';
import type { Deck, StrokesBySlide } from '../types/study';
import SAMPLE from './sample-deck.md?raw';
import LEGACY_SAMPLE_V1 from './sample-deck-v1.md?raw';

/**
 * The first screen is never empty: five Korean slides that are also the
 * manual — a slim welcome, math, code, a mermaid map, and masked recall.
 *
 * The welcome slide stays two short lines on purpose: the full manual lives
 * behind `⋮ → 사용법`, so a phone's first screen shows the whole slide instead
 * of a wall of usage copy. The deck text itself sits in `sample-deck.md` so the
 * markdown stays readable and unescaped.
 */
export const SAMPLE_DECK_ID = 'sample-saga-glitra';
export const SAMPLE_DECK_TITLE = 'SlideDeck 시작 덱';
/** Bump when the sample deck's content changes, so untouched copies refresh.
 *  3 — the Sága Glitra → SlideDeck rename: copies stored at v2 carry the old
 *  deck title, so they follow the current build even though their ids and
 *  saved files stay compatible. */
export const SAMPLE_VERSION = 3;

export const SAMPLE_DECK_SUMMARY =
  '이 덱은 사용법입니다. 슬라이드마다 붙은 노트를 읽고, ==가림막==을 눌러 복습하세요. ' +
  '덱 전체를 한 장으로 정리할 때는 이 탭에 적으면 됩니다.';

/** Content signature of a deck, ignoring ids and timestamps. */
export function sampleDeckSignature(deck: Pick<Deck, 'title' | 'summary' | 'slides'>): string {
  return JSON.stringify([
    deck.title,
    deck.summary,
    deck.slides.map((slide) => [slide.title, slide.markdown, slide.note, slide.status]),
  ]);
}

function buildSample(source: string, id: string): Deck {
  const chunks = splitMarkdown(source, 'hr');
  const slides = chunks.map((chunk) => createSlide(chunk.markdown, chunk.note, chunk.title));
  const deck = createDeck(SAMPLE_DECK_TITLE, slides);
  deck.id = id;
  deck.summary = SAMPLE_DECK_SUMMARY;
  return deck;
}

export function createSampleDeck(): Deck {
  return buildSample(SAMPLE, SAMPLE_DECK_ID);
}

let legacySignature: string | null = null;
/**
 * The welcome slide before v2, kept only as a signature: a stored deck still
 * holding exactly this content (and no ink) is an untouched copy we may
 * refresh. Anything a person changed no longer matches, so it is never touched.
 */
function legacySampleSignature(): string {
  legacySignature ??= sampleDeckSignature(buildSample(LEGACY_SAMPLE_V1, 'sample-legacy'));
  return legacySignature;
}

export interface SampleUpgradeInput {
  deck: Deck;
  /** Version recorded with the stored workspace, when it has one. */
  storedVersion?: number;
  /** Signature recorded when the stored sample was written. */
  storedFingerprint?: string;
  /** True when the person drew on any slide of this deck. */
  hasInk: boolean;
}

/**
 * Should a stored sample deck be replaced with the current one?
 *
 * Only an untouched copy is refreshed: it must carry no ink and its content
 * must still match what was written (the recorded fingerprint), or — for a
 * deck stored before version tracking — the exact original sample content.
 * A deck the person edited never matches, so it is left alone.
 */
export function shouldUpgradeSampleDeck({
  deck, storedVersion, storedFingerprint, hasInk,
}: SampleUpgradeInput): boolean {
  if (hasInk) return false;
  const signature = sampleDeckSignature(deck);
  if (storedVersion !== undefined) {
    if (storedVersion >= SAMPLE_VERSION) return false;
    if (deck.id !== SAMPLE_DECK_ID) return false;
    return storedFingerprint === signature;
  }
  return signature === legacySampleSignature();
}

export interface SampleUpgradeResult {
  decks: Deck[];
  upgraded: boolean;
}

/**
 * Applies {@link shouldUpgradeSampleDeck} across a stored workspace: an
 * untouched sample deck is swapped for the current one, everything else stays
 * exactly as the person left it.
 */
export function upgradeSampleDecks(
  decks: Deck[],
  meta: { version?: number; fingerprint?: string },
  strokes: StrokesBySlide,
): SampleUpgradeResult {
  let upgraded = false;
  const next = decks.map((deck) => {
    const hasInk = deck.slides.some((slide) => (strokes[slide.id]?.length ?? 0) > 0);
    if (!shouldUpgradeSampleDeck({ deck, storedVersion: meta.version, storedFingerprint: meta.fingerprint, hasInk })) {
      return deck;
    }
    upgraded = true;
    const fresh = createSampleDeck();
    return { ...fresh, createdAt: deck.createdAt };
  });
  return { decks: next, upgraded };
}

/** The sample deck's markdown, for tests and previews. */
export const SAMPLE_MARKDOWN: string = SAMPLE;
export const LEGACY_SAMPLE_MARKDOWN: string = LEGACY_SAMPLE_V1;
