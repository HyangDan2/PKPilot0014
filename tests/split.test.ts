import { describe, expect, it } from 'vitest';
import { deckTitleFrom, extractNote, extractTitle, parseFrontMatter, splitMarkdown } from '../src/lib/split';

describe('frontmatter', () => {
  it('reads a YAML head and keeps the body', () => {
    const src = '---\ntitle: 전고체 배터리\nslug: solid-state\n---\n\n# 본문\n';
    const parsed = parseFrontMatter(src);
    expect(parsed.data.title).toBe('전고체 배터리');
    expect(parsed.data.slug).toBe('solid-state');
    expect(parsed.body.trim()).toBe('# 본문');
  });

  it('leaves a document without frontmatter untouched', () => {
    const src = '# 제목\n\n본문';
    expect(parseFrontMatter(src).body).toBe(src);
    expect(parseFrontMatter(src).data).toEqual({});
  });

  it('does not treat an unterminated --- as frontmatter', () => {
    const src = '---\n그냥 수평선일 수도';
    expect(parseFrontMatter(src).body).toBe(src);
  });
});

describe('splitMarkdown — ---', () => {
  it('splits on bare horizontal rules', () => {
    const chunks = splitMarkdown('# 1\n\n가\n\n---\n\n# 2\n\n나', 'hr');
    expect(chunks).toHaveLength(2);
    expect(chunks[0].title).toBe('1');
    expect(chunks[1].markdown).toBe('# 2\n\n나');
  });

  it('ignores --- inside a fenced code block', () => {
    const src = '# 1\n\n```yaml\n---\na: 1\n---\n```\n\n---\n\n# 2';
    const chunks = splitMarkdown(src, 'hr');
    expect(chunks).toHaveLength(2);
    expect(chunks[0].markdown).toContain('a: 1');
  });

  it('drops empty chunks and trims', () => {
    const chunks = splitMarkdown('---\n\n# 하나\n\n\n---\n---\n\n# 둘\n', 'hr');
    expect(chunks.map((c) => c.title)).toEqual(['하나', '둘']);
  });

  it('does not split a table separator row', () => {
    const chunks = splitMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |', 'hr');
    expect(chunks).toHaveLength(1);
  });
});

describe('splitMarkdown — ##', () => {
  it('splits at level-2 headings', () => {
    const src = '# 덱\n\n소개\n\n## 1장\n\n가\n\n### 소제목\n\n나\n\n## 2장\n\n다';
    const chunks = splitMarkdown(src, 'heading');
    expect(chunks).toHaveLength(3);
    expect(chunks[0].title).toBe('덱');
    expect(chunks[1].markdown.startsWith('## 1장')).toBe(true);
    expect(chunks[1].markdown).toContain('### 소제목');
  });

  it('returns one slide when there is no level-2 heading', () => {
    expect(splitMarkdown('# 하나뿐', 'heading')).toHaveLength(1);
  });
});

describe('notes', () => {
  it('pulls an HTML comment note out of the slide', () => {
    const { markdown, note } = extractNote('# 1\n\n본문\n\n<!-- note:\n메모입니다\n-->');
    expect(note).toBe('메모입니다');
    expect(markdown).toBe('# 1\n\n본문');
  });

  it('keeps the note on its own slide through a split', () => {
    const chunks = splitMarkdown('# 1\n\n<!-- note: 첫 메모 -->\n\n---\n\n# 2\n\n<!-- note: 둘째 -->', 'hr');
    expect(chunks[0].note).toBe('첫 메모');
    expect(chunks[1].note).toBe('둘째');
  });
});

describe('titles', () => {
  it('prefers a heading', () => {
    expect(extractTitle('intro\n\n## **굵은** 제목\n')).toBe('굵은 제목');
  });

  it('falls back to the first text line', () => {
    expect(extractTitle('그냥 문장입니다\n둘째 줄')).toBe('그냥 문장입니다');
  });

  it('uses frontmatter title for the deck', () => {
    expect(deckTitleFrom('---\ntitle: 덱 이름\n---\n# 다른 제목')).toBe('덱 이름');
  });
});

describe('splitMarkdown — 인용 블록 노트', () => {
  it('> **노트** 블록을 슬라이드 노트로 읽는다', () => {
    const src = [
      '## 1장',
      '',
      '본문',
      '',
      '> **노트**',
      '>',
      '> 첫 줄',
      '> 둘째 줄',
      '',
      '---',
      '',
      '## 2장',
    ].join('\n');
    const chunks = splitMarkdown(src, 'hr');
    expect(chunks).toHaveLength(2);
    expect(chunks[0].note).toBe('첫 줄\n둘째 줄');
    expect(chunks[0].markdown).toBe('## 1장\n\n본문');
    expect(chunks[1].note).toBe('');
  });

  it('주석 노트와 우선순위가 겹치지 않는다', () => {
    const src = '## 1장\n\n본문\n\n<!-- note: 주석 노트 -->\n\n> **노트**\n> 인용 노트';
    const chunks = splitMarkdown(src, 'hr');
    expect(chunks[0].note).toBe('주석 노트');
  });
});
