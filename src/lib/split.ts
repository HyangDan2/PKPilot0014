import type { SplitMode } from '../types/study';

/**
 * Slide splitting, the way PKPilot0008 split a markdown article: a YAML
 * frontmatter block first, then either the `---` horizontal rule (default) or
 * `##` level-2 headings. Fenced code blocks never split, and `---` lines that
 * live inside a fence stay code.
 */

export interface FrontMatter {
  data: Record<string, string>;
  body: string;
  raw: string;
}

const FENCE = /^(?: {0,3})(```|~~~)/;

export function parseFrontMatter(src: string): FrontMatter {
  const text = src.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  const lines = text.split('\n');
  if (!/^---\s*$/.test(lines[0] ?? '')) {
    return { data: {}, body: text, raw: '' };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (/^---\s*$/.test(lines[i]) || /^\.\.\.\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (end < 0) return { data: {}, body: text, raw: '' };

  const head = lines.slice(1, end);
  const looksLikeYaml =
    head.some((line) => /^[A-Za-z0-9_.-]+\s*:/.test(line.trim())) &&
    head.every((line) => {
      const trimmed = line.trim();
      return !trimmed || trimmed.startsWith('#') || /^[A-Za-z0-9_.-]+\s*:/.test(trimmed) || /^\s*-\s/.test(line);
    });
  if (!looksLikeYaml) return { data: {}, body: text, raw: '' };

  const raw = head.join('\n');
  const data: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    data[match[1].toLowerCase()] = match[2].replace(/^["']|["']$/g, '').trim();
  }
  return { data, body: lines.slice(end + 1).join('\n'), raw };
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
