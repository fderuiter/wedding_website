import { NextResponse } from 'next/server';
import { getAppConfig } from '@/lib/config';
import { ApiError } from '@/utils/ApiError';

export async function getWeatherForecast() {
  const config = await getAppConfig();
  const WEDDING_DAY = config.weddingDate.toISOString().split('T')[0];
  const LAT = config.latitude;
  const LON = config.longitude;

  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&daily=weathercode,temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_probability_max,wind_speed_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&start_date=${WEDDING_DAY}&end_date=${WEDDING_DAY}&timezone=America/Chicago`
  );

  if (!response.ok) {
    throw new ApiError(500, 'Failed to fetch weather data from Open-Meteo');
  }

  const data = await response.json();
  return data;
}
