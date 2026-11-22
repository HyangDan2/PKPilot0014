import type { StorageStatus } from './db';

export interface StorageNotice {
  /** Stable id so a dismissed notice stays dismissed until the state changes. */
  key: string;
  tone: 'warn' | 'error';
  title: string;
  body: string;
}

/**
 * What the study room says when the browser is not keeping the work. The
 * person has to know before they close the tab, so each case names the cause
 * and the way out (.study.json) rather than only reporting a failure.
 */
export function storageNoticeFor(status: StorageStatus): StorageNotice | null {
  if (status.error === 'read') {
    return {
      key: 'read',
      tone: 'error',
      title: '저장된 작업을 읽지 못했습니다',
      body: '이번 화면은 저장본이 아니라 임시본입니다 — 기존 덱을 덮어쓰지 않으려고 저장을 멈췄습니다. 다시 읽기를 누르거나, 잠시 뒤 새로고침해 주세요.',
    };
  }
  if (status.error === 'quota') {
    return {
      key: 'quota',
      tone: 'error',
      title: '저장 공간이 가득 찼습니다',
      body: '방금 변경을 저장하지 못했습니다(용량 초과). ⋮ → 내보내기로 .study.json을 받아 둔 뒤 오래된 덱을 지워 공간을 비우세요.',
    };
  }
  if (status.error === 'unavailable') {
    return {
      key: 'unavailable',
      tone: 'error',
      title: '이 브라우저에서는 저장소를 열 수 없습니다',
      body: '작업이 이 탭의 메모리에만 남습니다 — 탭을 닫기 전에 ⋮ → 내보내기로 .study.json을 받아 두세요.',
    };
  }
  if (status.error === 'write') {
    return {
      key: 'write',
      tone: 'error',
      title: '저장하지 못했습니다',
      body: '마지막 변경이 브라우저에 기록되지 않았습니다. 잠시 뒤 다시 시도하고, 계속되면 .study.json으로 내보내 두세요.',
    };
  }
  if (status.kind === 'memory') {
    return {
      key: 'memory',
      tone: 'warn',
      title: '임시 저장 중',
      body: '이 브라우저에서는 IndexedDB를 쓸 수 없어 작업이 탭 메모리에만 남습니다 — 탭을 닫기 전에 ⋮ → 내보내기로 .study.json을 받아 두세요.',
    };
  }
  return null;
}
