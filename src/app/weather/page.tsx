import React from 'react';
import { Metadata } from 'next';
import Forecast from '@/components/Forecast';

export const metadata: Metadata = {
  title: 'Weather Forecast',
  description: '10-day weather forecast for Rochester, MN.',
};

/**
 * @page WeatherPage
 * @description A page to display the 10-day weather forecast for Rochester, MN.
 *
 * @returns {JSX.Element} The rendered WeatherPage component.
 */
export default function WeatherPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold text-center mb-8">Rochester, MN Weather</h1>
      <Forecast />
    </div>
  );
}