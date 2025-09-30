import { NextResponse } from 'next/server';
import 'isomorphic-fetch';

const ROCHESTER_LAT = 44.0232;
const ROCHESTER_LON = -92.4630;
const WEDDING_DAY = '2025-10-10';

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