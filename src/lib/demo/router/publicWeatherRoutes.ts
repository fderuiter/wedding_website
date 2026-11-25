import { ARCHETYPE_PRESETS } from '@/lib/sampleData/archetypes';
import {
  computeLiveForecastAvailableDate,
  formatForecastDateInTimezone,
  getLocalizedClimateFallback,
} from '@/utils/climateFallback';
import { getActiveArchetypeDataset, getDemoState } from '../demoStore';
import { jsonResponse, type DemoRouteContext } from './http';

function buildDemoWeatherPayload() {
  const demoState = getDemoState();
  const presetConfig = (ARCHETYPE_PRESETS[demoState.archetype] ?? ARCHETYPE_PRESETS.classic)
    .siteConfig;
  const overrides = demoState.configOverrides;

  const latitude =
    typeof overrides.latitude === 'number' && Number.isFinite(overrides.latitude)
      ? overrides.latitude
      : presetConfig.latitude;
  const longitude =
    typeof overrides.longitude === 'number' && Number.isFinite(overrides.longitude)
      ? overrides.longitude
      : presetConfig.longitude;
  const timezone =
    (typeof overrides.timezone === 'string' && overrides.timezone.trim()) ||
    presetConfig.timezone ||
    'UTC';

  const rawWeddingDate =
    overrides.weddingDate instanceof Date && !Number.isNaN(overrides.weddingDate.getTime())
      ? overrides.weddingDate
      : typeof overrides.weddingDate === 'string' && overrides.weddingDate
        ? new Date(overrides.weddingDate)
        : new Date(presetConfig.weddingDate);
  const weddingDate = Number.isNaN(rawWeddingDate.getTime())
    ? new Date('2026-09-19T16:00:00.000Z')
    : rawWeddingDate;

  const weddingDayStr = formatForecastDateInTimezone(weddingDate, timezone);
  const availableDateStr = computeLiveForecastAvailableDate(weddingDayStr, timezone);
  const climate = getLocalizedClimateFallback(latitude, longitude, weddingDayStr, availableDateStr);

  const venue = {
    name: overrides.venueName ?? presetConfig.venueName,
    city: overrides.venueCity ?? presetConfig.venueCity,
    state: overrides.venueState ?? presetConfig.venueState,
    latitude,
    longitude,
    timezone,
  };

  const forecast = {
    latitude,
    longitude,
    timezone,
    venue,
    ...climate,
    daily_units: {
      time: 'iso8601',
      weathercode: 'wmo code',
      temperature_2m_max: '°F',
      temperature_2m_min: '°F',
      apparent_temperature_max: '°F',
      precipitation_probability_max: '%',
      wind_speed_10m_max: 'mph',
    },
  };

  return {
    success: true,
    data: forecast,
    ...forecast,
  };
}

export async function handlePublicAndWeatherRoutes(
  ctx: DemoRouteContext
): Promise<Response | null> {
  const { path, method, url } = ctx;
  const lowerPath = path.toLowerCase();

  if (
    (lowerPath === '/api/health' || lowerPath === '/api/live' || lowerPath === '/api/ready') &&
    method === 'GET'
  ) {
    return jsonResponse({
      status: 'ok',
      healthy: true,
      ready: true,
      mode: 'static-demo',
      timestamp: new Date().toISOString(),
    });
  }

  if (path === '/api/weather' && method === 'GET') {
    return jsonResponse(buildDemoWeatherPayload());
  }

  if (path === '/api/photos' && method === 'GET') {
    const dataset = getActiveArchetypeDataset();
    const sinceParam = url.searchParams.get('since');
    let sinceTime = 0;
    if (sinceParam) {
      const parsed = new Date(sinceParam).getTime();
      if (Number.isNaN(parsed)) {
        return jsonResponse(
          {
            success: false,
            error: 'Invalid "since" parameter. Must be a valid ISO 8601 date string.',
          },
          400
        );
      }
      sinceTime = parsed;
    }

    const allActivePhotos = dataset.photos.filter(
      (p) => p.status === 'APPROVED' && p.isVisible && Boolean(p.url)
    );

    const approvedPhotos = allActivePhotos
      .filter((p) => {
        if (sinceTime > 0) {
          const updated = new Date(p.updatedAt || p.createdAt).getTime();
          return updated > sinceTime;
        }
        return true;
      })
      .map((p) => ({
        id: p.nodeId,
        mediaId: p.mediaId,
        url: p.url,
        title: p.title,
        altText: p.altText || p.title,
        ...(p.caption ? { caption: p.caption } : {}),
        ...(p.uploaderName ? { uploaderName: p.uploaderName } : {}),
        ...(p.isGuestUpload ? { isGuestUpload: true } : {}),
        category: p.category,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }));

    return jsonResponse({
      success: true,
      photos: approvedPhotos,
      data: approvedPhotos,
      ...(sinceTime > 0 ? { activeIds: allActivePhotos.map((p) => p.nodeId) } : {}),
    });
  }

  return null;
}
