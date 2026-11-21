/**
 * Deck tags: the short labels a lecture carries so the landing library can be
 * filtered. Tags arrive from three places — the new-lecture form, a YAML
 * frontmatter `tags:` field, or `#해시태그` tokens at the top of a markdown
 * body — so every path runs through one normalizer here.
 */

/** A deck keeps at most this many tags; the card chips have to stay readable. */
export const MAX_TAGS = 8;

/** One tag: no leading `#`, no wrapping punctuation, single spaces, ≤ 24 chars. */
export function normalizeTag(raw: string): string {
  return raw
    .replace(/^[#\s]+/, '')
    .replace(/[\s,;]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24)
    .trim();
}

/**
 * Any stored/imported tag field → a clean list: trimmed, de-duplicated
 * case-insensitively (first spelling wins), capped at `MAX_TAGS`.
 */
export function normalizeTags(input: unknown, max = MAX_TAGS): string[] {
  const raw: unknown[] = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[,\n]/)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    for (const piece of item.split(/[,\n]/)) {
      const tag = normalizeTag(piece);
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** The same list, stable, for comparing/diffing two tag sets. */
export function tagsEqual(a: string[] = [], b: string[] = []): boolean {
  return a.length === b.length && a.every((tag, index) => tag.toLowerCase() === (b[index] ?? '').toLowerCase());
}
