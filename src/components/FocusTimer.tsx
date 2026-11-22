import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconPause, IconPlay, IconReset } from './Icons';

interface Props {
  minutes: number;
  onMinutes: (minutes: number) => void;
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * Seconds left until `endAt`, measured on the wall clock rather than counted
 * down tick by tick: a backgrounded tab throttles its interval, and counting
 * ticks made the timer drift behind the time that actually passed.
 */
export function remainingSeconds(endAt: number, now: number): number {
  if (!Number.isFinite(endAt)) return 0;
  return Math.max(0, Math.ceil((endAt - now) / 1000));
}

export function FocusTimer({ minutes, onMinutes }: Props) {
  const total = useMemo(() => Math.max(1, minutes) * 60, [minutes]);
  const [remaining, setRemaining] = useState(total);
  const [running, setRunning] = useState(false);
  /** Wall-clock moment the count reaches zero while running. */
  const endAt = useRef<number | null>(null);
  const remainingRef = useRef(total);

  const write = useCallback((value: number) => {
    remainingRef.current = value;
    setRemaining(value);
  }, []);

  useEffect(() => {
    endAt.current = null;
    write(total);
    setRunning(false);
  }, [total, write]);

  /** The seconds left right now, from the wall clock when running. */
  const read = useCallback(() => {
    if (endAt.current === null) return remainingRef.current;
    const left = remainingSeconds(endAt.current, Date.now());
    if (left <= 0) endAt.current = null;
    remainingRef.current = left;
    return left;
  }, []);

  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const left = read();
      setRemaining(left);
      if (left <= 0) setRunning(false);
    };
    // Four reads a second keeps the number honest across a throttled timer;
    // the visibility return recomputes at once instead of one tick later.
    const timer = window.setInterval(tick, 250);
    const onVisibility = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisibility);
    tick();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [running, read]);

  const toggle = () => {
    if (running) {
      // Pause where the clock actually stands, not where the last tick landed.
      const left = read();
      endAt.current = null;
      write(left);
      setRunning(false);
      return;
    }
    if (remainingRef.current <= 0) return;
    endAt.current = Date.now() + remainingRef.current * 1000;
    setRunning(true);
  };

  const reset = () => {
    endAt.current = null;
    setRunning(false);
    write(total);
  };

  const finished = remaining === 0;
  const progress = total === 0 ? 0 : 1 - remaining / total;

  return (
    <div
      className={`focus-timer${finished ? ' is-done' : ''}${running ? ' is-running' : ''}`}
      data-testid="focus-timer"
      data-remaining={remaining}
    >
      <span className="timer-ring" aria-hidden style={{ ['--progress' as string]: String(progress) }}>
        <IconClockMark />
      </span>
      <div className="timer-read">
        <strong data-testid="timer-clock">{formatClock(remaining)}</strong>
        <small>{finished ? '집중 완료 — 잠깐 쉬어가세요' : running ? '집중 중' : '집중 타이머'}</small>
      </div>
      <div className="timer-actions">
        <button
          type="button"
          className="mini-btn"
          onClick={toggle}
          aria-label={running ? '타이머 일시정지' : '타이머 시작'}
          title={running ? '일시정지' : '시작'}
          disabled={finished}
        >
          {running ? <IconPause size={14} /> : <IconPlay size={14} />}
        </button>
        <button
          type="button"
          className="mini-btn"
          onClick={reset}
          aria-label="타이머 리셋"
          title="리셋"
        >
          <IconReset size={14} />
        </button>
        <label className="timer-min">
          <input
            type="number"
            min={1}
            max={120}
            step={5}
            value={minutes}
            onChange={(event) => {
              const next = Number(event.target.value.replace(/\D/g, ''));
              onMinutes(Math.min(120, Math.max(1, next || 1)));
            }}
            aria-label="집중 시간(분)"
          />
          <span>분</span>
        </label>
      </div>
    </div>
  );
}

function IconClockMark() {
  return (
    <svg viewBox="0 0 36 36" width="18" height="18" aria-hidden="true">
      <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="2.4" opacity="0.25" />
      <circle
        cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="2.4"
        strokeDasharray="94.2" strokeDashoffset="0" strokeLinecap="round"
        transform="rotate(-90 18 18)"
        style={{ strokeDashoffset: 'calc(94.2 - var(--progress, 0) * 94.2)' }}
      />
    </svg>
  );
}
