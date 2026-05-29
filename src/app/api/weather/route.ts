import { NextResponse } from 'next/server';
import 'isomorphic-fetch';
import { getAppConfig } from '@/lib/config';

/**
 * @api {get} /api/weather
 * @description Fetches the weather forecast for the wedding day.
 *
 * This function handles a GET request to retrieve weather data from the Open-Meteo API.
 * It fetches the forecast for the configured wedding date and coordinates.
 *
 * @returns {Promise<NextResponse>} A promise that resolves to a `NextResponse` object.
 * On success, it returns a JSON object containing the daily weather forecast.
 * On failure, it returns a 500 status with an error message.
 */
export async function GET() {
  try {
    const config = await getAppConfig();
    const WEDDING_DAY = config.weddingDate.toISOString().split('T')[0];
    const LAT = config.latitude;
    const LON = config.longitude;

    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&daily=weathercode,temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_probability_max,wind_speed_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&start_date=${WEDDING_DAY}&end_date=${WEDDING_DAY}&timezone=America/Chicago`
    );

    if (!response.ok) {
      throw new Error('Failed to fetch weather data from Open-Meteo');
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Weather API error:', error);
    return NextResponse.json({ error: 'Failed to fetch weather data' }, { status: 500 });
  }
}

