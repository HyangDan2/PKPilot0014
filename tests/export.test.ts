import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import {
  buildExportFiles, buildExportZip, deckNotesMarkdown, exportBaseName, exportFilename,
} from '../src/lib/exportBundle';
import { parseStudyFile } from '../src/lib/study';
import type { Deck, StrokesBySlide } from '../src/types/study';

function deck(): Deck {
  return {
    id: 'deck_test',
    title: '시험 대비 · 물리',
    summary: '덱 요약 — 공식 셋만 외우기',
    createdAt: 1,
    updatedAt: 2,
    slides: [
      { id: 'sl_1', title: '1장 운동', markdown: '## 1장 운동\n\n==가속도==', note: '첫 노트\n둘째 줄', status: 'review' },
      { id: 'sl_2', title: '2장 에너지', markdown: '## 2장 에너지\n\n$E=mc^2$', note: '', status: 'done' },
    ],
  };
}

const strokes: StrokesBySlide = {
  sl_1: [{ id: 'st_1', tool: 'highlighter', color: '#f5c542', width: 14, points: [{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.6 }] }],
};

const bundleInput = {
  deck: deck(),
  decks: [deck()],
  activeDeckId: 'deck_test',
  strokes,
};

describe('메모만 내보내기', () => {
  it('writes one section per slide with the deck summary at the end', () => {
    const md = deckNotesMarkdown(deck());
    expect(md.startsWith('---\ntitle: 시험 대비 · 물리 — 메모')).toBe(true);
    expect(md).toContain('## 01. 1장 운동');
    expect(md).toContain('첫 노트\n둘째 줄');
    expect(md).toContain('## 02. 2장 에너지');
    expect(md).toContain('_메모 없음_');
    expect(md).toContain('## 덱 전체 요약');
    expect(md).toContain('덱 요약 — 공식 셋만 외우기');
  });

  it('keeps slide bodies out of the notes sheet', () => {
    const md = deckNotesMarkdown(deck());
    expect(md).not.toContain('$E=mc^2$');
    expect(md).not.toContain('==가속도==');
  });
});

describe('ZIP 번들', () => {
  const files = buildExportFiles(bundleInput);

  it('carries slides, notes and the full backup as separate files', () => {
    expect(files.map((file) => file.name)).toEqual([
      '시험-대비-물리-slides.md',
      '시험-대비-물리-notes.md',
      '시험-대비-물리.study.json',
    ]);
  });

  it('writes a real ZIP with the three UTF-8 entries', () => {
    const zip = buildExportZip(bundleInput);
    // Local file header signature: PK\x03\x04
    expect([zip[0], zip[1], zip[2], zip[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const entries = unzipSync(zip);
    const names = Object.keys(entries);
    expect(names).toHaveLength(3);
    expect(names).toEqual(files.map((file) => file.name));

    const slides = strFromU8(entries['시험-대비-물리-slides.md']);
    expect(slides).toContain('## 1장 운동');
    expect(slides).toContain('\n\n---\n\n');
    expect(slides).not.toContain('첫 노트');

    const notes = strFromU8(entries['시험-대비-물리-notes.md']);
    expect(notes).toContain('첫 노트');
    expect(notes).toContain('## 02. 2장 에너지');
  });

  it('keeps the .study.json backup 100% restorable with ink intact', () => {
    const entries = unzipSync(buildExportZip(bundleInput));
    const raw = strFromU8(entries['시험-대비-물리.study.json']);
    const parsed = parseStudyFile(raw);
    expect(parsed.format).toBe('saga-glitra-study');
    expect(parsed.decks).toHaveLength(1);
    expect(parsed.decks[0].title).toBe('시험 대비 · 물리');
    expect(parsed.decks[0].slides[0].note).toBe('첫 노트\n둘째 줄');
    expect(parsed.decks[0].slides[0].status).toBe('review');
    expect(parsed.decks[0].summary).toContain('덱 요약');
    expect(parsed.strokes.sl_1).toHaveLength(1);
    expect(parsed.strokes.sl_1[0].points).toHaveLength(2);
  });

  it('always names the archive after the deck', () => {
    expect(exportBaseName(deck())).toBe('시험-대비-물리');
    expect(exportFilename('saga', 'zip')).toBe('saga.zip');
    expect(exportFilename('saga', 'combined')).toBe('saga-slides-notes.md');
    expect(exportFilename('saga', 'study')).toBe('saga.study.json');
    expect(exportFilename('saga', 'notes')).toBe('saga-notes.md');
    expect(exportFilename('saga', 'slides')).toBe('saga-slides.md');
  });
});
