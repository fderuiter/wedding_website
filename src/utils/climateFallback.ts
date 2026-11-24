import { hasValidCoordinates } from '@/utils/maps';

export const TEMPERATE_DEFAULT_LAT = 40.7128;
export const TEMPERATE_DEFAULT_LON = -74.006;

export function formatForecastDateInTimezone(date: Date, timezone: string): string {
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

export function computeLiveForecastAvailableDate(
  weddingDayStr: string,
  timezone: string
): string {
  const parsedWeddingMs = Date.parse(`${weddingDayStr}T00:00:00Z`);
  const safeWeddingMs = Number.isFinite(parsedWeddingMs) ? parsedWeddingMs : Date.now();
  const availableDateMs = safeWeddingMs - 16 * 24 * 60 * 60 * 1000;
  return formatForecastDateInTimezone(new Date(availableDateMs), timezone);
}

interface MonthlyClimateStats {
  high: number;
  low: number;
  precipProb: number;
  windSpeed: number;
}

// Monthly climate matrix (Jan-Dec) for latitude bands (Northern Hemisphere baseline)
const TROPICAL_MATRIX: MonthlyClimateStats[] = [
  { high: 85, low: 72, precipProb: 30, windSpeed: 9 },  // Jan
  { high: 85, low: 72, precipProb: 25, windSpeed: 9 },  // Feb
  { high: 86, low: 73, precipProb: 25, windSpeed: 8 },  // Mar
  { high: 87, low: 74, precipProb: 20, windSpeed: 8 },  // Apr
  { high: 88, low: 75, precipProb: 20, windSpeed: 8 },  // May
  { high: 88, low: 75, precipProb: 15, windSpeed: 8 },  // Jun
  { high: 87, low: 74, precipProb: 20, windSpeed: 8 },  // Jul
  { high: 87, low: 74, precipProb: 25, windSpeed: 9 },  // Aug
  { high: 86, low: 74, precipProb: 30, windSpeed: 9 },  // Sep
  { high: 86, low: 73, precipProb: 35, windSpeed: 9 },  // Oct
  { high: 85, low: 73, precipProb: 35, windSpeed: 9 },  // Nov
  { high: 85, low: 72, precipProb: 30, windSpeed: 9 },  // Dec
];

const WARM_TEMPERATE_MATRIX: MonthlyClimateStats[] = [
  { high: 52, low: 35, precipProb: 25, windSpeed: 10 }, // Jan
  { high: 55, low: 37, precipProb: 25, windSpeed: 10 }, // Feb
  { high: 63, low: 44, precipProb: 20, windSpeed: 11 }, // Mar
  { high: 71, low: 51, precipProb: 18, windSpeed: 10 }, // Apr
  { high: 79, low: 60, precipProb: 15, windSpeed: 9 },  // May
  { high: 86, low: 68, precipProb: 12, windSpeed: 8 },  // Jun
  { high: 90, low: 72, precipProb: 15, windSpeed: 8 },  // Jul
  { high: 89, low: 71, precipProb: 18, windSpeed: 8 },  // Aug
  { high: 82, low: 64, precipProb: 15, windSpeed: 8 },  // Sep
  { high: 72, low: 53, precipProb: 15, windSpeed: 9 },  // Oct
  { high: 62, low: 43, precipProb: 20, windSpeed: 9 },  // Nov
  { high: 54, low: 37, precipProb: 22, windSpeed: 10 }, // Dec
];

const COOL_TEMPERATE_MATRIX: MonthlyClimateStats[] = [
  { high: 36, low: 25, precipProb: 35, windSpeed: 12 }, // Jan
  { high: 39, low: 26, precipProb: 30, windSpeed: 11 }, // Feb
  { high: 48, low: 33, precipProb: 25, windSpeed: 11 }, // Mar
  { high: 58, low: 40, precipProb: 20, windSpeed: 10 }, // Apr
  { high: 67, low: 48, precipProb: 18, windSpeed: 9 },  // May
  { high: 74, low: 55, precipProb: 15, windSpeed: 8 },  // Jun
  { high: 78, low: 60, precipProb: 15, windSpeed: 8 },  // Jul
  { high: 76, low: 58, precipProb: 18, windSpeed: 8 },  // Aug
  { high: 68, low: 51, precipProb: 20, windSpeed: 9 },  // Sep
  { high: 56, low: 42, precipProb: 25, windSpeed: 10 }, // Oct
  { high: 44, low: 33, precipProb: 30, windSpeed: 11 }, // Nov
  { high: 38, low: 27, precipProb: 35, windSpeed: 12 }, // Dec
];

const HIGH_LATITUDE_MATRIX: MonthlyClimateStats[] = [
  { high: 20, low: 5, precipProb: 20, windSpeed: 12 },  // Jan
  { high: 22, low: 6, precipProb: 20, windSpeed: 12 },  // Feb
  { high: 30, low: 14, precipProb: 20, windSpeed: 11 }, // Mar
  { high: 42, low: 26, precipProb: 15, windSpeed: 10 }, // Apr
  { high: 53, low: 37, precipProb: 15, windSpeed: 9 },  // May
  { high: 62, low: 46, precipProb: 15, windSpeed: 9 },  // Jun
  { high: 67, low: 51, precipProb: 20, windSpeed: 8 },  // Jul
  { high: 64, low: 48, precipProb: 20, windSpeed: 9 },  // Aug
  { high: 53, low: 39, precipProb: 20, windSpeed: 10 }, // Sep
  { high: 40, low: 28, precipProb: 25, windSpeed: 11 }, // Oct
  { high: 28, low: 16, precipProb: 25, windSpeed: 11 }, // Nov
  { high: 22, low: 8, precipProb: 20, windSpeed: 12 },  // Dec
];

export function getLocalizedClimateFallback(
  latitude: number,
  longitude: number,
  weddingDayStr: string,
  availableDateStr: string
) {
  const safeLat = hasValidCoordinates(latitude, longitude)
    ? latitude
    : TEMPERATE_DEFAULT_LAT;
  const absLat = Math.abs(safeLat);

  const monthMatch = weddingDayStr.match(/^\d{4}-(\d{2})-\d{2}$/);
  const rawMonth = monthMatch ? parseInt(monthMatch[1], 10) - 1 : 0;
  const monthIndex = Math.max(0, Math.min(11, isNaN(rawMonth) ? 0 : rawMonth));

  // If Southern Hemisphere (lat < 0), invert seasons by 6 months
  const effectiveMonth = safeLat < 0 ? (monthIndex + 6) % 12 : monthIndex;

  let matrix = WARM_TEMPERATE_MATRIX;
  if (absLat < 23.5) {
    matrix = TROPICAL_MATRIX;
  } else if (absLat < 45) {
    matrix = WARM_TEMPERATE_MATRIX;
  } else if (absLat < 60) {
    matrix = COOL_TEMPERATE_MATRIX;
  } else {
    matrix = HIGH_LATITUDE_MATRIX;
  }

  const stats = matrix[effectiveMonth];
  const high = stats.high;
  const low = stats.low;
  const apparentHigh = Math.round(high - (high > 80 ? 1 : high < 40 ? 3 : 2));
  const precipProb = stats.precipProb;
  const windSpeed = stats.windSpeed;

  let weathercode = 1;
  if (high <= 32) {
    weathercode = 71;
  } else if (precipProb >= 30) {
    weathercode = 61;
  } else if (precipProb >= 20) {
    weathercode = 2;
  }

  return {
    isLiveForecast: false,
    liveForecastAvailableDate: availableDateStr,
    daily: {
      time: [weddingDayStr],
      weathercode: [weathercode],
      temperature_2m_max: [high],
      temperature_2m_min: [low],
      apparent_temperature_max: [apparentHigh],
      precipitation_probability_max: [precipProb],
      wind_speed_10m_max: [windSpeed],
    },
  };
}
