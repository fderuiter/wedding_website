
import { getAppConfig } from '@/lib/config';

function getYYYYMMDD(date: Date, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date);
  } catch {
    return date.toISOString().split('T')[0];
  }
}

function getSeasonalFallback(weddingDayStr: string, availableDateStr: string) {
  return {
    isLiveForecast: false,
    liveForecastAvailableDate: availableDateStr,
    daily: {
      time: [weddingDayStr],
      weathercode: [1],
      temperature_2m_max: [72],
      temperature_2m_min: [55],
      apparent_temperature_max: [70],
      precipitation_probability_max: [15],
      wind_speed_10m_max: [8],
    },
  };
}

export async function getWeatherForecast() {
  const config = await getAppConfig();
  const WEDDING_DAY = getYYYYMMDD(config.weddingDate, config.timezone);
  const LAT = config.latitude;
  const LON = config.longitude;

  const todayStr = getYYYYMMDD(new Date(), config.timezone);
  const todayMs = Date.parse(`${todayStr}T00:00:00Z`);
  const weddingMs = Date.parse(`${WEDDING_DAY}T00:00:00Z`);

  const diffInDays = Math.round((weddingMs - todayMs) / (1000 * 60 * 60 * 24));
  const availableDateMs = weddingMs - 16 * 24 * 60 * 60 * 1000;
  const liveForecastAvailableDate = getYYYYMMDD(new Date(availableDateMs), config.timezone);

  // If outside 16-day forecast horizon (future beyond 16 days or past), return seasonal fallback
  if (diffInDays > 16 || diffInDays < 0) {
    return getSeasonalFallback(WEDDING_DAY, liveForecastAvailableDate);
  }

  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&daily=weathercode,temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_probability_max,wind_speed_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&start_date=${WEDDING_DAY}&end_date=${WEDDING_DAY}&timezone=${encodeURIComponent(config.timezone)}`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (!response.ok) {
      return getSeasonalFallback(WEDDING_DAY, liveForecastAvailableDate);
    }

    const data = await response.json();
    return {
      isLiveForecast: true,
      ...data,
    };
  } catch {
    return getSeasonalFallback(WEDDING_DAY, liveForecastAvailableDate);
  }
}

