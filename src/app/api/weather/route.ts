import { NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { getWeatherForecast } from '@/features/weather/api/weather-proxy';

export const GET = withApiMiddleware(async () => {
  const data = await getWeatherForecast();
  return NextResponse.json(data);
});
