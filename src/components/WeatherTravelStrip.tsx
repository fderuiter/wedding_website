'use client'

import React, { useState, useEffect } from 'react'
import { Sun, Cloud, CloudRain, CloudSnow, CloudSun, Zap, Wind } from 'lucide-react'

interface WeatherData {
  daily: {
    time: string[]
    weathercode: number[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
  }
}

const weatherIcons: { [key: number]: React.ReactNode } = {
  0: <Sun className="w-8 h-8 text-yellow-400" />,
  1: <CloudSun className="w-8 h-8 text-gray-400" />,
  2: <Cloud className="w-8 h-8 text-gray-500" />,
  3: <Cloud className="w-8 h-8 text-gray-600" />,
  45: <Wind className="w-8 h-8 text-gray-400" />,
  48: <Wind className="w-8 h-8 text-gray-400" />,
  51: <CloudRain className="w-8 h-8 text-blue-400" />,
  53: <CloudRain className="w-8 h-8 text-blue-500" />,
  55: <CloudRain className="w-8 h-8 text-blue-600" />,
  61: <CloudRain className="w-8 h-8 text-blue-400" />,
  63: <CloudRain className="w-8 h-8 text-blue-500" />,
  65: <CloudRain className="w-8 h-8 text-blue-600" />,
  71: <CloudSnow className="w-8 h-8 text-blue-200" />,
  73: <CloudSnow className="w-8 h-8 text-blue-300" />,
  75: <CloudSnow className="w-8 h-8 text-blue-400" />,
  80: <CloudRain className="w-8 h-8 text-blue-500" />,
  81: <CloudRain className="w-8 h-8 text-blue-600" />,
  82: <CloudRain className="w-8 h-8 text-blue-700" />,
  95: <Zap className="w-8 h-8 text-yellow-500" />,
  96: <Zap className="w-8 h-8 text-yellow-600" />,
  99: <Zap className="w-8 h-8 text-yellow-700" />,
}

const WeatherTravelStrip = () => {
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchWeather = async () => {
      try {
        const response = await fetch(
          'https://api.open-meteo.com/v1/forecast?latitude=44.02&longitude=-92.46&daily=weathercode,temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timeformat=unixtime&timezone=America%2FChicago&forecast_days=10'
        )
        if (!response.ok) {
          throw new Error('Failed to fetch weather data')
        }
        const data: WeatherData = await response.json()
        setWeather(data)
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message)
        } else {
          setError('An unknown error occurred')
        }
      } finally {
        setLoading(false)
      }
    }

    fetchWeather()
  }, [])

  if (loading) {
    return (
      <div className="w-full bg-gray-100 dark:bg-gray-800 p-4 rounded-lg animate-pulse">
        <div className="h-8 bg-gray-300 dark:bg-gray-700 rounded w-1/4 mb-4"></div>
        <div className="flex space-x-4">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="w-24 h-32 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return <div className="text-red-500 text-center p-4">Error: {error}</div>
  }

  if (!weather) {
    return null
  }

  return (
    <div className="bg-white dark:bg-gray-800 shadow-lg rounded-lg p-4 my-8">
      <h2 className="text-2xl font-bold text-rose-700 dark:text-rose-400 mb-4 text-center">10-Day Weather Forecast & Travel</h2>
      <div className="flex flex-wrap justify-center gap-4 pb-4">
        {weather.daily.time.map((time, index) => (
          <div key={time} className="flex-shrink-0 w-32 text-center bg-gray-50 dark:bg-gray-700 p-3 rounded-lg shadow-md">
            <p className="font-semibold text-md">{new Date(parseInt(time) * 1000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
            <div className="my-2 flex justify-center">{weatherIcons[weather.daily.weathercode[index]] || <Sun className="w-8 h-8 text-yellow-400" />}</div>
            <p className="text-lg font-bold">{Math.round(weather.daily.temperature_2m_max[index])}°F</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Min: {Math.round(weather.daily.temperature_2m_min[index])}°F</p>
          </div>
        ))}
      </div>
       <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row justify-center items-center space-y-2 sm:space-y-0 sm:space-x-6">
        <h3 className="text-lg font-semibold">Airport Status:</h3>
        <a href="https://rstairport.com/" target="_blank" rel="noopener noreferrer" className="text-rose-600 dark:text-rose-400 hover:underline">
          Rochester (RST)
        </a>
        <a href="https://www.mspairport.com/" target="_blank" rel="noopener noreferrer" className="text-rose-600 dark:text-rose-400 hover:underline">
          Minneapolis (MSP)
        </a>
      </div>
    </div>
  )
}

export default WeatherTravelStrip
