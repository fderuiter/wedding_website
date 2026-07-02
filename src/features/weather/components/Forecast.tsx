'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Icon, IconName } from '@/components/ui/Icon';
import { apiClient } from '@/lib/apiClient';

/**
 * @interface WeatherData
 * @description Defines the structure of the weather data received from the API.
 * @property {object} daily - Object containing arrays of daily weather data.
 * @property {string[]} daily.time - Array of dates.
 * @property {number[]} daily.weathercode - Array of WMO weather codes.
 * @property {number[]} daily.temperature_2m_max - Array of maximum daily temperatures.
 * @property {number[]} daily.temperature_2m_min - Array of minimum daily temperatures.
 * @property {number[]} daily.apparent_temperature_max - Array of maximum apparent temperatures.
 * @property {number[]} daily.precipitation_probability_max - Array of maximum precipitation probabilities.
 * @property {number[]} daily.wind_speed_10m_max - Array of maximum wind speeds.
 */
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

/**
 * Helper function to map WMO weather codes to human-readable descriptions.
 * @param {number} code - The WMO weather code.
 * @returns {string} A descriptive string for the weather condition.
 */
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

/**
 * Helper function to select an appropriate icon based on the WMO weather code.
 * @param {number} code - The WMO weather code.
 * @returns {{ name: IconName, color: string }} An object with registry identifier and color for the weather icon.
 */
const getWeatherIcon = (code: number): { name: IconName, color: string } => {
    if (code <= 1) return { name: "Sun", color: "text-secondary" };
    if (code <= 3) return { name: "Cloud", color: "text-gray-400" };
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { name: "CloudRain", color: "text-blue-400" };
    if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return { name: "CloudSnow", color: "text-sky-300" };
    return { name: "Cloud", color: "text-gray-400" };
};

/**
 * @function Forecast
 * @description A React component that fetches and displays the current weather forecast.
 * It shows the current temperature (high/low), feels like temperature, precipitation probability,
 * wind speed, and a weather icon/description.
 * @returns {JSX.Element} The rendered Forecast component.
 */
const Forecast: React.FC = () => {
    const [weather, setWeather] = useState<WeatherData['daily'] | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchWeather = async () => {
            try {
                const data = await apiClient.get<WeatherData>('/api/weather');
                setWeather(data.daily);
            } catch (error) {
                console.error('Error fetching weather:', error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchWeather();
    }, []);

    if (isLoading) {
        return <div className="text-center p-10">Loading forecast...</div>;
    }

    if (!weather) {
        return <div className="text-center text-red-500 p-10">Failed to load forecast. Please try again later.</div>;
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
            initial={{ opacity: 0, y: "calc(20px * var(--scale-factor))" }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="bg-white/25 backdrop-blur-lg rounded-3xl shadow-2xl p-6 md:p-10 border border-white/20 max-w-2xl mx-auto"
        >
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="text-center md:text-left">
                    <Icon name={today.icon.name} className={today.icon.color} style={{ width: 'calc(64px * var(--scale-factor))', height: 'calc(64px * var(--scale-factor))' }} />
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

            <div className="mt-8 pt-6 border-t border-white/20 grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
                <motion.div whileHover={{ scale: 1.05 }} className="flex flex-col items-center">
                    <Icon name="Droplets" className="opacity-70" style={{ width: 'calc(24px * var(--scale-factor))', height: 'calc(24px * var(--scale-factor))' }} />
                    <p className="font-bold mt-1">Precipitation</p>
                    <p className="text-lg">{today.precipitation}%</p>
                </motion.div>
                <motion.div whileHover={{ scale: 1.05 }} className="flex flex-col items-center">
                    <Icon name="Wind" className="opacity-70" style={{ width: 'calc(24px * var(--scale-factor))', height: 'calc(24px * var(--scale-factor))' }} />
                    <p className="font-bold mt-1">Wind</p>
                    <p className="text-lg">{today.windSpeed} mph</p>
                </motion.div>
                <motion.div whileHover={{ scale: 1.05 }} className="flex flex-col items-center">
                    <Icon name="Thermometer" className="opacity-70" style={{ width: 'calc(24px * var(--scale-factor))', height: 'calc(24px * var(--scale-factor))' }} />
                    <p className="font-bold mt-1">Feels Like</p>
                    <p className="text-lg">{today.feelsLikeHigh}°</p>
                </motion.div>
            </div>
        </motion.div>
    );
};

export default Forecast;