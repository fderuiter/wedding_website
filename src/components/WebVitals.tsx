'use client';

import { useReportWebVitals } from 'next/web-vitals';
import { track } from '@vercel/analytics';

/**
 * @function WebVitals
 * @description A React component that reports Web Vitals to Vercel Analytics.
 * This component uses the `useReportWebVitals` hook from Next.js to send performance metrics.
 * It does not render any UI.
 * @returns {null} This component returns null.
 */
export function WebVitals() {
  useReportWebVitals((metric) => {
    track(metric.name, { value: metric.value, rating: metric.rating });
  });
  return null;
}
