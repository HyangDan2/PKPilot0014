import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import katex from 'katex';
import DOMPurify from 'dompurify';
import { escapeHtml, extractMasks, restoreMasks } from './mask';

let registered = false;
function registerLanguages() {
  if (registered) return;
  registered = true;
  const langs: [string, typeof plaintext][] = [
    ['bash', bash], ['c', c], ['cpp', cpp], ['css', css], ['go', go], ['java', java],
    ['javascript', javascript], ['js', javascript], ['json', json], ['markdown', markdown],
    ['md', markdown], ['plaintext', plaintext], ['text', plaintext], ['python', python],
    ['py', python], ['rust', rust], ['sql', sql], ['typescript', typescript], ['ts', typescript],
    ['html', xml], ['xml', xml], ['yaml', yaml], ['yml', yaml],
  ];
  for (const [name, lang] of langs) {
    if (!hljs.getLanguage(name)) hljs.registerLanguage(name, lang);
  }
}

function mathPlugin(md: MarkdownIt) {
  const anyMd = md as unknown as {
    inline: { ruler: { before: (name: string, rule: string, fn: unknown) => void } };
    block: { ruler: { before: (name: string, rule: string, fn: unknown) => void } };
    renderer: { rules: Record<string, unknown> };
  };

  const inlineRule = (state: any, silent: boolean): boolean => {
    const start: number = state.pos;
    if (state.src[start] !== '$') return false;
    if (state.src[start + 1] === '$') return false;
    const max: number = state.posMax;
    let pos = start + 1;
    while (pos < max) {
      const ch = state.src[pos];
      if (ch === '\\') { pos += 2; continue; }
      if (ch === '\n') return false;
      if (ch === '$') break;
      pos += 1;
    }
    if (pos >= max || state.src[pos] !== '$') return false;
    const content = state.src.slice(start + 1, pos);
    if (!content.trim()) return false;
    if (!silent) {
      const token = state.push('sg_math_inline', 'math', 0);
      token.content = content;
      token.markup = '$';
    }
    state.pos = pos + 1;
    return true;
  };

  const blockRule = (state: any, startLine: number, endLine: number, silent: boolean): boolean => {
    const begin = state.bMarks[startLine] + state.tShift[startLine];
    const finish = state.eMarks[startLine];
    const first = state.src.slice(begin, finish).trim();
    if (!first.startsWith('$$')) return false;
    if (silent) return true;

    let content = first.slice(2);
    let nextLine = startLine;
    let closed = first.length > 2 && first.endsWith('$$');
    if (closed) {
      content = first.slice(2, -2);
    } else {
      while (!closed) {
        nextLine += 1;
        if (nextLine >= endLine) break;
        const ls = state.bMarks[nextLine] + state.tShift[nextLine];
        const le = state.eMarks[nextLine];
        const line = state.src.slice(ls, le);
        const at = line.indexOf('$$');
        if (at >= 0) {
          content += `\n${line.slice(0, at)}`;
          closed = true;
        } else {
          content += `\n${line}`;
        }
      }
    }
    state.line = nextLine + 1;
    const token = state.push('sg_math_block', 'math', 0);
    token.block = true;
    token.content = content.trim();
    token.markup = '$$';
    return true;
  };

  anyMd.inline.ruler.before('escape', 'sg_math_inline', inlineRule);
  anyMd.block.ruler.before('fence', 'sg_math_block', blockRule);

  anyMd.renderer.rules.sg_math_inline = (tokens: any[], index: number) => {
    try {
      return katex.renderToString(tokens[index].content, { displayMode: false, throwOnError: false });
    } catch {
      return `<code class="math-error">${escapeHtml(tokens[index].content)}</code>`;
    }
  };
  anyMd.renderer.rules.sg_math_block = (tokens: any[], index: number) => {
    try {
      return `<div class="math-block">${katex.renderToString(tokens[index].content, { displayMode: true, throwOnError: false })}</div>\n`;
    } catch {
      return `<pre class="math-block math-error">${escapeHtml(tokens[index].content)}</pre>\n`;
    }
  };
}

let engine: MarkdownIt | null = null;

export function getMarkdown(): MarkdownIt {
  if (engine) return engine;
  registerLanguages();
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    breaks: false,
    highlight: null,
  });
  mathPlugin(md);

  md.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index];
    const info = (token.info || '').trim();
    const lang = info.split(/\s+/)[0] || '';
    const code = token.content;

    if (lang === 'mermaid') {
      return (
        `<figure class="mermaid-figure">` +
        `<div class="mermaid-block" data-mermaid="${encodeURIComponent(code)}">` +
        `<pre class="mermaid-src">${escapeHtml(code)}</pre></div>` +
        `<figcaption>MERMAID DIAGRAM</figcaption></figure>\n`
      );
    }

    const shown = (lang || 'text').toLowerCase();
    const body = hljs.getLanguage(shown)
      ? hljs.highlight(code, { language: shown, ignoreIllegals: true }).value
      : escapeHtml(code);

    return (
      `<div class="code-block">` +
      `<div class="code-head"><span class="code-lang">${escapeHtml(shown)}</span>` +
      `<button type="button" class="code-copy" data-copy="1">복사</button></div>` +
      `<pre class="code-body"><code class="hljs language-${escapeHtml(shown)}">${body}</code></pre></div>\n`
    );
  };

  const linkOpen = md.renderer.rules.link_open ??
    ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const href = tokens[index].attrGet('href') ?? '';
    if (/^https?:/i.test(href)) {
      tokens[index].attrSet('target', '_blank');
      tokens[index].attrSet('rel', 'noopener noreferrer');
    }
    return linkOpen(tokens, index, options, env, self);
  };

  engine = md;
  return md;
}

function sanitize(html: string): string {
  if (typeof window === 'undefined') return html;
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel', 'data-mermaid', 'data-copy'],
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
  });
}

function markTaskLists(html: string): string {
  return html.replace(
    /<li>\s*\[([ xX])\]\s*/g,
    (_all, mark: string) =>
      `<li class="task-item${mark.trim() ? ' checked' : ''}"><span class="task-box" aria-hidden="true">${mark.trim() ? '✓' : ''}</span>`,
  );
}

export interface RenderResult {
  html: string;
  masks: string[];
}

/**
 * Renders a markdown source for the stage / notepad: GFM tables, task lists,
 * highlight.js fences with a copy button, KaTeX math, mermaid placeholders,
 * `==가림막==` chips, and a DOMPurify pass on everything.
 */
export function renderMarkdown(src: string): RenderResult {
  const { text, masks } = extractMasks(src ?? '');
  const md = getMarkdown();
  const raw = md.render(text);
  const clean = sanitize(markTaskLists(raw));
  return { html: restoreMasks(clean, masks), masks };
}

/** Plain text for thumbnails and previews. */
export function plainText(src: string, limit = 140): string {
  const text = (src ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$\n]*\$/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[>*_~`|=#-]/g, ' ')
    .replace(/={2}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
