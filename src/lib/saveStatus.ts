/**
 * What the room says about its own saving. Workspace edits and ink are written
 * by two different paths, so each area reports its own phase; the chip on the
 * top bar shows the one that matters most (a failure hides a pending write, a
 * conflict hides both). The phases are named in the person's words, not the
 * storage's.
 */
export type SavePhase = 'idle' | 'pending' | 'saving' | 'saved' | 'failed' | 'paused';

export interface SaveState {
  workspace: SavePhase;
  strokes: SavePhase;
}

export type SaveSummaryPhase = 'saved' | 'pending' | 'failed' | 'paused' | 'conflict';

export interface SaveSummary {
  phase: SaveSummaryPhase;
  label: string;
}

const PENDING: SavePhase[] = ['pending', 'saving'];

export function summarizeSave(
  state: SaveState,
  options: { paused?: boolean; conflict?: boolean } = {},
): SaveSummary {
  if (options.paused) return { phase: 'paused', label: '저장 멈춤' };
  if (options.conflict) return { phase: 'conflict', label: '충돌 확인' };
  const phases = [state.workspace, state.strokes];
  if (phases.includes('failed')) return { phase: 'failed', label: '저장 실패' };
  if (phases.some((phase) => PENDING.includes(phase))) return { phase: 'pending', label: '저장 중…' };
  return { phase: 'saved', label: '저장됨' };
}
