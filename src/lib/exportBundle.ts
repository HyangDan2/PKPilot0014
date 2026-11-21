import { strToU8, zipSync } from 'fflate';
import type { Deck, StrokesBySlide } from '../types/study';
import { deckToMarkdown, serializeStudy } from './study';
import { safeFilename } from './files';

/** What the unified export modal can hand back. */
export type ExportKind = 'slides' | 'notes' | 'combined' | 'zip' | 'study';

export interface BundleInput {
  deck: Deck;
  decks: Deck[];
  activeDeckId: string;
  strokes: StrokesBySlide;
}

export interface BundleFile {
  name: string;
  text: string;
}

/** File-name stem shared by every export of one deck. */
export function exportBaseName(deck: Deck): string {
  return safeFilename(deck.title.replace(/[·・]/g, ' '));
}

/**
 * Notes only, one section per slide in deck order, then the deck summary.
 * Slide bodies are left out: this is the sheet you read before a test.
 */
export function deckNotesMarkdown(deck: Deck): string {
  const title = deck.title.replace(/"/g, "'");
  const head = [
    '---',
    `title: ${title} — 메모`,
    `slides: ${deck.slides.length}`,
    `exported: ${new Date().toISOString()}`,
    '---',
    '',
    `# ${deck.title} — 슬라이드 메모`,
    '',
  ].join('\n');

  const body = deck.slides
    .map((slide, index) => {
      const note = slide.note.trim() || '_메모 없음_';
      return `## ${String(index + 1).padStart(2, '0')}. ${slide.title || '제목 없는 슬라이드'}\n\n${note}`;
    })
    .join('\n\n');

  const summary = deck.summary.trim();
  const tail = summary ? `\n\n## 덱 전체 요약\n\n${summary}\n` : '\n';
  return `${head}${body}${tail}`;
}

/**
 * The three files a ZIP bundle carries, each one usable on its own:
 * slides, notes, and the full `.study.json` backup (decks · notes · ink).
 */
const ZIP_SUFFIXES = ['slides.md', 'notes.md', 'study.json'] as const;

export function buildExportFiles(input: BundleInput): BundleFile[] {
  const base = exportBaseName(input.deck);
  return [
    { name: `${base}-${ZIP_SUFFIXES[0]}`, text: deckToMarkdown(input.deck, 'none') },
    { name: `${base}-${ZIP_SUFFIXES[1]}`, text: deckNotesMarkdown(input.deck) },
    {
      name: `${base}.${ZIP_SUFFIXES[2]}`,
      text: serializeStudy({
        decks: input.decks,
        activeDeckId: input.activeDeckId,
        strokes: input.strokes,
      }),
    },
  ];
}

/** UTF-8 ZIP (deflate) with the bundle files, built fully in the browser. */
export function buildExportZip(input: BundleInput): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const file of buildExportFiles(input)) {
    entries[file.name] = strToU8(file.text);
  }
  return zipSync(entries, { level: 6 });
}

/** The extension each choice downloads as, for the modal preview. */
export const EXPORT_EXTENSION: Record<ExportKind, string> = {
  slides: '.md',
  notes: '.md',
  combined: '.md',
  zip: '.zip',
  study: '.study.json',
};

export function exportFilename(base: string, kind: ExportKind): string {
  if (kind === 'slides') return `${base}-slides.md`;
  if (kind === 'notes') return `${base}-notes.md`;
  if (kind === 'combined') return `${base}-slides-notes.md`;
  if (kind === 'zip') return `${base}.zip`;
  return `${base}.study.json`;
}
