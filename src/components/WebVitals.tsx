'use client';

import { useReportWebVitals } from 'next/web-vitals';
import { track } from '@vercel/analytics';

export function WebVitals() {
  useReportWebVitals((metric) => {
    track(metric.name, { value: metric.value, rating: metric.rating });
  });
  return null;
}
