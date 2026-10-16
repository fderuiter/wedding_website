import { NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { getWeatherForecast } from '@/features/weather';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { ApiError } from '@/utils/ApiError';

export const GET = withApiMiddleware(async () => {
  const config = await getAppConfig();
  if (!isFeatureEnabled('weather', config.modules)) {
    throw new ApiError(404, "Feature 'weather' is disabled");
  }
  const data = await getWeatherForecast();
  const response = NextResponse.json(data);
  response.headers.set('Cache-Control', 'public, max-age=1800, s-maxage=3600, stale-while-revalidate=86400');
  return response;
});
