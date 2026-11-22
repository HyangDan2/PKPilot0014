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
    expect(() => parseStudyFile('{"format":"other","decks":[{"id":"1"}]}')).toThrow(/SlideDeck/);
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

describe('백업 검증 강화', () => {
  const base = {
    format: 'saga-glitra-study',
    version: 1,
    decks: [{ id: 'deck_a', title: '덱', slides: [{ id: 'sl_a', markdown: '# 1', note: '', status: 'unlearned' }] }],
    activeDeckId: 'deck_a',
  };

  it('더 새로운 버전의 백업은 복원하지 않는다', () => {
    expect(() => parseStudyFile(JSON.stringify({ ...base, version: 2 })))
      .toThrow(/더 새로운 버전/);
  });

  it('버전 값이 망가진 파일은 거절한다', () => {
    expect(() => parseStudyFile(JSON.stringify({ ...base, version: 'one' }))).toThrow(/버전/);
    expect(() => parseStudyFile(JSON.stringify({ ...base, version: 0 }))).toThrow(/버전/);
  });

  it('중복된 슬라이드 ID를 가진 백업은 거절한다', () => {
    const decks = [
      { id: 'd1', title: 'A', slides: [{ id: 'same', markdown: 'x', note: '', status: 'unlearned' }] },
      { id: 'd2', title: 'B', slides: [{ id: 'same', markdown: 'y', note: '', status: 'unlearned' }] },
    ];
    expect(() => parseStudyFile(JSON.stringify({ ...base, decks }))).toThrow(/중복된 ID/);
  });

  it('중복된 덱 ID도 거절한다', () => {
    const decks = [
      { id: 'same', title: 'A', slides: [{ id: 's1', markdown: 'x', note: '', status: 'unlearned' }] },
      { id: 'same', title: 'B', slides: [{ id: 's2', markdown: 'y', note: '', status: 'unlearned' }] },
    ];
    expect(() => parseStudyFile(JSON.stringify({ ...base, decks }))).toThrow(/중복된 ID/);
  });

  it('덱에 없는 슬라이드의 필기는 복원 대상에서 뺀다', () => {
    const parsed = parseStudyFile(JSON.stringify({
      ...base,
      strokes: {
        sl_a: [{ id: 'a', tool: 'pen', color: '#23203a', width: 2.6, points: [{ x: 0.1, y: 0.1 }] }],
        sl_gone: [{ id: 'b', tool: 'pen', color: '#23203a', width: 2.6, points: [{ x: 0.2, y: 0.2 }] }],
      },
    }));
    expect(Object.keys(parsed.strokes)).toEqual(['sl_a']);
  });

  it('필기 좌표는 0~1로 다듬고 숫자가 아닌 점은 버린다', () => {
    const parsed = parseStudyFile(JSON.stringify({
      ...base,
      strokes: {
        sl_a: [{
          id: 'a', tool: 'pen', color: '#23203a', width: 2.6,
          points: [{ x: -0.5, y: 2 }, { x: 'NaN', y: 0.4 }, { x: 0.6, y: 0.7 }],
        }],
      },
    }));
    expect(parsed.strokes.sl_a[0].points).toEqual([{ x: 0, y: 1 }, { x: 0.6, y: 0.7 }]);
  });

  it('색·굵기·도구가 망가진 획은 기본값으로 되살린다', () => {
    const parsed = parseStudyFile(JSON.stringify({
      ...base,
      strokes: {
        sl_a: [{ points: [{ x: 0.2, y: 0.2 }], color: 'red', width: -3, tool: 'brush' }],
      },
    }));
    const stroke = parsed.strokes.sl_a[0];
    expect(stroke.color).toBe('#f5c542');
    expect(stroke.width).toBe(16);
    expect(stroke.tool).toBe('highlighter');
  });
});

describe('인용 블록 노트 양방향 호환', () => {
  const deckWithNotes = () => createDeck('인용 노트', [
    { id: 'sl_1', title: '1장', markdown: '## 1장\n\n본문 하나', note: '첫 줄\n둘째 줄', status: 'review' },
    { id: 'sl_2', title: '2장', markdown: '## 2장\n\n본문 둘', note: '', status: 'unlearned' },
  ]);

  it('인용 블록으로 내보낸 합본을 다시 가져오면 노트가 복원된다', () => {
    const md = deckToMarkdown(deckWithNotes(), 'quote');
    expect(md).toContain('> **노트**');
    const result = importMarkdown(md, 'hr', 'deck.md');
    expect(result.slides).toHaveLength(2);
    expect(result.slides[0].note).toBe('첫 줄\n둘째 줄');
    expect(result.slides[0].markdown).toBe('## 1장\n\n본문 하나');
    expect(result.slides[1].note).toBe('');
    expect(result.slides[1].markdown).toBe('## 2장\n\n본문 둘');
  });

  it('주석 형식과 인용 형식이 같은 노트를 만든다', () => {
    const comments = importMarkdown(deckToMarkdown(deckWithNotes(), 'comment'), 'hr', 'a.md');
    const quotes = importMarkdown(deckToMarkdown(deckWithNotes(), 'quote'), 'hr', 'b.md');
    expect(quotes.slides.map((slide) => slide.note)).toEqual(comments.slides.map((slide) => slide.note));
    expect(quotes.slides.map((slide) => slide.markdown)).toEqual(comments.slides.map((slide) => slide.markdown));
  });

  it('평범한 인용문은 노트로 빼지 않는다', () => {
    const md = '## 인용\n\n> **노트**는 무엇인가\n> 에 대한 인용문';
    const result = importMarkdown(md, 'hr', 'quote.md');
    expect(result.slides[0].note).toBe('');
    expect(result.slides[0].markdown).toContain('**노트**는 무엇인가');
  });
});
