import { describe, expect, it } from 'vitest';
import { escapeHtml, extractMasks, maskCount, restoreMasks } from '../src/lib/mask';

describe('가림막 파서', () => {
  it('tokenises ==키워드== in order', () => {
    const { text, masks } = extractMasks('==하나== 그리고 ==둘==');
    expect(masks).toEqual(['하나', '둘']);
    expect(text).toBe('%%SGMASK0%% 그리고 %%SGMASK1%%');
  });

  it('does not touch a fenced block', () => {
    const src = '```\n==코드 안==\n```\n\n==밖==';
    const { masks } = extractMasks(src);
    expect(masks).toEqual(['밖']);
  });

  it('does not touch inline code', () => {
    const { masks } = extractMasks('`==코드==` 와 ==진짜==');
    expect(masks).toEqual(['진짜']);
  });

  it('ignores an unclosed marker', () => {
    expect(extractMasks('==닫히지 않음').masks).toEqual([]);
  });

  it('counts masks', () => {
    expect(maskCount('==a== ==b== ==c==')).toBe(3);
  });
});

describe('칩 복원', () => {
  it('builds an escaped, revealed=false chip', () => {
    const html = restoreMasks('<p>%%SGMASK0%%</p>', ['<script>x</script>']);
    expect(html).toContain('class="glitra-mask"');
    expect(html).toContain('data-mask-id="0"');
    expect(html).toContain('data-revealed="false"');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('escapes quotes and ampersands', () => {
    expect(escapeHtml(`a & b "c" 'd'`)).toBe('a &amp; b &quot;c&quot; &#39;d&#39;');
  });
});
