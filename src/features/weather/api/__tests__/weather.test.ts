import { GET } from '@/app/api/weather/route';
import { getWeatherForecast } from '@/features/weather/api/weather-proxy';
import { server } from '@/mocks/server';
import { http, HttpResponse } from 'msw';
import { getAppConfig, APP_DEFAULTS } from '@/lib/config';

jest.mock('@/lib/config', () => {
  const actual = jest.requireActual('@/lib/config');
  return {
    ...actual,
    getAppConfig: jest.fn(),
  };
});

describe('Weather API Route', () => {
  const mockGetAppConfig = getAppConfig as jest.MockedFunction<typeof getAppConfig>;

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return live forecast with isLiveForecast: true when date is within 16-day horizon', async () => {
    const nearDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const mockConfig = {
      ...APP_DEFAULTS,
      weddingDate: nearDate,
      timezone: 'UTC',
      latitude: 40.7128,
      longitude: -74.006,
      modules: { weather: { enabled: true } },
    };
    mockGetAppConfig.mockResolvedValue(mockConfig as any);

    const mockWeatherData = {
      daily: {
        time: [nearDate.toISOString().split('T')[0]],
        weathercode: [3],
        temperature_2m_max: [75],
        temperature_2m_min: [60],
        apparent_temperature_max: [72],
        precipitation_probability_max: [10],
        wind_speed_10m_max: [15],
      },
    };

    server.use(
      http.get('https://api.open-meteo.com/v1/forecast', () => {
        return HttpResponse.json(mockWeatherData);
      })
    );

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=1800, s-maxage=3600, stale-while-revalidate=86400'
    );
    const body = await response.json();
    expect(body.data.isLiveForecast).toBe(true);
    expect(body.data.daily).toEqual(mockWeatherData.daily);
  });

  it('should query Open-Meteo Climate API with venue coordinates when date is beyond 16 days', async () => {
    const farDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const mockConfig = {
      ...APP_DEFAULTS,
      weddingDate: farDate,
      timezone: 'UTC',
      latitude: 40.7128,
      longitude: -74.006,
      modules: { weather: { enabled: true } },
    };
    mockGetAppConfig.mockResolvedValue(mockConfig as any);

    let requestedUrl = '';
    const mockClimateData = {
      daily: {
        time: [farDate.toISOString().split('T')[0]],
        temperature_2m_max: [78.2],
        temperature_2m_min: [58.4],
        apparent_temperature_max: [76.5],
        precipitation_sum: [0.1],
        wind_speed_10m_max: [7.8],
      },
    };

    server.use(
      http.get('https://climate-api.open-meteo.com/v1/climate', ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json(mockClimateData);
      })
    );

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=1800, s-maxage=3600, stale-while-revalidate=86400'
    );
    const body = await response.json();
    expect(requestedUrl).toContain('latitude=40.7128');
    expect(requestedUrl).toContain('longitude=-74.006');
    expect(body.data.isLiveForecast).toBe(false);
    expect(body.data.liveForecastAvailableDate).toBeDefined();
    expect(body.data.daily.temperature_2m_max[0]).toBe(78);
    expect(body.data.daily.temperature_2m_min[0]).toBe(58);
  });

  it('should fall back to localized climate matrix when Open-Meteo Climate API fails for date > 16 days', async () => {
    const farDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const mockConfig = {
      ...APP_DEFAULTS,
      weddingDate: farDate,
      timezone: 'UTC',
      latitude: 21.3069, // Tropical (Honolulu)
      longitude: -157.8583,
      modules: { weather: { enabled: true } },
    };
    mockGetAppConfig.mockResolvedValue(mockConfig as any);

    server.use(
      http.get('https://climate-api.open-meteo.com/v1/climate', () => {
        return HttpResponse.error();
      })
    );

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.isLiveForecast).toBe(false);
    expect(body.data.liveForecastAvailableDate).toBeDefined();
    expect(body.data.daily.temperature_2m_max[0]).toBeGreaterThanOrEqual(80); // Tropical fallback temp
  });

  it('should prefer live forecast when date falls on day 16 boundary', async () => {
    const day16Date = new Date(Date.now() + 16 * 24 * 60 * 60 * 1000);
    const mockConfig = {
      ...APP_DEFAULTS,
      weddingDate: day16Date,
      timezone: 'UTC',
      latitude: 40.7128,
      longitude: -74.006,
      modules: { weather: { enabled: true } },
    };
    mockGetAppConfig.mockResolvedValue(mockConfig as any);

    const mockWeatherData = {
      daily: {
        time: [day16Date.toISOString().split('T')[0]],
        weathercode: [1],
        temperature_2m_max: [70],
        temperature_2m_min: [55],
        apparent_temperature_max: [68],
        precipitation_probability_max: [5],
        wind_speed_10m_max: [10],
      },
    };

    server.use(
      http.get('https://api.open-meteo.com/v1/forecast', () => {
        return HttpResponse.json(mockWeatherData);
      })
    );

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=1800, s-maxage=3600, stale-while-revalidate=86400'
    );
    const body = await response.json();
    expect(body.data.isLiveForecast).toBe(true);
    expect(body.data.daily).toEqual(mockWeatherData.daily);
  });

  it('should return seasonal climate fallback when fetch fails for date within horizon', async () => {
    const nearDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const mockConfig = {
      ...APP_DEFAULTS,
      weddingDate: nearDate,
      timezone: 'UTC',
      latitude: 40.7128,
      longitude: -74.006,
      modules: { weather: { enabled: true } },
    };
    mockGetAppConfig.mockResolvedValue(mockConfig as any);

    server.use(
      http.get('https://api.open-meteo.com/v1/forecast', () => {
        return HttpResponse.error();
      })
    );

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=1800, s-maxage=3600, stale-while-revalidate=86400'
    );
    const body = await response.json();
    expect(body.data.isLiveForecast).toBe(false);
    expect(body.data.daily).toBeDefined();
  });

  it('should return seasonal climate fallback on non-ok response from Open-Meteo', async () => {
    const nearDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const mockConfig = {
      ...APP_DEFAULTS,
      weddingDate: nearDate,
      timezone: 'UTC',
      latitude: 40.7128,
      longitude: -74.006,
      modules: { weather: { enabled: true } },
    };
    mockGetAppConfig.mockResolvedValue(mockConfig as any);

    server.use(
      http.get('https://api.open-meteo.com/v1/forecast', () => {
        return new HttpResponse(null, { status: 500 });
      })
    );

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=1800, s-maxage=3600, stale-while-revalidate=86400'
    );
    const body = await response.json();
    expect(body.data.isLiveForecast).toBe(false);
    expect(body.data.daily).toBeDefined();
  });

  it('should call fetch with revalidate option set to 3600', async () => {
    const nearDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const mockConfig = {
      ...APP_DEFAULTS,
      weddingDate: nearDate,
      timezone: 'UTC',
      latitude: 40.7128,
      longitude: -74.006,
      modules: { weather: { enabled: true } },
    };
    mockGetAppConfig.mockResolvedValue(mockConfig as any);

    const fetchSpy = jest.spyOn(global, 'fetch');

    server.use(
      http.get('https://api.open-meteo.com/v1/forecast', () => {
        return HttpResponse.json({ daily: {} });
      })
    );

    await getWeatherForecast();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://api.open-meteo.com/v1/forecast'),
      expect.objectContaining({
        next: { revalidate: 3600 },
      })
    );
  });

  describe('getLocalizedClimateFallback', () => {
    const { getLocalizedClimateFallback } = require('@/features/weather/api/weather-proxy');

    it('should return tropical matrix estimates for tropical latitudes in July', () => {
      const fallback = getLocalizedClimateFallback(20.0, -157.0, '2027-07-15', '2027-06-29');
      expect(fallback.isLiveForecast).toBe(false);
      expect(fallback.daily.temperature_2m_max[0]).toBe(87);
      expect(fallback.daily.temperature_2m_min[0]).toBe(74);
    });

    it('should invert seasons for southern hemisphere latitudes', () => {
      // In January, southern hemisphere (Sydney: -33.86) has summer (July equivalent in Northern matrix -> high 90)
      const fallback = getLocalizedClimateFallback(-33.86, 151.2, '2027-01-15', '2026-12-30');
      expect(fallback.isLiveForecast).toBe(false);
      expect(fallback.daily.temperature_2m_max[0]).toBe(90);
    });

    it('should return cool temperate matrix estimates for high northern latitudes in January', () => {
      const fallback = getLocalizedClimateFallback(51.5, -0.12, '2027-01-15', '2026-12-30');
      expect(fallback.isLiveForecast).toBe(false);
      expect(fallback.daily.temperature_2m_max[0]).toBe(36);
      expect(fallback.daily.temperature_2m_min[0]).toBe(25);
    });
  });
});

