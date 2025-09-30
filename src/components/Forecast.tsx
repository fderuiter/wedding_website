'use client';

import React, { useState, useEffect } from 'react';

interface WeatherData {
  daily: {
    time: string[];
    weathercode: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
  };
}

const getWeatherDescription = (code: number) => {
  const descriptions: { [key: number]: string } = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    56: 'Light freezing drizzle',
    57: 'Dense freezing drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    66: 'Light freezing rain',
    67: 'Heavy freezing rain',
    71: 'Slight snow fall',
    73: 'Moderate snow fall',
    75: 'Heavy snow fall',
    77: 'Snow grains',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail',
  };
  return descriptions[code] || 'Unknown';
};

/**
 * @function Forecast
 * @description A React component that displays a 10-day weather forecast for Rochester, MN.
 * The component fetches weather data from the application's API.
 * @returns {JSX.Element} The rendered Forecast component.
 */
const Forecast: React.FC = () => {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchWeather = async () => {
      try {
        const response = await fetch('/api/weather');
        if (!response.ok) {
          throw new Error('Failed to fetch weather data');
        }
        const data: WeatherData = await response.json();
        setWeather(data);
      } catch (error) {
        console.error('Error fetching weather:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchWeather();
  }, []);

  if (isLoading) {
    return <p className="text-center">Loading weather...</p>;
  }

  if (!weather) {
    return <p className="text-center text-red-500">Failed to load weather data. Please try again later.</p>;
  }

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 text-sm">
        {weather.daily.time.map((day, index) => (
          <div key={day} className="bg-gray-800 text-white p-4 rounded-lg flex flex-col justify-between text-center">
            <div className="font-semibold text-lg">{new Date(day).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })}</div>
            <div className="text-base my-2">{getWeatherDescription(weather.daily.weathercode[index])}</div>
            <div className="text-base">
              H: {Math.round(weather.daily.temperature_2m_max[index])}°F / L: {Math.round(weather.daily.temperature_2m_min[index])}°F
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Forecast;