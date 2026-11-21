import type { SplitMode } from '../types/study';
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

const FENCE = /^(?: {0,3})(```|~~~)/;

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
  let fence: string | null = null;
  let seen = 0;
  for (const line of lines) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (fence === fenceMatch[1]) fence = null;
      continue;
    }
    if (fence) continue;
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
  let inFence = false;
  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
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

const NOTE_RE = /<!--\s*note:\s*([\s\S]*?)-->/i;

export function extractNote(chunk: string): { markdown: string; note: string } {
  const match = NOTE_RE.exec(chunk);
  if (!match) return { markdown: chunk.trim(), note: '' };
  const note = match[1].replace(/^\n+|\n+$/g, '').trim();
  return { markdown: (chunk.slice(0, match.index) + chunk.slice(match.index + match[0].length)).trim(), note };
}

/** Splits a markdown source into slides. Empty chunks are dropped. */
export function splitMarkdown(src: string, mode: SplitMode = 'hr'): SlideChunk[] {
  const { body } = parseFrontMatter(src);
  const lines = body.split('\n');
  const chunks: string[] = [];
  let buffer: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    const text = buffer.join('\n');
    if (text.trim()) chunks.push(text);
    buffer = [];
  };

  for (const line of lines) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (fence === fenceMatch[1]) fence = null;
      buffer.push(line);
      continue;
    }
    if (!fence) {
      if (mode === 'hr' && /^\s{0,3}---\s*$/.test(line)) {
        flush();
        continue;
      }
      if (mode === 'heading' && /^\s{0,2}##\s+\S/.test(line) && buffer.some((l) => l.trim())) {
        flush();
      }
    }
    buffer.push(line);
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
