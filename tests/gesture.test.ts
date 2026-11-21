import { describe, expect, it } from 'vitest';
import { isTypingTarget, resolveSwipe } from '../src/lib/gesture';

const base = { penOn: false, viewMode: 'view' as const };

describe('슬라이드 스와이프 판정', () => {
  it('왼쪽으로 충분히 밀면 다음 장', () => {
    expect(resolveSwipe({ ...base, dx: -60, dy: 4 })).toBe(1);
  });

  it('오른쪽으로 충분히 밀면 이전 장', () => {
    expect(resolveSwipe({ ...base, dx: 60, dy: -4 })).toBe(-1);
  });

  it('짧은 이동은 넘기지 않는다 (48px 미만)', () => {
    expect(resolveSwipe({ ...base, dx: -47, dy: 0 })).toBe(0);
    expect(resolveSwipe({ ...base, dx: 48, dy: 0 })).toBe(-1);
  });

  it('세로로 더 많이 움직이면 넘기지 않는다', () => {
    expect(resolveSwipe({ ...base, dx: -60, dy: 50 })).toBe(0);
    expect(resolveSwipe({ ...base, dx: -70, dy: 50 })).toBe(1);
  });

  it('필기 모드에서는 그리기를 방해하지 않는다', () => {
    expect(resolveSwipe({ ...base, penOn: true, dx: -120, dy: 0 })).toBe(0);
  });

  it('편집 모드에서는 텍스트 선택을 방해하지 않는다', () => {
    expect(resolveSwipe({ ...base, viewMode: 'edit', dx: -120, dy: 0 })).toBe(0);
  });

  it('분할 모드에서는 넘길 수 있다', () => {
    expect(resolveSwipe({ ...base, viewMode: 'split', dx: -120, dy: 0 })).toBe(1);
  });
});

describe('키보드 대상 판정', () => {
  it('입력 필드에서는 화살표 넘김을 멈춘다', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const body = document.createElement('div');

    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(textarea)).toBe(true);
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(body)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
