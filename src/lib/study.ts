import type {
  Deck, SplitMode, StudyFile, Stroke, StudyStatus, StrokesBySlide, InkPoint, Slide,
} from '../types/study';
import { INK_WIDTH } from '../types/study';
import { STATUS_ORDER } from '../types/study';
import { extractTags, deckTitleFrom, splitMarkdown } from './split';
import { normalizeTags } from './tags';

export function uid(prefix = 'id'): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${rand}`;
}

export function createSlide(markdown = '', note = '', title?: string): Slide {
  const clean = markdown.trim();
  return {
    id: uid('sl'),
    title: title || firstTitle(clean),
    markdown: clean,
    note,
    status: 'unlearned',
  };
}

function firstTitle(markdown: string): string {
  if (!markdown) return '새 슬라이드';
  const line = markdown.split('\n').find((l) => l.trim());
  if (!line) return '새 슬라이드';
  return line.replace(/^#{1,6}\s*/, '').replace(/[*_`~]/g, '').trim().slice(0, 80) || '새 슬라이드';
}

export function createDeck(title: string, slides: Slide[] = [], tags: string[] = []): Deck {
  const now = Date.now();
  return {
    id: uid('deck'),
    title: title || '새 덱',
    slides: slides.length ? slides : [createSlide('# 새 슬라이드\n\n여기에 학습 내용을 적어 보세요.')],
    summary: '',
    tags: normalizeTags(tags),
    createdAt: now,
    updatedAt: now,
  };
}

export function deckStats(deck: Deck): Record<StudyStatus, number> {
  const stats: Record<StudyStatus, number> = { unlearned: 0, review: 0, done: 0 };
  for (const slide of deck.slides) stats[slide.status] += 1;
  return stats;
}

export function cycleStatus(status: StudyStatus): StudyStatus {
  const index = STATUS_ORDER.indexOf(status);
  return STATUS_ORDER[(index + 1) % STATUS_ORDER.length];
}

/** Round-trips the whole study room through one JSON document. */
export function serializeStudy(input: {
  decks: Deck[];
  activeDeckId: string;
  strokes: StrokesBySlide;
}): string {
  const file: StudyFile = {
    format: 'saga-glitra-study',
    version: 1,
    app: 'SlideDeck',
    exportedAt: new Date().toISOString(),
    activeDeckId: input.activeDeckId,
    // Older decks carry no `tags`; every save writes the field so the file
    // itself documents the deck model.
    decks: input.decks.map((deck) => ({ ...deck, tags: normalizeTags(deck.tags) })),
    strokes: input.strokes,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

function normalizeStatus(value: unknown): StudyStatus {
  return value === 'review' || value === 'done' ? value : 'unlearned';
}

function normalizeSlide(raw: any): Slide {
  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : uid('sl'),
    title: typeof raw?.title === 'string' && raw.title ? raw.title : firstTitle(String(raw?.markdown ?? '')),
    markdown: typeof raw?.markdown === 'string' ? raw.markdown : '',
    note: typeof raw?.note === 'string' ? raw.note : '',
    status: normalizeStatus(raw?.status),
  };
}

function normalizeDeck(raw: any): Deck {
  const now = Date.now();
  const slides = Array.isArray(raw?.slides) ? raw.slides.map(normalizeSlide) : [];
  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : uid('deck'),
    title: typeof raw?.title === 'string' && raw.title ? raw.title : '가져온 덱',
    slides: slides.length ? slides : [createSlide('# 새 슬라이드\n\n여기에 학습 내용을 적어 보세요.')],
    summary: typeof raw?.summary === 'string' ? raw.summary : '',
    tags: normalizeTags(raw?.tags),
    createdAt: typeof raw?.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw?.updatedAt === 'number' ? raw.updatedAt : now,
  };
}

function normalizeStroke(raw: any, slideId: string): Stroke | null {
  if (!raw || !Array.isArray(raw.points) || raw.points.length === 0) return null;
  const points = raw.points
    .map(normalizePoint)
    .filter((point: InkPoint | null): point is InkPoint => point !== null);
  if (points.length === 0) return null;
  const tool = raw.tool === 'pen' ? 'pen' : 'highlighter';
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `${slideId}_${uid('st')}`,
    tool,
    color: typeof raw.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(raw.color) ? raw.color : '#f5c542',
    width: typeof raw.width === 'number' && Number.isFinite(raw.width) && raw.width > 0 && raw.width <= 64
      ? raw.width
      : INK_WIDTH[tool],
    points,
  };
}

/** Points are normalised 0–1; anything else is clamped so the stroke stays visible. */
function normalizePoint(raw: any): InkPoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

/** The format version this build can read. */
export const STUDY_VERSION = 1;

export function parseStudyFile(text: string): StudyFile {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('JSON을 읽을 수 없습니다. .study.json 백업 파일인지 확인하세요.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('백업 파일의 형식이 올바르지 않습니다.');
  }
  if (raw.format && raw.format !== 'saga-glitra-study') {
    throw new Error('SlideDeck 백업 파일(.study.json)이 아닙니다.');
  }
  if (raw.version !== undefined && raw.version !== null) {
    if (typeof raw.version !== 'number' || !Number.isFinite(raw.version) || raw.version < 1) {
      throw new Error('백업 파일의 버전 정보가 올바르지 않습니다.');
    }
    if (raw.version > STUDY_VERSION) {
      throw new Error(`이 백업은 더 새로운 버전(v${raw.version})입니다 — SlideDeck을 최신으로 연 뒤 복원하세요.`);
    }
  }
  if (!Array.isArray(raw.decks) || raw.decks.length === 0) {
    throw new Error('백업 파일에 덱이 없습니다.');
  }

  const decks: Deck[] = raw.decks.map(normalizeDeck);

  // Duplicate ids would make one ink record belong to two slides, so a file
  // carrying them is refused instead of restored into an ambiguous state.
  const deckIds = new Set<string>();
  const slideIds = new Set<string>();
  const duplicates: string[] = [];
  for (const deck of decks) {
    if (deckIds.has(deck.id)) duplicates.push(deck.id);
    else deckIds.add(deck.id);
    for (const slide of deck.slides) {
      if (slideIds.has(slide.id)) duplicates.push(slide.id);
      else slideIds.add(slide.id);
    }
  }
  if (duplicates.length) {
    const listed = [...new Set(duplicates)].slice(0, 3).join(', ');
    throw new Error(`백업 파일에 중복된 ID가 있습니다 (${listed}) — 파일이 손상되었습니다.`);
  }

  const strokes: StrokesBySlide = {};
  if (raw.strokes && typeof raw.strokes === 'object' && !Array.isArray(raw.strokes)) {
    for (const [slideId, list] of Object.entries<any>(raw.strokes)) {
      // Ink whose slide is not in this file would be written back as an orphan
      // record, so it is dropped with the restore target it lost.
      if (!slideIds.has(slideId)) continue;
      if (!Array.isArray(list)) continue;
      const clean = list.map((stroke) => normalizeStroke(stroke, slideId)).filter(Boolean) as Stroke[];
      if (clean.length) strokes[slideId] = clean;
    }
  }
  const activeDeckId = decks.some((deck) => deck.id === raw.activeDeckId)
    ? raw.activeDeckId
    : decks[0].id;

  return {
    format: 'saga-glitra-study',
    version: 1,
    app: 'SlideDeck',
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : new Date().toISOString(),
    activeDeckId,
    decks,
    strokes,
  };
}

export type NoteExportMode = 'comment' | 'quote' | 'none';

/** The deck as one `.md` file: `---` between slides, notes as comments. */
export function deckToMarkdown(deck: Deck, noteMode: NoteExportMode = 'comment'): string {
  const tags = normalizeTags(deck.tags);
  const head = [
    '---',
    `title: ${deck.title.replace(/"/g, "'")}`,
    ...(tags.length ? [`tags: [${tags.join(', ')}]`] : []),
    `slides: ${deck.slides.length}`,
    `exported: ${new Date().toISOString()}`,
    '---',
    '',
  ].join('\n');

  const body = deck.slides
    .map((slide) => {
      const parts = [slide.markdown.trim()];
      if (slide.note.trim() && noteMode !== 'none') {
        parts.push(
          noteMode === 'quote'
            ? `> **노트**\n>\n${slide.note.trim().split('\n').map((line) => `> ${line}`).join('\n')}`
            : `<!-- note:\n${slide.note.trim()}\n-->`,
        );
      }
      return parts.join('\n\n');
    })
    .join('\n\n---\n\n');

  return `${head}${body}\n`;
}

export interface ImportResult {
  title: string;
  /** Deck tags: the frontmatter `tags:` field, else `#해시태그` up top. */
  tags: string[];
  slides: { markdown: string; note: string; title: string }[];
}

export function importMarkdown(text: string, mode: SplitMode, filename = ''): ImportResult {
  const chunks = splitMarkdown(text, mode);
  if (chunks.length === 0) throw new Error('마크다운에서 슬라이드를 찾지 못했습니다.');
  const fallback = filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') || '가져온 덱';
  return { title: deckTitleFrom(text, fallback), tags: extractTags(text), slides: chunks };
}
