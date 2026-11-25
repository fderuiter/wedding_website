'use client';

import React, { useState, useCallback, useMemo, useSyncExternalStore } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { formatDate } from '@/utils/intl';

/**
 * @typedef {object} TimeLeft
 * @description Represents the time remaining until a target date.
 * @property {number} [days] - The number of days remaining.
 * @property {number} [hours] - The number of hours remaining.
 * @property {number} [minutes] - The number of minutes remaining.
 * @property {number} [seconds] - The number of seconds remaining.
 */
type TimeLeft = {
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
};

interface CountdownClockStore {
  getSnapshot: (paused: boolean) => number;
  freezeNow: () => number;
  unfreeze: () => number;
}

function createCountdownClockStore(targetTimeMs: number): CountdownClockStore {
  let frozenSnapshot: number | null = null;

  const computeRemaining = (): number => {
    const difference = targetTimeMs - Date.now();
    if (difference <= 0) {
      return 0;
    }
    return Math.floor(difference / 1000) + 1;
  };

  return {
    getSnapshot(paused: boolean): number {
      if (paused) {
        if (frozenSnapshot === null) {
          frozenSnapshot = computeRemaining();
        }
        return frozenSnapshot;
      }
      frozenSnapshot = null;
      return computeRemaining();
    },
    freezeNow(): number {
      frozenSnapshot = computeRemaining();
      return frozenSnapshot;
    },
    unfreeze(): number {
      frozenSnapshot = null;
      return computeRemaining();
    },
  };
}

const getServerTickSnapshot = () => -1;

function formatTimeLeftFromTicks(ticks: number): TimeLeft {
  if (ticks <= 0) {
    return {};
  }
  const totalSeconds = ticks - 1;
  return {
    days: Math.floor(totalSeconds / (60 * 60 * 24)),
    hours: Math.floor((totalSeconds / (60 * 60)) % 24),
    minutes: Math.floor((totalSeconds / 60) % 60),
    seconds: Math.floor(totalSeconds % 60),
  };
}

function formatReadableRemaining(timeLeft: TimeLeft): string {
  const days = timeLeft.days ?? 0;
  const hours = timeLeft.hours ?? 0;
  const minutes = timeLeft.minutes ?? 0;
  const seconds = timeLeft.seconds ?? 0;
  return `${days} ${days === 1 ? 'day' : 'days'}, ${hours} ${hours === 1 ? 'hour' : 'hours'}, ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, ${seconds} ${seconds === 1 ? 'second' : 'seconds'} to go!`;
}

/**
 * @function Countdown
 * @description A React component that displays a pausable countdown to a specified target date.
 * Starts paused when `prefers-reduced-motion: reduce` is active (WCAG 2.2 SC 2.2.2) and exposes
 * a non-focusable timer readout alongside an accessible pause/resume toggle button.
 * @param {object} props - The component props.
 * @param {string} props.targetDate - The target date for the countdown in a string format recognizable by the Date constructor (e.g., "YYYY-MM-DDTHH:mm:ss").
 * @returns {JSX.Element} The rendered Countdown component.
 */
const Countdown = ({ targetDate }: { targetDate: string }) => {
  const weddingDate = useMemo(() => new Date(targetDate), [targetDate]);
  const targetTimeMs = weddingDate.getTime();
  const prefersReducedMotion = useReducedMotion();

  const [manualPaused, setManualPaused] = useState<boolean | null>(null);
  const [prevReducedMotion, setPrevReducedMotion] = useState(prefersReducedMotion);
  if (prevReducedMotion !== prefersReducedMotion) {
    setPrevReducedMotion(prefersReducedMotion);
    if (prefersReducedMotion) {
      setManualPaused(null);
    }
  }

  const isPaused = manualPaused ?? prefersReducedMotion;

  const clockStore = useMemo(
    () => createCountdownClockStore(targetTimeMs),
    [targetTimeMs]
  );

  const subscribeToClock = useCallback(
    (onStoreChange: () => void) => {
      if (isPaused || targetTimeMs <= Date.now()) {
        return () => {};
      }

      const intervalId = setInterval(() => {
        onStoreChange();
        if (targetTimeMs <= Date.now()) {
          clearInterval(intervalId);
        }
      }, 1000);

      return () => {
        clearInterval(intervalId);
      };
    },
    [isPaused, targetTimeMs]
  );

  const getTickSnapshot = useCallback(
    () => clockStore.getSnapshot(isPaused),
    [clockStore, isPaused]
  );

  const ticksRemaining = useSyncExternalStore(
    subscribeToClock,
    getTickSnapshot,
    getServerTickSnapshot
  );

  const isMounted = ticksRemaining >= 0;

  const timeLeft = useMemo<TimeLeft>(
    () => formatTimeLeftFromTicks(ticksRemaining),
    [ticksRemaining]
  );

  const [announcement, setAnnouncement] = useState('');

  const handleTogglePause = useCallback(() => {
    const nextPaused = !isPaused;
    const snapshotTicks = nextPaused ? clockStore.freezeNow() : clockStore.unfreeze();
    setManualPaused(nextPaused);

    const snapshotTimeLeft = formatTimeLeftFromTicks(snapshotTicks);
    const hasRemaining = Object.keys(snapshotTimeLeft).length > 0;
    const statusSummary = hasRemaining
      ? formatReadableRemaining(snapshotTimeLeft)
      : 'The wedding day is here!';
    const message = nextPaused
      ? `Countdown paused: ${statusSummary}`
      : `Countdown resumed: ${statusSummary}`;
    setAnnouncement((prev) => (prev === message ? `${message}\u00A0` : message));
  }, [clockStore, isPaused]);

  const timerComponents: React.ReactNode[] = [];

  if (isMounted) {
    (Object.keys(timeLeft) as Array<keyof TimeLeft>).forEach((interval) => {
      const value = timeLeft[interval];
      if (value === undefined) {
        return;
      }

      timerComponents.push(
        <span key={interval}>
          {value} {value === 1 ? interval.slice(0, -1) : interval}{' '}
        </span>
      );
    });
  }

  return (
    <div className="inline-flex flex-col items-center gap-2">
      {!isMounted ? (
        <div className="text-2xl font-bold text-primary dark:text-primary-text">
          {formatDate(weddingDate)}
        </div>
      ) : timerComponents.length ? (
        <>
          <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {announcement}
          </div>
          <div
            className="text-2xl font-bold text-primary dark:text-primary-text tabular-nums"
            role="timer"
            aria-live="off"
          >
            {timerComponents} to go!
          </div>
          <button
            type="button"
            onClick={handleTogglePause}
            aria-pressed={isPaused}
            data-testid="countdown-pause-btn"
            className="cursor-pointer inline-flex items-center justify-center gap-1.5 min-h-8 px-3.5 py-1 rounded-full text-xs font-semibold bg-stone-900 text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white border border-stone-700 dark:border-stone-300 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-stone-900 dark:focus-visible:ring-white"
          >
            {isPaused ? (
              <svg
                className="w-3.5 h-3.5 shrink-0"
                fill="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            ) : (
              <svg
                className="w-3.5 h-3.5 shrink-0"
                fill="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            )}
            <span>{isPaused ? 'Resume countdown' : 'Pause countdown'}</span>
          </button>
        </>
      ) : (
        <div
          className="text-2xl font-bold text-primary dark:text-primary-text"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          The wedding day is here!
        </div>
      )}
      <noscript>
        <div className="text-2xl font-bold text-primary dark:text-primary-text">
          {formatDate(weddingDate)}
        </div>
      </noscript>
    </div>
  );
};

export default Countdown;
