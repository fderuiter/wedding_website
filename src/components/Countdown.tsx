'use client';

import React, { useState, useCallback, useMemo, useSyncExternalStore } from 'react';
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

const getServerTickSnapshot = () => -1;

/**
 * @function Countdown
 * @description A React component that displays a countdown to a specified target date.
 * It calculates the number of days, hours, minutes, and seconds remaining and updates every second.
 * @param {object} props - The component props.
 * @param {string} props.targetDate - The target date for the countdown in a string format recognizable by the Date constructor (e.g., "YYYY-MM-DDTHH:mm:ss").
 * @returns {JSX.Element} The rendered Countdown component.
 */
const Countdown = ({ targetDate }: { targetDate: string }) => {
  const weddingDate = useMemo(() => new Date(targetDate), [targetDate]);

  const subscribeToClock = useCallback(
    (onStoreChange: () => void) => {
      if (weddingDate.getTime() <= Date.now()) {
        return () => {};
      }

      const intervalId = setInterval(() => {
        onStoreChange();
        if (weddingDate.getTime() <= Date.now()) {
          clearInterval(intervalId);
        }
      }, 1000);

      return () => {
        clearInterval(intervalId);
      };
    },
    [weddingDate]
  );

  const getTickSnapshot = useCallback(() => {
    const difference = weddingDate.getTime() - Date.now();
    if (difference <= 0) {
      return 0;
    }
    return Math.floor(difference / 1000) + 1;
  }, [weddingDate]);

  const ticksRemaining = useSyncExternalStore(
    subscribeToClock,
    getTickSnapshot,
    getServerTickSnapshot
  );

  const isMounted = ticksRemaining >= 0;

  const timeLeft = useMemo<TimeLeft>(() => {
    if (ticksRemaining <= 0) {
      return {};
    }
    const totalSeconds = ticksRemaining - 1;
    return {
      days: Math.floor(totalSeconds / (60 * 60 * 24)),
      hours: Math.floor((totalSeconds / (60 * 60)) % 24),
      minutes: Math.floor((totalSeconds / 60) % 60),
      seconds: Math.floor(totalSeconds % 60),
    };
  }, [ticksRemaining]);

  const [announcement, setAnnouncement] = useState('');

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

  const screenReaderText = isMounted
    ? timerComponents.length
      ? `${timeLeft.days || 0} ${(timeLeft.days || 0) === 1 ? 'day' : 'days'}, ${timeLeft.hours || 0} ${(timeLeft.hours || 0) === 1 ? 'hour' : 'hours'}, ${timeLeft.minutes || 0} ${(timeLeft.minutes || 0) === 1 ? 'minute' : 'minutes'}, ${timeLeft.seconds || 0} ${(timeLeft.seconds || 0) === 1 ? 'second' : 'seconds'} to go!`
      : 'The wedding day is here!'
    : `${formatDate(weddingDate)}`;

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const message = `Countdown status: ${screenReaderText}`;
        setAnnouncement((prev) => (prev === message ? `${message}\u00A0` : message));
      }
    },
    [screenReaderText]
  );

  return (
    <div className="inline-block">
      {!isMounted ? (
        <div
          tabIndex={0}
          className="text-2xl font-bold text-primary dark:text-primary-text focus:outline-none focus:ring-2 focus:ring-primary dark:focus:ring-primary-text focus:ring-offset-2 rounded-md"
          aria-label={`Target wedding date: ${formatDate(weddingDate)}`}
          onKeyDown={handleKeyDown}
        >
          {formatDate(weddingDate)}
        </div>
      ) : timerComponents.length ? (
        <>
          <div className="sr-only" role="status" aria-live="polite">
            {announcement}
          </div>
          <div
            className="text-2xl font-bold text-primary dark:text-primary-text focus:outline-none focus:ring-2 focus:ring-primary dark:focus:ring-primary-text focus:ring-offset-2 rounded-md transition-shadow"
            role="timer"
            aria-label={screenReaderText}
            tabIndex={0}
            onKeyDown={handleKeyDown}
          >
            <span aria-hidden="true">
              {timerComponents} to go!
            </span>
          </div>
        </>
      ) : (
        <div
          className="text-2xl font-bold text-primary dark:text-primary-text focus:outline-none focus:ring-2 focus:ring-primary dark:focus:ring-primary-text focus:ring-offset-2 rounded-md"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label="The wedding day is here!"
          tabIndex={0}
          onKeyDown={handleKeyDown}
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
