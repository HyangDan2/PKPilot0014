import { describe, expect, it } from 'vitest';
import { getMarkdown, renderMarkdown } from '../src/lib/markdown';

/**
 * Structural assertions run on the markdown-it output directly: happy-dom's
 * heading elements confuse DOMPurify's tag check inside the test environment
 * (h2–h6 lose their tag there but not in a browser), so sanitisation is tested
 * separately and the live page is verified in the browser.
 */
describe('마크다운 엔진', () => {
  it('renders headings and GFM tables', () => {
    const html = getMarkdown().render('## 제목\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n');
    expect(html).toContain('<h2>제목</h2>');
    expect(html).toContain('<table>');
  });

  it('gives fenced code a language badge and a copy button', () => {
    const html = getMarkdown().render('```ts\nconst a: number = 1;\n```');
    expect(html).toContain('class="code-block"');
    expect(html).toContain('code-lang">ts');
    expect(html).toContain('data-copy="1"');
    expect(html).toContain('hljs-keyword');
  });

  it('leaves a mermaid placeholder for the client renderer', () => {
    const html = getMarkdown().render('```mermaid\nflowchart LR\n A-->B\n```');
    expect(html).toContain('data-mermaid=');
    expect(html).toContain('mermaid-figure');
  });
});

describe('렌더 파이프라인', () => {
  it('renders inline and block math with KaTeX', () => {
    const { html } = renderMarkdown('질량은 $E=mc^2$ 입니다.\n\n$$\n\\int_0^1 x\\,dx\n$$');
    expect(html).toContain('katex');
    expect(html).toContain('math-block');
  });

  it('turns GFM checkboxes into task rows', () => {
    const { html } = renderMarkdown('- [x] 끝\n- [ ] 남음');
    expect(html).toContain('task-item checked');
    expect(html).toContain('task-box');
  });

  it('turns masks into chips and strips raw HTML', () => {
    const { html, masks } = renderMarkdown('==핵심== 그리고 <script>alert(1)</script>');
    expect(masks).toEqual(['핵심']);
    expect(html).toContain('class="glitra-mask"');
    expect(html).not.toContain('<script>');
  });

  it('drops event handlers from raw HTML', () => {
    const { html } = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
