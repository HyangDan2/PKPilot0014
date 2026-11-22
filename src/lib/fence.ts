/**
 * Fenced code blocks. A fence is a run of three or more backticks or tildes;
 * the closing run must use the same character and be at least as long as the
 * opening one, so a ```` block may hold ``` lines of its own. Treating every
 * run as three characters broke those blocks and let a `---` inside them split
 * a deck.
 */

export interface FenceMark {
  char: '`' | '~';
  length: number;
}

const OPEN = /^ {0,3}(`{3,}|~{3,})/;
const CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/** The fence a line opens, with the run's full length (4+ included). */
export function fenceMark(line: string): FenceMark | null {
  const match = OPEN.exec(line);
  if (!match) return null;
  const run = match[1];
  return { char: run[0] as '`' | '~', length: run.length };
}

/** True when the line closes `mark`: same character, at least as long, nothing else. */
export function isFenceClose(line: string, mark: FenceMark): boolean {
  const match = CLOSE.exec(line);
  if (!match) return false;
  const run = match[1];
  return run[0] === mark.char && run.length >= mark.length;
}

/** Tracks fence state line by line while walking a markdown document. */
export class FenceTracker {
  private mark: FenceMark | null = null;

  /** True while this line sits inside (or opens/closes) a fence. */
  get inside(): boolean {
    return this.mark !== null;
  }

  /** Feeds one line and reports whether it belongs to a fence. */
  feed(line: string): boolean {
    if (this.mark) {
      if (isFenceClose(line, this.mark)) this.mark = null;
      return true;
    }
    const open = fenceMark(line);
    if (open) {
      this.mark = open;
      return true;
    }
    return false;
  }
}
