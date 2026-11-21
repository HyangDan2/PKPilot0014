import { describe, expect, it } from 'vitest';
import { extractHashtags, extractTags, parseFrontMatter } from '../src/lib/split';
import { normalizeTag, normalizeTags } from '../src/lib/tags';
import {
  createDeck, deckToMarkdown, importMarkdown, parseStudyFile, serializeStudy,
} from '../src/lib/study';
import { deckNotesMarkdown } from '../src/lib/exportBundle';
import {
  collectTags, filterDecks, pageCount, pageSlice, pageWindow, CATALOG_PAGE_SIZE,
} from '../src/lib/catalog';
import type { Deck, Slide } from '../src/types/study';

describe('태그 정규화', () => {
  it('# · 공백 · 끝 구두점을 다듬는다', () => {
    expect(normalizeTag('  ##Python,  ')).toBe('Python');
    expect(normalizeTag('#3주차 정리')).toBe('3주차 정리');
    expect(normalizeTag('   ')).toBe('');
  });

  it('중복은 대소문자 무시하고 첫 표기를 남긴다', () => {
    expect(normalizeTags(['Python', 'python', ' 기초 ', ''])).toEqual(['Python', '기초']);
    expect(normalizeTags('Python, 기초\n3주차')).toEqual(['Python', '기초', '3주차']);
    expect(normalizeTags(null)).toEqual([]);
  });

  it('최대 8개까지만 담는다', () => {
    const many = Array.from({ length: 12 }, (_, index) => `t${index}`);
    expect(normalizeTags(many)).toHaveLength(8);
  });
});

describe('frontmatter tags', () => {
  it('YAML 플로우 리스트를 읽는다', () => {
    const src = '---\ntitle: 파이썬 기초\ntags: [Python, 기초]\n---\n\n# 1장\n';
    const parsed = parseFrontMatter(src);
    expect(parsed.tags).toEqual(['Python', '기초']);
    expect(parsed.data.title).toBe('파이썬 기초');
    expect(parsed.body.trim()).toBe('# 1장');
  });

  it('쉼표로 이어 쓴 문자열을 읽는다', () => {
    expect(parseFrontMatter('---\ntags: Python, 기초\n---\n본문').tags).toEqual(['Python', '기초']);
    expect(parseFrontMatter('---\ntags: "Python"\n---\n본문').tags).toEqual(['Python']);
  });

  it('YAML 블록 리스트를 읽는다', () => {
    const src = '---\ntitle: 자료구조\ntags:\n  - Python\n  - 기초\nslides: 3\n---\n\n# 1장';
    const parsed = parseFrontMatter(src);
    expect(parsed.tags).toEqual(['Python', '기초']);
    expect(parsed.data.slides).toBe('3');
    expect(parsed.body.trim()).toBe('# 1장');
  });

  it('frontmatter가 없으면 빈 목록', () => {
    expect(parseFrontMatter('# 제목\n\n#태그').tags).toEqual([]);
  });
});

describe('본문 해시태그 보조 추출', () => {
  it('상단의 #태그를 모으고 헤딩은 건너뛴다', () => {
    const body = '# 1장 — 들어가기\n\n#Python #기초 로 시작하는 강의입니다.\n';
    expect(extractHashtags(body)).toEqual(['Python', '기초']);
  });

  it('코드블록 안의 #은 태그가 아니다', () => {
    const body = '```bash\n# 주석\ncurl #엔드포인트\n```\n\n#기초';
    expect(extractHashtags(body)).toEqual(['기초']);
  });

  it('frontmatter tags가 있으면 해시태그보다 우선한다', () => {
    const src = '---\ntags: [Python]\n---\n\n#기초 # Python\n';
    expect(extractTags(src)).toEqual(['Python']);
  });

  it('frontmatter가 없으면 본문 해시태그를 쓴다', () => {
    expect(extractTags('# 제목\n\n#기초 #3주차')).toEqual(['기초', '3주차']);
  });
});

describe('덱 모델의 tags', () => {
  it('새 덱은 태그를 정규화해 담는다', () => {
    const deck = createDeck('새 강의', [], [' Python ', 'python', '기초']);
    expect(deck.tags).toEqual(['Python', '기초']);
    expect(createDeck('태그 없음').tags).toEqual([]);
  });

  it('tags 없는 예전 .study.json은 빈 목록으로 읽는다', () => {
    const json = JSON.stringify({
      format: 'saga-glitra-study',
      decks: [{ id: 'd1', title: '옛 덱', slides: [{ id: 's1', markdown: '# 하나' }] }],
    });
    expect(parseStudyFile(json).decks[0].tags).toEqual([]);
  });

  it('저장·복원이 태그를 그대로 옮긴다', () => {
    const deck = createDeck('파이썬', [], ['Python', '기초']);
    const json = serializeStudy({ decks: [deck], activeDeckId: deck.id, strokes: {} });
    expect(JSON.parse(json).decks[0].tags).toEqual(['Python', '기초']);
    expect(parseStudyFile(json).decks[0].tags).toEqual(['Python', '기초']);
  });

  it('가져오기는 frontmatter 태그를 덱 태그로 쓴다', () => {
    const md = '---\ntitle: 파이썬 기초\ntags: [Python, 기초]\n---\n\n# 1장\n\n본문\n\n---\n\n## 2장\n\n본문';
    const result = importMarkdown(md, 'hr', 'python.md');
    expect(result.title).toBe('파이썬 기초');
    expect(result.tags).toEqual(['Python', '기초']);
    expect(result.slides).toHaveLength(2);
  });

  it('가져오기는 해시태그도 읽는다', () => {
    const result = importMarkdown('# 강의\n\n#기초 #Python\n\n본문', 'hr');
    expect(result.tags).toEqual(['기초', 'Python']);
  });

  it('내보내기 .md frontmatter에 tags를 적고, 다시 읽으면 살아난다', () => {
    const deck = createDeck('파이썬', [], ['Python', '기초']);
    const md = deckToMarkdown(deck);
    expect(md).toContain('tags: [Python, 기초]');
    expect(importMarkdown(md, 'hr').tags).toEqual(['Python', '기초']);
    expect(deckNotesMarkdown(deck)).toContain('tags: [Python, 기초]');
  });

  it('태그가 없으면 frontmatter에 tags 줄을 만들지 않는다', () => {
    expect(deckToMarkdown(createDeck('빈 덱'))).not.toContain('tags:');
  });
});

function slide(title: string, status: Slide['status'] = 'unlearned'): Slide {
  return { id: `sl_${title}`, title, markdown: `# ${title}`, note: '', status };
}

function deck(id: string, title: string, tags: string[] = [], summary = ''): Deck {
  return { id, title, slides: [slide(title)], summary, tags, createdAt: 0, updatedAt: 0 };
}

describe('랜딩 검색 · 태그 · 페이지', () => {
  const decks = [
    deck('d1', '파이썬 기초', ['Python', '기초'], '변수와 자료형'),
    deck('d2', '자료구조', ['CS'], '스택과 큐'),
    deck('d3', '파이썬 심화', ['Python'], '데코레이터'),
  ];

  it('제목 · 요약 · 태그를 모두 검색한다', () => {
    expect(filterDecks(decks, '파이썬').map((item) => item.id)).toEqual(['d1', 'd3']);
    expect(filterDecks(decks, '스택').map((item) => item.id)).toEqual(['d2']);
    expect(filterDecks(decks, 'python').map((item) => item.id)).toEqual(['d1', 'd3']);
    expect(filterDecks(decks, '')).toHaveLength(3);
  });

  it('태그 필터는 대소문자 무시하고 정확히 맞춘다', () => {
    expect(filterDecks(decks, '', 'python').map((item) => item.id)).toEqual(['d1', 'd3']);
    expect(filterDecks(decks, '', '기초').map((item) => item.id)).toEqual(['d1']);
    expect(filterDecks(decks, '', '없는태그')).toEqual([]);
  });

  it('검색어와 태그를 함께 적용한다', () => {
    expect(filterDecks(decks, '심화', 'Python').map((item) => item.id)).toEqual(['d3']);
    expect(filterDecks(decks, '심화', '기초')).toEqual([]);
  });

  it('태그를 많이 쓴 순서로 모은다', () => {
    const counts = collectTags(decks);
    expect(counts).toHaveLength(3);
    expect(counts[0]).toMatchObject({ tag: 'Python', count: 2 });
    expect(counts.map((entry) => entry.tag).sort()).toEqual(['CS', 'Python', '기초'].sort());
  });

  it('한 페이지에 10개씩 나눈다', () => {
    const many = Array.from({ length: 23 }, (_, index) => deck(`p${index}`, `강의 ${index}`));
    expect(CATALOG_PAGE_SIZE).toBe(10);
    expect(pageCount(many.length)).toBe(3);
    expect(pageSlice(many, 1)).toHaveLength(10);
    expect(pageSlice(many, 2)).toHaveLength(10);
    expect(pageSlice(many, 3)).toHaveLength(3);
    expect(pageSlice(many, 3)[0].id).toBe('p20');
  });

  it('범위를 벗어난 페이지는 마지막 페이지로 당긴다', () => {
    const many = Array.from({ length: 11 }, (_, index) => deck(`p${index}`, `강의 ${index}`));
    expect(pageSlice(many, 9)).toHaveLength(1);
    expect(pageCount(0)).toBe(1);
    expect(pageSlice([], 1)).toEqual([]);
  });

  it('페이지 버튼은 처음 · 끝 · 현재 주변만 남기고 …로 줄인다', () => {
    expect(pageWindow(1, 300)).toEqual([1, 2, '…', 30]);
    expect(pageWindow(3, 300)).toEqual([1, 2, 3, 4, '…', 30]);
    expect(pageWindow(5, 300)).toEqual([1, '…', 4, 5, 6, '…', 30]);
    expect(pageWindow(30, 300)).toEqual([1, '…', 29, 30]);
    expect(pageWindow(1, 60)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
