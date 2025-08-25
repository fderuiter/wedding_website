'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'

type TimeLeft = {
  days?: number;
};

const Countdown = ({ targetDate }: { targetDate: string }) => {
  const weddingDate = useMemo(() => new Date(targetDate), [targetDate])

  const calculateTimeLeft = useCallback((): TimeLeft => {
    const now = new Date();
    const difference = weddingDate.getTime() - now.getTime();

    let timeLeft: TimeLeft = {}

    if (difference > 0) {
      timeLeft = {
        days: Math.ceil(difference / (1000 * 60 * 60 * 24)),
      }
    }

    return timeLeft
  }, [weddingDate]);

  const [timeLeft, setTimeLeft] = useState<TimeLeft>(calculateTimeLeft())

  useEffect(() => {
    const calculateAndSetTimeout = () => {
      const now = new Date();
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0);
      const timeToMidnight = midnight.getTime() - now.getTime();

      const timer = setTimeout(() => {
        setTimeLeft(calculateTimeLeft());
        calculateAndSetTimeout(); // Recalculate for the next day
      }, timeToMidnight);

      return timer;
    };

    const timer = calculateAndSetTimeout();

    return () => clearTimeout(timer);
  }, [calculateTimeLeft]);

  const timerComponents: React.ReactNode[] = []

  Object.keys(timeLeft).forEach((interval) => {
    const value = timeLeft[interval as keyof TimeLeft]
    if (!value) {
      return
    }

    timerComponents.push(
      <span key={interval}>
        {value} {value === 1 ? interval.slice(0, -1) : interval}{' '}
      </span>
    )
  })

  const daysRemaining = timeLeft.days || 0;
  const screenReaderText = `${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'} to go!`;

  return (
    <div>
      {timerComponents.length ? (
        <div
          className="text-2xl font-bold text-rose-700 dark:text-rose-400"
          role="timer"
          aria-atomic="true"
        >
          {timerComponents} to go!
        </div>
      ) : (
        <span className="text-2xl font-bold text-rose-700 dark:text-rose-400">
          The wedding day is here!
        </span>
      )}
       <span className="sr-only" aria-live="polite">
        {screenReaderText}
      </span>
      <noscript>
        <div className="text-2xl font-bold text-rose-700 dark:text-rose-400">
          October 10, 2025
        </div>
      </noscript>
    </div>
  )
}

export default Countdown;
