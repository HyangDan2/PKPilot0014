import { describe, expect, it } from 'vitest';
import { summarizeSave } from '../src/lib/saveStatus';

describe('저장 상태 표시', () => {
  it('두 영역이 모두 저장되면 저장됨이다', () => {
    expect(summarizeSave({ workspace: 'saved', strokes: 'saved' })).toEqual({ phase: 'saved', label: '저장됨' });
  });

  it('대기·저장 중은 저장 중으로 보인다', () => {
    expect(summarizeSave({ workspace: 'pending', strokes: 'saved' }).phase).toBe('pending');
    expect(summarizeSave({ workspace: 'saved', strokes: 'saving' }).label).toBe('저장 중…');
  });

  it('한 영역이라도 실패하면 실패가 대기보다 먼저다', () => {
    expect(summarizeSave({ workspace: 'failed', strokes: 'pending' }).phase).toBe('failed');
    expect(summarizeSave({ workspace: 'saved', strokes: 'failed' }).label).toBe('저장 실패');
  });

  it('읽지 못해 멈춘 방과 충돌은 실패보다 먼저 알린다', () => {
    expect(summarizeSave({ workspace: 'failed', strokes: 'failed' }, { paused: true }).label).toBe('저장 멈춤');
    expect(summarizeSave({ workspace: 'failed', strokes: 'saved' }, { conflict: true }).label).toBe('충돌 확인');
  });
});
