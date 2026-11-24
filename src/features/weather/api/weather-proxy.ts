
import { getAppConfig } from '@/lib/config';
import { geocodeBestMatch } from '@/lib/geocoding';
import { hasValidCoordinates } from '@/utils/maps';
import {
  computeLiveForecastAvailableDate,
  formatForecastDateInTimezone,
  getLocalizedClimateFallback,
  TEMPERATE_DEFAULT_LAT,
  TEMPERATE_DEFAULT_LON,
} from '../climateFallback';

type NextFetchRequestInit = RequestInit & {
  next?: {
    revalidate?: number;
  };
};

export async function getWeatherForecast() {
  const config = await getAppConfig();
  const WEDDING_DAY = formatForecastDateInTimezone(config.weddingDate, config.timezone);

  let LAT = TEMPERATE_DEFAULT_LAT;
  let LON = TEMPERATE_DEFAULT_LON;

  if (hasValidCoordinates(config.latitude, config.longitude)) {
    LAT = config.latitude;
    LON = config.longitude;
  } else if (process.env.STATIC_EXPORT !== 'true') {
    const geocoded = await geocodeBestMatch([
      config.venueAddress,
      config.venueCity,
      config.venueState,
      config.venueZip,
    ]);
    if (geocoded && hasValidCoordinates(geocoded.latitude, geocoded.longitude)) {
      LAT = geocoded.latitude;
      LON = geocoded.longitude;
    }
  }

  const todayStr = formatForecastDateInTimezone(new Date(), config.timezone);
  const todayMs = Date.parse(`${todayStr}T00:00:00Z`);
  const weddingMs = Date.parse(`${WEDDING_DAY}T00:00:00Z`);

  const diffInDays = Math.round((weddingMs - todayMs) / (1000 * 60 * 60 * 24));
  const liveForecastAvailableDate = computeLiveForecastAvailableDate(
    WEDDING_DAY,
    config.timezone
  );

  // If outside 16-day forecast horizon (future beyond 16 days or past), query Open-Meteo Climate API
  if (diffInDays > 16 || diffInDays < 0) {
    try {
      const response = await fetch(
        `https://climate-api.open-meteo.com/v1/climate?latitude=${LAT}&longitude=${LON}&start_date=${WEDDING_DAY}&end_date=${WEDDING_DAY}&models=CMCC_CM2_VHR4&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_sum,wind_speed_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=${encodeURIComponent(config.timezone)}`,
        {
          signal: AbortSignal.timeout(5000),
          next: { revalidate: 3600 },
        } satisfies NextFetchRequestInit as RequestInit
      );

      if (response.ok) {
        const data = await response.json();
        if (data && data.daily && Array.isArray(data.daily.temperature_2m_max) && data.daily.temperature_2m_max.length > 0) {
          const daily = data.daily;
          const tMax = daily.temperature_2m_max[0];
          const tMin = daily.temperature_2m_min[0];
          const appMax = daily.apparent_temperature_max?.[0] ?? tMax;
          const pSum = daily.precipitation_sum?.[0] ?? 0;
          const pProb = daily.precipitation_probability_max?.[0] ?? Math.min(100, Math.round(pSum * 20));
          const wSpeed = daily.wind_speed_10m_max?.[0] ?? 8;
          const wCode = daily.weathercode?.[0] ?? (pSum > 2 ? 61 : pSum > 0 ? 51 : 1);

          return {
            isLiveForecast: false,
            liveForecastAvailableDate,
            daily: {
              time: daily.time ?? [WEDDING_DAY],
              weathercode: [wCode],
              temperature_2m_max: [Math.round(tMax)],
              temperature_2m_min: [Math.round(tMin)],
              apparent_temperature_max: [Math.round(appMax)],
              precipitation_probability_max: [Math.round(pProb)],
              wind_speed_10m_max: [Math.round(wSpeed)],
            },
          };
        }
      }
    } catch {
      // Fall through to localized climate fallback on network failure or API error
    }

    return getLocalizedClimateFallback(LAT, LON, WEDDING_DAY, liveForecastAvailableDate);
  }

  // Inside 16-day window: query live forecast API
  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&daily=weathercode,temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_probability_max,wind_speed_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&start_date=${WEDDING_DAY}&end_date=${WEDDING_DAY}&timezone=${encodeURIComponent(config.timezone)}`,
      {
        signal: AbortSignal.timeout(5000),
        next: { revalidate: 3600 },
      } satisfies NextFetchRequestInit as RequestInit
    );

    if (!response.ok) {
      return getLocalizedClimateFallback(LAT, LON, WEDDING_DAY, liveForecastAvailableDate);
    }

    const data = await response.json();
    return {
      isLiveForecast: true,
      ...data,
    };
  } catch {
    return getLocalizedClimateFallback(LAT, LON, WEDDING_DAY, liveForecastAvailableDate);
  }
}


