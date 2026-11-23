import type { ContributorRecord, RegistryItem } from '@/features/registry';

interface MonthlyClimateStats {
  high: number;
  low: number;
  precipProb: number;
  windSpeed: number;
}

const TROPICAL_MATRIX: MonthlyClimateStats[] = [
  { high: 85, low: 72, precipProb: 30, windSpeed: 9 },
  { high: 85, low: 72, precipProb: 25, windSpeed: 9 },
  { high: 86, low: 73, precipProb: 25, windSpeed: 8 },
  { high: 87, low: 74, precipProb: 20, windSpeed: 8 },
  { high: 88, low: 75, precipProb: 20, windSpeed: 8 },
  { high: 88, low: 75, precipProb: 15, windSpeed: 8 },
  { high: 87, low: 74, precipProb: 20, windSpeed: 8 },
  { high: 87, low: 74, precipProb: 25, windSpeed: 9 },
  { high: 86, low: 74, precipProb: 30, windSpeed: 9 },
  { high: 86, low: 73, precipProb: 35, windSpeed: 9 },
  { high: 85, low: 73, precipProb: 35, windSpeed: 9 },
  { high: 85, low: 72, precipProb: 30, windSpeed: 9 },
];

const WARM_TEMPERATE_MATRIX: MonthlyClimateStats[] = [
  { high: 52, low: 35, precipProb: 25, windSpeed: 10 },
  { high: 55, low: 37, precipProb: 25, windSpeed: 10 },
  { high: 63, low: 44, precipProb: 20, windSpeed: 11 },
  { high: 71, low: 51, precipProb: 18, windSpeed: 10 },
  { high: 79, low: 60, precipProb: 15, windSpeed: 9 },
  { high: 86, low: 68, precipProb: 12, windSpeed: 8 },
  { high: 90, low: 72, precipProb: 15, windSpeed: 8 },
  { high: 89, low: 71, precipProb: 18, windSpeed: 8 },
  { high: 82, low: 64, precipProb: 15, windSpeed: 8 },
  { high: 72, low: 53, precipProb: 15, windSpeed: 9 },
  { high: 62, low: 43, precipProb: 20, windSpeed: 9 },
  { high: 54, low: 37, precipProb: 22, windSpeed: 10 },
];

const COOL_TEMPERATE_MATRIX: MonthlyClimateStats[] = [
  { high: 36, low: 25, precipProb: 35, windSpeed: 12 },
  { high: 39, low: 26, precipProb: 30, windSpeed: 11 },
  { high: 48, low: 33, precipProb: 25, windSpeed: 11 },
  { high: 58, low: 40, precipProb: 20, windSpeed: 10 },
  { high: 67, low: 48, precipProb: 18, windSpeed: 9 },
  { high: 74, low: 55, precipProb: 15, windSpeed: 8 },
  { high: 78, low: 60, precipProb: 15, windSpeed: 8 },
  { high: 76, low: 58, precipProb: 18, windSpeed: 8 },
  { high: 68, low: 51, precipProb: 20, windSpeed: 9 },
  { high: 56, low: 42, precipProb: 25, windSpeed: 10 },
  { high: 44, low: 33, precipProb: 30, windSpeed: 11 },
  { high: 38, low: 27, precipProb: 35, windSpeed: 12 },
];

const HIGH_LATITUDE_MATRIX: MonthlyClimateStats[] = [
  { high: 20, low: 5, precipProb: 20, windSpeed: 12 },
  { high: 22, low: 6, precipProb: 20, windSpeed: 12 },
  { high: 30, low: 14, precipProb: 20, windSpeed: 11 },
  { high: 42, low: 26, precipProb: 15, windSpeed: 10 },
  { high: 53, low: 37, precipProb: 15, windSpeed: 9 },
  { high: 62, low: 46, precipProb: 15, windSpeed: 9 },
  { high: 67, low: 51, precipProb: 20, windSpeed: 8 },
  { high: 64, low: 48, precipProb: 20, windSpeed: 9 },
  { high: 53, low: 39, precipProb: 20, windSpeed: 10 },
  { high: 40, low: 28, precipProb: 25, windSpeed: 11 },
  { high: 28, low: 16, precipProb: 25, windSpeed: 11 },
  { high: 22, low: 8, precipProb: 20, windSpeed: 12 },
];

export function getLocalizedClimateFallback(
  latitude: number,
  _longitude: number,
  weddingDayStr: string,
  availableDateStr: string,
) {
  const safeLat = typeof latitude === 'number' && !Number.isNaN(latitude) ? latitude : 40.7128;
  const absLat = Math.abs(safeLat);

  const monthMatch = weddingDayStr.match(/^\d{4}-(\d{2})-\d{2}$/);
  const rawMonth = monthMatch ? Number.parseInt(monthMatch[1], 10) - 1 : 0;
  const monthIndex = Math.max(0, Math.min(11, Number.isNaN(rawMonth) ? 0 : rawMonth));
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

export function sanitizeRegistryItem(item: RegistryItem) {
  const result = { ...item };
  if (Array.isArray(item.contributors)) {
    result.contributors = item.contributors.map((contributor: ContributorRecord) => {
      const { email: _email, ...rest } = contributor;
      return rest as ContributorRecord;
    });
  }
  return result;
}

export function maskRegistryItem(item: RegistryItem) {
  const result: Record<string, unknown> = { ...item };
  if (item.purchaserName) {
    result.purchaserName = 'Anonymous';
  }
  if (Array.isArray(item.contributors)) {
    result.contributors = item.contributors
      .filter((contributor) => {
        if (!contributor) return false;
        const status = typeof contributor.status === 'string' ? contributor.status.toUpperCase() : 'CONFIRMED';
        return status !== 'CANCELLED' && status !== 'REFUNDED';
      })
      .map(() => ({
        name: 'Anonymous',
        amount: 'Anonymous',
        date: 'Anonymous',
      }));
  }
  return result;
}
