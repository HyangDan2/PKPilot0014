/**
 * 가림막 암기 — `==키워드==` becomes a cover chip. The source is tokenised
 * before markdown rendering, so DOMPurify never sees raw user HTML, and the
 * tokens are turned back into chips after sanitising.
 */

import { FenceTracker } from './fence';

const MASK_RE = /==([^=\n]+?)==/g;
const TOKEN = '%%SGMASK';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Replaces `==…==` outside fenced blocks and inline code with tokens. */
export function extractMasks(src: string): { text: string; masks: string[] } {
  const masks: string[] = [];
  const lines = src.split('\n');
  const fence = new FenceTracker();

  const replaceInline = (segment: string): string =>
    segment
      .split(/(`[^`\n]*`)/g)
      .map((part) => {
        if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) return part;
        return part.replace(MASK_RE, (_all, inner: string) => {
          const index = masks.length;
          masks.push(inner.trim());
          return `${TOKEN}${index}%%`;
        });
      })
      .join('');

  const out = lines.map((line) => {
    if (fence.feed(line)) return line;
    return replaceInline(line);
  });

  return { text: out.join('\n'), masks };
}

export function restoreMasks(html: string, masks: string[]): string {
  if (!masks.length) return html;
  let out = html;
  masks.forEach((mask, index) => {
    const chip =
      `<span class="slide-mask" role="button" tabindex="0" data-mask-id="${index}" data-revealed="false"` +
      ` aria-label="가림막 — 눌러서 공개" title="눌러서 공개 / 숨김">` +
      `<span class="slide-mask-ink">${escapeHtml(mask)}</span></span>`;
    out = out.split(`${TOKEN}${index}%%`).join(chip);
  });
  return out;
}

/** Plain-text rendering of a masked source (for counts and print fallbacks). */
export function maskCount(src: string): number {
  return extractMasks(src).masks.length;
}
