'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Icon, IconName } from '@/components/ui/Icon';
import { apiClient } from '@/lib/apiClient';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';

interface WeatherData {
  daily: {
    time: string[];
    weathercode: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    apparent_temperature_max: number[];
    precipitation_probability_max: number[];
    wind_speed_10m_max: number[];
  };
}

const getWeatherDescription = (code: number): string => {
  const descriptions: { [key: number]: string } = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Depositing rime fog',
    51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle', 56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',
    61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain', 66: 'Light freezing rain', 67: 'Heavy freezing rain',
    71: 'Slight snow fall', 73: 'Moderate snow fall', 75: 'Heavy snow fall', 77: 'Snow grains',
    80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
    85: 'Slight snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
  };
  return descriptions[code] || 'Unknown';
};

const getWeatherIcon = (code: number): { name: IconName, color: string } => {
  if (code <= 1) return { name: 'Sun', color: 'text-secondary' };
  if (code <= 3) return { name: 'Cloud', color: 'text-gray-400' };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { name: 'CloudRain', color: 'text-blue-400' };
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return { name: 'CloudSnow', color: 'text-sky-300' };
  return { name: 'Cloud', color: 'text-gray-400' };
};

/**
 * @function Forecast
 * @description A React component that fetches and displays the current weather forecast.
 * Shows a styled card skeleton during fetch and a localized error card with a working retry button on failure.
 * @returns {JSX.Element} The rendered Forecast component.
 */
const Forecast: React.FC = () => {
  const [weather, setWeather] = useState<WeatherData['daily'] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWeather = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<WeatherData>('/api/weather');
      setWeather(data.daily);
    } catch (err) {
      console.error('Error fetching weather:', err);
      setError('Failed to load forecast. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWeather();
  }, [fetchWeather]);

  if (isLoading) {
    return (
      <div
        className="bg-white/25 backdrop-blur-lg rounded-[var(--radius-card)] shadow-2xl p-[var(--card-padding)] border border-white/20 max-w-[var(--container-max-w)] mx-auto min-h-[320px] flex flex-col justify-between"
        data-testid="forecast-skeleton"
      >
        <span className="sr-only">Loading forecast...</span>
        <div className="flex flex-col md:flex-row items-center justify-between gap-[var(--grid-gap)]">
          <div className="flex flex-col items-center md:items-start gap-2">
            <Skeleton className="w-16 h-16 rounded-full bg-white/30" />
            <Skeleton className="w-32 h-6 rounded bg-white/30" />
          </div>
          <div className="flex flex-col items-center gap-2">
            <Skeleton className="w-48 h-16 rounded bg-white/30" />
            <Skeleton className="w-24 h-4 rounded bg-white/30" />
          </div>
        </div>
        <div className="mt-8 pt-6 border-t border-white/20 grid grid-cols-1 sm:grid-cols-3 gap-[var(--grid-gap)] text-center">
          <Skeleton className="h-16 w-full rounded-xl bg-white/30" />
          <Skeleton className="h-16 w-full rounded-xl bg-white/30" />
          <Skeleton className="h-16 w-full rounded-xl bg-white/30" />
        </div>
      </div>
    );
  }

  if (error || !weather) {
    return (
      <div
        className="bg-white/25 backdrop-blur-lg rounded-[var(--radius-card)] shadow-2xl p-[var(--card-padding)] border border-white/20 max-w-[var(--container-max-w)] mx-auto text-center flex flex-col items-center justify-center min-h-[300px] space-y-4"
        role="alert"
      >
        <Icon name="AlertTriangle" className="w-12 h-12 text-primary mx-auto mb-1" />
        <h3 className="text-xl font-bold">Unable to Load Weather</h3>
        <p className="text-base text-red-500 font-medium">
          Failed to load forecast. Please try again later.
        </p>
        <Button onClick={fetchWeather} variant="primary" size="md">
          Retry
        </Button>
      </div>
    );
  }

  const today = {
    high: Math.round(weather.temperature_2m_max[0]),
    low: Math.round(weather.temperature_2m_min[0]),
    feelsLikeHigh: Math.round(weather.apparent_temperature_max[0]),
    precipitation: weather.precipitation_probability_max[0],
    windSpeed: Math.round(weather.wind_speed_10m_max[0]),
    description: getWeatherDescription(weather.weathercode[0]),
    icon: getWeatherIcon(weather.weathercode[0]),
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 'calc(20px * var(--scale-factor, 1))' }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8 }}
      className="bg-white/25 backdrop-blur-lg rounded-[var(--radius-card)] shadow-2xl p-[var(--card-padding)] border border-white/20 max-w-[var(--container-max-w)] mx-auto"
    >
      <div className="flex flex-col md:flex-row items-center justify-between gap-[var(--grid-gap)]">
        <div className="text-center md:text-left">
          <Icon name={today.icon.name} className={today.icon.color} style={{ width: 'calc(64px * var(--scale-factor, 1))', height: 'calc(64px * var(--scale-factor, 1))' }} />
          <p className="text-2xl font-bold mt-2">{today.description}</p>
        </div>
        <div className="text-center">
          <p data-testid="temperature" className="text-6xl md:text-7xl font-extrabold tracking-tight">
            {today.high}°<span className="text-4xl md:text-5xl opacity-70">/{today.low}°</span>
          </p>
          <p className="text-sm opacity-80 mt-1">
            Feels like {today.feelsLikeHigh}°
          </p>
        </div>
      </div>

      <div className="mt-8 pt-6 border-t border-white/20 grid grid-cols-1 sm:grid-cols-3 gap-[var(--grid-gap)] text-center">
        <motion.div whileHover={{ scale: 1.05 }} className="flex flex-col items-center">
          <Icon name="Droplets" className="opacity-70" style={{ width: 'calc(24px * var(--scale-factor, 1))', height: 'calc(24px * var(--scale-factor, 1))' }} />
          <p className="font-bold mt-1">Precipitation</p>
          <p className="text-lg">{today.precipitation}%</p>
        </motion.div>
        <motion.div whileHover={{ scale: 1.05 }} className="flex flex-col items-center">
          <Icon name="Wind" className="opacity-70" style={{ width: 'calc(24px * var(--scale-factor, 1))', height: 'calc(24px * var(--scale-factor, 1))' }} />
          <p className="font-bold mt-1">Wind</p>
          <p className="text-lg">{today.windSpeed} mph</p>
        </motion.div>
        <motion.div whileHover={{ scale: 1.05 }} className="flex flex-col items-center">
          <Icon name="Thermometer" className="opacity-70" style={{ width: 'calc(24px * var(--scale-factor, 1))', height: 'calc(24px * var(--scale-factor, 1))' }} />
          <p className="font-bold mt-1">Feels Like</p>
          <p className="text-lg">{today.feelsLikeHigh}°</p>
        </motion.div>
      </div>
    </motion.div>
  );
};

export default Forecast;
