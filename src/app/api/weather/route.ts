import { NextResponse } from 'next/server';
import 'isomorphic-fetch';

const ROCHESTER_LAT = 44.0232;
const ROCHESTER_LON = -92.4630;

export async function GET() {
  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${ROCHESTER_LAT}&longitude=${ROCHESTER_LON}&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=America/Chicago&forecast_days=10&temperature_unit=fahrenheit`
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