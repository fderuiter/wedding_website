import { getActiveArchetypeDataset, getDemoState, getEffectiveDemoSettings } from '../demoStore';
import { jsonResponse, type DemoRouteContext } from './http';

function buildDeterministicSevenDayForecast() {
  const demoState = getDemoState();
  const settings = getEffectiveDemoSettings(demoState);
  const archetype = demoState.archetype;

  const baseHigh =
    archetype === 'destination' ? 84 : archetype === 'romantic' ? 76 : 72;
  const baseLow =
    archetype === 'destination' ? 73 : archetype === 'romantic' ? 55 : 57;
  const baseCodes =
    archetype === 'destination'
      ? [1, 0, 2, 1, 0, 2, 1]
      : archetype === 'romantic'
        ? [0, 0, 1, 0, 2, 1, 0]
        : [1, 2, 0, 1, 3, 0, 1];
  const highOffsets = [0, 2, -1, 1, -3, 2, 0];
  const lowOffsets = [0, 1, -1, 0, -2, 1, 0];
  const precipProbs = [10, 15, 20, 10, 25, 10, 15];
  const windSpeeds = [8, 9, 11, 7, 12, 8, 9];

  const rawWeddingIso =
    typeof settings.weddingDate === 'string' && settings.weddingDate
      ? settings.weddingDate
      : '2026-09-19T16:00:00.000Z';
  const parsedStart = new Date(rawWeddingIso);
  const startDate = Number.isNaN(parsedStart.getTime())
    ? new Date('2026-09-19T12:00:00.000Z')
    : parsedStart;

  const time: string[] = [];
  const weathercode: number[] = [];
  const temperature_2m_max: number[] = [];
  const temperature_2m_min: number[] = [];
  const apparent_temperature_max: number[] = [];
  const precipitation_probability_max: number[] = [];
  const wind_speed_10m_max: number[] = [];

  for (let dayIdx = 0; dayIdx < 7; dayIdx += 1) {
    const day = new Date(startDate.getTime() + dayIdx * 86_400_000);
    time.push(day.toISOString().slice(0, 10));
    weathercode.push(baseCodes[dayIdx]);
    const high = baseHigh + highOffsets[dayIdx];
    const low = baseLow + lowOffsets[dayIdx];
    temperature_2m_max.push(high);
    temperature_2m_min.push(low);
    apparent_temperature_max.push(high + (archetype === 'destination' ? 3 : 1));
    precipitation_probability_max.push(precipProbs[dayIdx]);
    wind_speed_10m_max.push(windSpeeds[dayIdx]);
  }

  return {
    latitude: Number(settings.latitude ?? 44.9778),
    longitude: Number(settings.longitude ?? -93.265),
    timezone: String(settings.timezone ?? 'America/Chicago'),
    isLiveForecast: true,
    venue: {
      name: String(settings.venueName ?? 'The Glasshouse Estate'),
      city: String(settings.venueCity ?? 'Chicago'),
      state: String(settings.venueState ?? 'IL'),
    },
    daily_units: {
      time: 'iso8601',
      weathercode: 'wmo code',
      temperature_2m_max: '°F',
      temperature_2m_min: '°F',
      apparent_temperature_max: '°F',
      precipitation_probability_max: '%',
      wind_speed_10m_max: 'mph',
    },
    daily: {
      time,
      weathercode,
      temperature_2m_max,
      temperature_2m_min,
      apparent_temperature_max,
      precipitation_probability_max,
      wind_speed_10m_max,
    },
  };
}

export async function handlePublicAndWeatherRoutes(
  ctx: DemoRouteContext
): Promise<Response | null> {
  const { path, method, url } = ctx;

  if ((path === '/api/health' || path === '/api/live' || path === '/api/ready') && method === 'GET') {
    return jsonResponse({
      status: 'ok',
      healthy: true,
      ready: true,
      mode: 'static-demo',
      timestamp: new Date().toISOString(),
    });
  }

  if (path === '/api/weather' && method === 'GET') {
    const forecast = buildDeterministicSevenDayForecast();
    return jsonResponse(forecast);
  }

  if (path === '/api/photos' && method === 'GET') {
    const dataset = getActiveArchetypeDataset();
    const sinceParam = url.searchParams.get('since');
    let sinceTime = 0;
    if (sinceParam) {
      const parsed = new Date(sinceParam).getTime();
      if (Number.isNaN(parsed)) {
        return jsonResponse(
          { success: false, error: 'Invalid "since" parameter. Must be a valid ISO 8601 date string.' },
          400
        );
      }
      sinceTime = parsed;
    }

    const approvedPhotos = dataset.photos
      .filter((p) => {
        if (p.status !== 'APPROVED' || !p.isVisible || !p.url) return false;
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
    });
  }

  return null;
}
