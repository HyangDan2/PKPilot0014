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
  /** Signature of the deck as it was written — the copy on disk. */
  storedFingerprint?: string;
  /** Signature of the shipped sample at the time it was written. */
  storedBuildFingerprint?: string;
  /** The copy was already different from the shipped sample when written. */
  storedEdited?: boolean;
  /** True when the person drew on any slide of this deck. */
  hasInk: boolean;
}

let buildSignature: string | null = null;
/**
 * Signature of the sample deck this build ships. Kept apart from the signature
 * of the copy on disk: a copy identical to this one is untouched and may be
 * refreshed, while any difference (a note, a status, a reworded line) marks a
 * deck the person made their own. Recording only one signature made every
 * edited copy look untouched on the next version bump and overwrote it.
 */
export function sampleBuildSignature(): string {
  buildSignature ??= sampleDeckSignature(createSampleDeck());
  return buildSignature;
}

/**
 * Should a stored sample deck be replaced with the current one?
 *
 * Only an untouched copy is refreshed: it must carry no ink, its id must still
 * be the sample's, and its content must equal the shipped sample recorded when
 * it was written. A deck flagged as edited — or one the shipped signature no
 * longer matches — is left alone, notes and study state included.
 */
export function shouldUpgradeSampleDeck({
  deck, storedVersion, storedFingerprint, storedBuildFingerprint, storedEdited, hasInk,
}: SampleUpgradeInput): boolean {
  if (hasInk) return false;
  const signature = sampleDeckSignature(deck);
  if (storedEdited) return false;
  if (storedVersion !== undefined) {
    if (storedVersion >= SAMPLE_VERSION) return false;
    if (deck.id !== SAMPLE_DECK_ID) return false;
    // Newer records carry the shipped signature separately; only a copy that
    // still matches it is untouched.
    if (storedBuildFingerprint !== undefined) return storedBuildFingerprint === signature;
    // Records written before that field existed compared the copy with itself,
    // so they can only tell an untouched copy by its old-sample content.
    return storedFingerprint === signature || signature === legacySampleSignature();
  }
  return signature === legacySampleSignature() || signature === sampleBuildSignature();
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
  meta: { version?: number; fingerprint?: string; buildFingerprint?: string; edited?: boolean },
  strokes: StrokesBySlide,
): SampleUpgradeResult {
  let upgraded = false;
  const next = decks.map((deck) => {
    const hasInk = deck.slides.some((slide) => (strokes[slide.id]?.length ?? 0) > 0);
    if (!shouldUpgradeSampleDeck({
      deck,
      storedVersion: meta.version,
      storedFingerprint: meta.fingerprint,
      storedBuildFingerprint: meta.buildFingerprint,
      storedEdited: meta.edited,
      hasInk,
    })) {
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
