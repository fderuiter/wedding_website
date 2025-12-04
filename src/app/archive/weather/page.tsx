import React from 'react';
import { Metadata } from 'next';
import Forecast from '@/components/Forecast';

export const metadata: Metadata = {
  title: 'Weather Forecast',
  description: 'The weather forecast for our big day!',
};

/**
 * @page WeatherPage
 * @description A page to display the weather forecast for the wedding day.
 *
 * @returns {JSX.Element} The rendered WeatherPage component.
 */
export default function WeatherPage() {
  return (
    <div className="container mx-auto px-4 py-12 sm:py-16 md:py-20">
      <h1 className="text-4xl sm:text-5xl font-extrabold text-center mb-4 text-transparent bg-clip-text bg-gradient-to-r from-rose-700 to-amber-500">
        The Forecast for Our Big Day
      </h1>
      <p className="text-center text-lg sm:text-xl text-gray-400 mb-10">
        October 10, 2025
      </p>
      <Forecast />
    </div>
  );
}