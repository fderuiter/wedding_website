'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface WeatherData {
  daily: {
    time: string[];
    weathercode: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
  };
}

const WEDDING_DATE = new Date('2025-10-10T00:00:00');

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
 * @function TravelStrip
 * @description A React component that displays a travel information strip.
 * This strip appears 10 days before the wedding date and shows a 10-day weather forecast
 * for Rochester, MN, along with quick links to airport status pages.
 * The component fetches weather data from the application's API.
 * @returns {JSX.Element | null} The rendered TravelStrip component or null if not visible.
 */
const TravelStrip: React.FC = () => {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const today = new Date();
    const diffTime = WEDDING_DATE.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 10 && diffDays >= 0) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  }, []);

  useEffect(() => {
    if (isVisible) {
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
        }
      };

      fetchWeather();
    }
  }, [isVisible]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.5 }}
          className="bg-gray-800 text-white p-4 text-center"
        >
          <div className="container mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="w-full">
              <h3 className="font-bold text-lg mb-3">10-Day Forecast for Rochester, MN</h3>
              {weather ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                  {weather.daily.time.map((day, index) => (
                    <div key={day} className="bg-gray-700 p-3 rounded-lg flex flex-col justify-between">
                      <div className="font-semibold">{new Date(day).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })}</div>
                      <div className="text-xs my-1">{getWeatherDescription(weather.daily.weathercode[index])}</div>
                      <div>
                        H: {Math.round(weather.daily.temperature_2m_max[index])}°F / L: {Math.round(weather.daily.temperature_2m_min[index])}°F
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p>Loading weather...</p>
              )}
            </div>
            <div className="flex flex-col items-center md:items-end mt-4 md:mt-0 md:w-auto">
                <h3 className="font-bold text-lg">Quick Travel Links</h3>
                <a href="https://flyrst.com/arrivals-departures-airline-information/" target="_blank" rel="noopener noreferrer" className="hover:text-rose-400 mt-2">
                    RST Airport Status
                </a>
                <a href="https://www.mspairport.com/flights-and-airlines/flights" target="_blank" rel="noopener noreferrer" className="hover:text-rose-400 mt-1">
                    MSP Airport Status
                </a>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default TravelStrip;