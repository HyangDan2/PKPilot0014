import { describe, expect, it } from 'vitest';
import {
  createDeck, deckStats, deckToMarkdown, importMarkdown, parseStudyFile, serializeStudy,
} from '../src/lib/study';
import type { Deck } from '../src/types/study';

function sampleDeck(): Deck {
  const deck = createDeck('시험 대비', [
    { id: 'sl_a', title: '1장', markdown: '## 1장\n\n==핵심==', note: '첫 노트', status: 'review' },
    { id: 'sl_b', title: '2장', markdown: '## 2장\n\n$E=mc^2$', note: '', status: 'done' },
  ]);
  deck.summary = '덱 요약';
  return deck;
}

describe('study.json 직렬화', () => {
  it('round-trips decks, notes, statuses and strokes', () => {
    const deck = sampleDeck();
    const json = serializeStudy({
      decks: [deck],
      activeDeckId: deck.id,
      strokes: {
        sl_a: [{ id: 'st1', tool: 'highlighter', color: '#f5c542', width: 16, points: [{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.5 }] }],
      },
    });
    const parsed = parseStudyFile(json);
    expect(parsed.format).toBe('saga-glitra-study');
    expect(parsed.decks).toHaveLength(1);
    expect(parsed.decks[0].slides[1].note).toBe('');
    expect(parsed.decks[0].slides[0].status).toBe('review');
    expect(parsed.decks[0].summary).toBe('덱 요약');
    expect(parsed.strokes.sl_a[0].points).toHaveLength(2);
    expect(parsed.strokes.sl_a[0].tool).toBe('highlighter');
  });

  it('drops malformed strokes and repairs unknown statuses', () => {
    const json = JSON.stringify({
      format: 'saga-glitra-study',
      decks: [{ id: 'd', title: 't', slides: [{ id: 's', markdown: 'x', status: 'weird' }] }],
      strokes: { s: [{ points: [] }, { tool: 'pen', points: [{ x: 1, y: 2 }] }] },
      activeDeckId: 'nope',
    });
    const parsed = parseStudyFile(json);
    expect(parsed.decks[0].slides[0].status).toBe('unlearned');
    expect(parsed.strokes.s).toHaveLength(1);
    expect(parsed.activeDeckId).toBe('d');
  });

  it('refuses non-JSON and foreign files', () => {
    expect(() => parseStudyFile('not json')).toThrow(/JSON/);
    expect(() => parseStudyFile('{"format":"other","decks":[{"id":"1"}]}')).toThrow(/Sága Glitra/);
    expect(() => parseStudyFile('{"decks":[]}')).toThrow(/덱이 없습니다/);
  });
});

describe('markdown 내보내기', () => {
  it('separates slides with --- and writes notes as comments', () => {
    const md = deckToMarkdown(sampleDeck(), 'comment');
    expect(md.startsWith('---\ntitle: 시험 대비')).toBe(true);
    expect(md).toContain('\n\n---\n\n');
    expect(md).toContain('<!-- note:\n첫 노트\n-->');
  });

  it('can write notes as a quote block or drop them', () => {
    const quoted = deckToMarkdown(sampleDeck(), 'quote');
    expect(quoted).toContain('> **노트**');
    const none = deckToMarkdown(sampleDeck(), 'none');
    expect(none).not.toContain('첫 노트');
  });

  it('re-imports its own export with notes intact', () => {
    const md = deckToMarkdown(sampleDeck(), 'comment');
    const result = importMarkdown(md, 'hr', 'export.md');
    expect(result.slides).toHaveLength(2);
    expect(result.slides[0].note).toBe('첫 노트');
  });
});

describe('가져오기', () => {
  it('names the deck from frontmatter or heading', () => {
    const result = importMarkdown('---\ntitle: 가져온 이름\n---\n\n# A\n\n---\n\n# B', 'hr', 'x.md');
    expect(result.title).toBe('가져온 이름');
    expect(result.slides).toHaveLength(2);
  });

  it('falls back to the filename', () => {
    const result = importMarkdown('본문만 있음', 'hr', 'solid_state_notes.md');
    expect(result.title).toBe('solid state notes');
  });

  it('throws when there is nothing to import', () => {
    expect(() => importMarkdown('   \n\n', 'hr')).toThrow(/슬라이드/);
  });
});

describe('상태 통계', () => {
  it('counts each study status', () => {
    expect(deckStats(sampleDeck())).toEqual({ unlearned: 0, review: 1, done: 1 });
  });
});
