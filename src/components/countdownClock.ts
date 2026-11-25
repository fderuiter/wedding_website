export type TimeLeft = {
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

export const getServerTickSnapshot = () => -1;

export function createCountdownClockStore(targetTimeMs: number): CountdownClockStore {
  let frozenSnapshot: number | null = null;

  const computeRemaining = (): number => {
    const difference = targetTimeMs - Date.now();
    if (!Number.isFinite(difference) || difference <= 0) {
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

export function formatTimeLeftFromTicks(ticks: number): TimeLeft {
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

export function formatReadableRemaining(timeLeft: TimeLeft): string {
  const days = timeLeft.days ?? 0;
  const hours = timeLeft.hours ?? 0;
  const minutes = timeLeft.minutes ?? 0;
  const seconds = timeLeft.seconds ?? 0;
  return `${days} ${days === 1 ? 'day' : 'days'}, ${hours} ${hours === 1 ? 'hour' : 'hours'}, ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, ${seconds} ${seconds === 1 ? 'second' : 'seconds'} to go!`;
}
