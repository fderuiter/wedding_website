'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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

  const calculateTimeLeft = useCallback((): TimeLeft => {
    const now = new Date();
    const difference = weddingDate.getTime() - now.getTime();

    let timeLeft: TimeLeft = {};

    if (difference > 0) {
      timeLeft = {
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((difference / (1000 * 60)) % 60),
        seconds: Math.floor((difference / 1000) % 60),
      };
    }

    return timeLeft;
  }, [weddingDate]);

  const [isMounted, setIsMounted] = useState(false);
  const [timeLeft, setTimeLeft] = useState<TimeLeft>({});

  useEffect(() => {
    setIsMounted(true);
    const initialTimeLeft = calculateTimeLeft();
    setTimeLeft(initialTimeLeft);

    if (Object.keys(initialTimeLeft).length === 0) {
      return;
    }

    const intervalId = setInterval(() => {
      const updatedTimeLeft = calculateTimeLeft();
      setTimeLeft(updatedTimeLeft);
      if (Object.keys(updatedTimeLeft).length === 0) {
        clearInterval(intervalId);
      }
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [calculateTimeLeft]);

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

  return (
    <div>
      {!isMounted ? (
        <span className="text-2xl font-bold text-primary dark:text-primary-text">
          {formatDate(weddingDate)}
        </span>
      ) : timerComponents.length ? (
        <div
          className="text-2xl font-bold text-primary dark:text-primary-text"
          role="timer"
          aria-atomic="true"
        >
          {timerComponents} to go!
        </div>
      ) : (
        <span className="text-2xl font-bold text-primary dark:text-primary-text">
          The wedding day is here!
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {screenReaderText}
      </span>
      <noscript>
        <div className="text-2xl font-bold text-primary dark:text-primary-text">
          {formatDate(weddingDate)}
        </div>
      </noscript>
    </div>
  );
};

export default Countdown;
