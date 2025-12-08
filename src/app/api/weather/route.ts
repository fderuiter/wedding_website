import { NextResponse } from 'next/server';
import 'isomorphic-fetch';

const ROCHESTER_LAT = 44.0232;
const ROCHESTER_LON = -92.4630;
const WEDDING_DAY = '2025-10-10';

/**
 * @api {get} /api/weather
 * @description Fetches the weather forecast for the wedding day in Rochester, MN.
 *
 * This function handles a GET request to retrieve weather data from the Open-Meteo API.
 * It is hardcoded to fetch the forecast for October 10, 2025, at the coordinates of Rochester, MN.
 *
 * @returns {Promise<NextResponse>} A promise that resolves to a `NextResponse` object.
 * On success, it returns a JSON object containing the daily weather forecast.
 * On failure, it returns a 500 status with an error message.
 */
export async function GET() {
  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${ROCHESTER_LAT}&longitude=${ROCHESTER_LON}&daily=weathercode,temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_probability_max,wind_speed_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&start_date=${WEDDING_DAY}&end_date=${WEDDING_DAY}&timezone=America/Chicago`
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
