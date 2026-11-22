import { describe, expect, it } from 'vitest';
import { FenceTracker, fenceMark, isFenceClose } from '../src/lib/fence';
import { splitMarkdown } from '../src/lib/split';

describe('코드펜스 길이', () => {
  it('4개 백틱으로 연 펜스는 3개 백틱 줄에 닫히지 않는다', () => {
    const mark = fenceMark('````md');
    expect(mark).toEqual({ char: '`', length: 4 });
    expect(isFenceClose('```', mark!)).toBe(false);
    expect(isFenceClose('````', mark!)).toBe(true);
  });

  it('같은 문자에 같은 길이 이상이어야 닫힌다', () => {
    const mark = fenceMark('~~~');
    expect(isFenceClose('~~~', mark!)).toBe(true);
    expect(isFenceClose('~~~~', mark!)).toBe(true);
    expect(isFenceClose('```', mark!)).toBe(false);
    // A fence line with an info string is an opening, never a close.
    expect(isFenceClose('```js', mark!)).toBe(false);
  });

  it('닫는 줄에 다른 글자가 붙으면 닫히지 않는다', () => {
    const mark = fenceMark('```');
    expect(isFenceClose('``` tail', mark!)).toBe(false);
  });

  it('tracker가 열림과 닫힘을 짝지어 센다', () => {
    const tracker = new FenceTracker();
    expect(tracker.feed('```js')).toBe(true);
    expect(tracker.feed('const a = 1;')).toBe(true);
    expect(tracker.feed('```')).toBe(true);
    expect(tracker.inside).toBe(false);
    expect(tracker.feed('본문')).toBe(false);
  });
});

describe('splitMarkdown — 4개 이상 백틱 펜스', () => {
  const source = [
    '# 1장',
    '',
    '````md',
    '```js',
    'const a = 1;',
    '```',
    '',
    '---',
    '',
    '안쪽 구분선',
    '````',
    '',
    '---',
    '',
    '# 2장',
  ].join('\n');

  it('펜스 안의 ```와 ---로 슬라이드를 나누지 않는다', () => {
    const chunks = splitMarkdown(source, 'hr');
    expect(chunks).toHaveLength(2);
    expect(chunks[0].markdown).toContain('````md');
    expect(chunks[0].markdown).toContain('안쪽 구분선');
    expect(chunks[0].markdown).toContain('```js');
    expect(chunks[1].title).toBe('2장');
  });

  it('5개 백틱 펜스도 같은 규칙으로 다룬다', () => {
    const chunks = splitMarkdown([
      '# A',
      '',
      '`````',
      '````',
      '```',
      '---',
      '`````',
      '',
      '---',
      '',
      '# B',
    ].join('\n'), 'hr');
    expect(chunks).toHaveLength(2);
    expect(chunks[0].markdown).toContain('---');
  });

  it('펜스가 닫히면 그 뒤 ---는 다시 슬라이드를 나눈다', () => {
    const chunks = splitMarkdown(['# A', '', '````', '```', 'x', '````', '', '---', '', '# B'].join('\n'), 'hr');
    expect(chunks).toHaveLength(2);
    expect(chunks[1].markdown).toBe('# B');
  });
});
