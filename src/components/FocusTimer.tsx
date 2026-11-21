import { useEffect, useMemo, useState } from 'react';
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

export function FocusTimer({ minutes, onMinutes }: Props) {
  const total = useMemo(() => Math.max(1, minutes) * 60, [minutes]);
  const [remaining, setRemaining] = useState(total);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setRemaining(total);
    setRunning(false);
  }, [total]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          setRunning(false);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const finished = remaining === 0;
  const progress = total === 0 ? 0 : 1 - remaining / total;

  return (
    <div className={`focus-timer${finished ? ' is-done' : ''}${running ? ' is-running' : ''}`} data-testid="focus-timer">
      <span className="timer-ring" aria-hidden style={{ ['--progress' as string]: String(progress) }}>
        <IconClockMark />
      </span>
      <div className="timer-read">
        <strong>{formatClock(remaining)}</strong>
        <small>{finished ? '집중 완료 — 잠깐 쉬어가세요' : running ? '집중 중' : '집중 타이머'}</small>
      </div>
      <div className="timer-actions">
        <button
          type="button"
          className="mini-btn"
          onClick={() => setRunning((value) => !value)}
          aria-label={running ? '타이머 일시정지' : '타이머 시작'}
          title={running ? '일시정지' : '시작'}
          disabled={finished}
        >
          {running ? <IconPause size={14} /> : <IconPlay size={14} />}
        </button>
        <button
          type="button"
          className="mini-btn"
          onClick={() => { setRunning(false); setRemaining(total); }}
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
