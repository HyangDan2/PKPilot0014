import type { SplitMode } from '../types/study';
import { FenceTracker, fenceMark, isFenceClose, type FenceMark } from './fence';
import { normalizeTags } from './tags';

/**
 * Slide splitting, the way PKPilot0008 split a markdown article: a YAML
 * frontmatter block first, then either the `---` horizontal rule (default) or
 * `##` level-2 headings. Fenced code blocks never split, and `---` lines that
 * live inside a fence stay code.
 */

export interface FrontMatter {
  data: Record<string, string>;
  /** `tags:` from the head — inline list, comma list or YAML block list. */
  tags: string[];
  body: string;
  raw: string;
}

/** Strips one layer of YAML quotes from a scalar. */
function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, '').trim();
}

export function parseFrontMatter(src: string): FrontMatter {
  const text = src.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  const lines = text.split('\n');
  if (!/^---\s*$/.test(lines[0] ?? '')) {
    return { data: {}, tags: [], body: text, raw: '' };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (/^---\s*$/.test(lines[i]) || /^\.\.\.\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (end < 0) return { data: {}, tags: [], body: text, raw: '' };

  const head = lines.slice(1, end);
  const looksLikeYaml =
    head.some((line) => /^[A-Za-z0-9_.-]+\s*:/.test(line.trim())) &&
    head.every((line) => {
      const trimmed = line.trim();
      return !trimmed || trimmed.startsWith('#') || /^[A-Za-z0-9_.-]+\s*:/.test(trimmed) || /^\s*-\s/.test(line);
    });
  if (!looksLikeYaml) return { data: {}, tags: [], body: text, raw: '' };

  const raw = head.join('\n');
  const data: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  let current = '';
  for (const line of raw.split('\n')) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && current) {
      (lists[current] ??= []).push(unquote(item[1].replace(/\s+#.*$/, '')));
      continue;
    }
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!match) { current = ''; continue; }
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    current = key;
    if (!value) { data[key] = ''; continue; }
    // `tags: [Python, 기초]` — the brackets are the YAML flow list.
    const flow = /^\[(.*)\]$/.exec(value);
    if (flow) {
      lists[key] = flow[1].split(',').map((piece) => unquote(piece.trim()));
      data[key] = flow[1].trim();
      continue;
    }
    data[key] = unquote(value);
  }

  const tags = normalizeTags(lists.tags ?? data.tags ?? '');
  return { data, tags, body: lines.slice(end + 1).join('\n'), raw };
}

/**
 * `#태그` tokens at the top of a markdown body — the fallback when a document
 * carries no `tags:` frontmatter. ATX headings (`# 제목`) and fenced code are
 * never tags; any other `#단어` on the first lines of the body is.
 */
export function extractHashtags(markdown: string, limit = 8): string[] {
  const lines = markdown.split('\n');
  const found: string[] = [];
  const fence = new FenceTracker();
  let seen = 0;
  for (const line of lines) {
    if (fence.feed(line)) continue;
    const trimmed = line.trim();
    if (!trimmed) continue;
    seen += 1;
    if (seen > 30) break;
    // `# 제목` / `## 2장` are headings, not tags.
    if (/^#{1,6}\s/.test(trimmed)) continue;
    const tokens = /(^|[\s([{（,、·/])(#[^\s#,.;:!?()[\]{}<>"'`~|]+)/g;
    let match = tokens.exec(trimmed);
    while (match) {
      found.push(match[2]);
      if (normalizeTags(found).length >= limit) return normalizeTags(found);
      match = tokens.exec(trimmed);
    }
  }
  return normalizeTags(found, limit);
}

/** The deck's tags from a markdown source: frontmatter first, else hashtags. */
export function extractTags(src: string): string[] {
  const { tags, body } = parseFrontMatter(src);
  if (tags.length) return tags;
  return extractHashtags(body);
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s*/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~>]/g, '')
    .replace(/={2}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractTitle(markdown: string): string {
  const lines = markdown.split('\n');
  const fence = new FenceTracker();
  for (const line of lines) {
    if (fence.feed(line)) continue;
    const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) return clampTitle(stripInlineMarkdown(heading[2]));
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(```|~~~|---|\|)/.test(trimmed)) continue;
    if (/^<!--/.test(trimmed)) continue;
    return clampTitle(stripInlineMarkdown(trimmed));
  }
  return '새 슬라이드';
}

function clampTitle(text: string): string {
  const clean = text || '새 슬라이드';
  return clean.length > 80 ? `${clean.slice(0, 78)}…` : clean;
}

export interface SlideChunk {
  markdown: string;
  note: string;
  title: string;
}

const NOTE_RE = /<!--\s*note(-base64)?:\s*([\s\S]*?)-->/i;
/** The heading our own `quote` export writes above a note block. */
const QUOTE_NOTE_HEAD = /^ {0,3}>[ \t]*\*\*노트\*\*[ \t]*$/;

/**
 * True at the end of this line if an HTML comment opened on it is still open.
 * A comment that opens and closes on one line leaves nothing behind.
 */
function commentStateAfter(insideBefore: boolean, line: string): boolean {
  let inside = insideBefore;
  let rest = line;
  for (;;) {
    if (!inside) {
      const open = rest.indexOf('<!--');
      if (open < 0) return false;
      rest = rest.slice(open + 4);
      inside = true;
      continue;
    }
    const close = rest.indexOf('-->');
    if (close < 0) return true;
    rest = rest.slice(close + 3);
    inside = false;
  }
}

/**
 * Decodes the encoded form our comment export falls back to when a note itself
 * contains `-->` (which would end the comment early) or `<!--`.
 */
function decodeNotePayload(value: string): string {
  try {
    const binary = atob(value.replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

/**
 * A note written as a quote block — what `deckToMarkdown(deck, 'quote')`
 * produces:
 *
 *     > **노트**
 *     >
 *     > 첫 줄
 *
 * Read back so a combined `.md` in either note style re-imports with its notes
 * intact. Only a block whose first line is exactly `**노트**` counts; an
 * ordinary quotation stays part of the slide body.
 */
function extractQuoteNote(chunk: string): { markdown: string; note: string } | null {
  const lines = chunk.split('\n');
  const head = lines.findIndex((line) => QUOTE_NOTE_HEAD.test(line));
  if (head < 0) return null;
  let end = head;
  while (end + 1 < lines.length && /^ {0,3}>/.test(lines[end + 1])) end += 1;
  const note = lines
    .slice(head + 1, end + 1)
    .map((line) => line.replace(/^ {0,3}>[ \t]?/, ''))
    .join('\n')
    .trim();
  if (!note) return null;
  const markdown = [...lines.slice(0, head), ...lines.slice(end + 1)]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { markdown, note };
}

export function extractNote(chunk: string): { markdown: string; note: string } {
  const match = NOTE_RE.exec(chunk);
  if (match) {
    const encoded = Boolean(match[1]);
    const body = match[2].replace(/^\n+|\n+$/g, '').trim();
    const note = encoded ? decodeNotePayload(body) : body;
    return { markdown: (chunk.slice(0, match.index) + chunk.slice(match.index + match[0].length)).trim(), note };
  }
  return extractQuoteNote(chunk) ?? { markdown: chunk.trim(), note: '' };
}

/** Splits a markdown source into slides. Empty chunks are dropped. */
export function splitMarkdown(src: string, mode: SplitMode = 'hr'): SlideChunk[] {
  const { body } = parseFrontMatter(src);
  const lines = body.split('\n');
  const chunks: string[] = [];
  let buffer: string[] = [];
  let fence: FenceMark | null = null;
  // Inside an HTML comment nothing is markdown: a `---` line there (a rule
  // typed in a note) must not split the slide, and a fence there is text.
  let inComment = false;

  const flush = () => {
    const text = buffer.join('\n');
    if (text.trim()) chunks.push(text);
    buffer = [];
  };

  for (const line of lines) {
    if (inComment) {
      buffer.push(line);
      inComment = commentStateAfter(true, line);
      continue;
    }
    if (fence) {
      if (isFenceClose(line, fence)) fence = null;
      buffer.push(line);
      continue;
    }
    const open = fenceMark(line);
    if (open) {
      fence = open;
      buffer.push(line);
      continue;
    }
    if (mode === 'hr' && /^\s{0,3}---\s*$/.test(line)) {
      flush();
      continue;
    }
    if (mode === 'heading' && /^\s{0,2}##\s+\S/.test(line) && buffer.some((l) => l.trim())) {
      flush();
    }
    buffer.push(line);
    inComment = commentStateAfter(false, line);
  }
  flush();

  return chunks.map((chunk) => {
    const { markdown, note } = extractNote(chunk);
    return { markdown, note, title: extractTitle(markdown) };
  });
}

export function deckTitleFrom(src: string, fallback = '가져온 덱'): string {
  const { data, body } = parseFrontMatter(src);
  if (data.title) return data.title;
  const heading = /^\s{0,3}#\s+(.+?)\s*#*\s*$/m.exec(body);
  if (heading) return clampTitle(stripInlineMarkdown(heading[1]));
  return fallback;
}


/**
 * A slide usually opens with its own heading, and the stage already prints that
 * title in the card header. When the first heading is exactly the slide title,
 * the stage drops it so the same line is not shown twice.
 */
export function stripDuplicateTitle(markdown: string, title: string): string {
  const lines = markdown.split('\n');
  let index = 0;
  while (index < lines.length && !lines[index].trim()) index += 1;
  const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[index] ?? '');
  if (!heading) return markdown;
  if (stripInlineMarkdown(heading[2]) !== title) return markdown;
  const rest = lines.slice(index + 1);
  while (rest.length && !rest[0].trim()) rest.shift();
  return rest.join('\n');
}
