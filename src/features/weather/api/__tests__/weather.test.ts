import { GET } from '@/app/api/weather/route';
import { server } from '@/mocks/server';
import { rest } from 'msw';

describe('Weather API Route', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return a 200 status code and weather data on success', async () => {
    const mockWeatherData = {
      daily: {
        time: ['2025-10-10'],
        weathercode: [3],
        temperature_2m_max: [75],
        temperature_2m_min: [60],
        apparent_temperature_max: [72],
        precipitation_probability_max: [10],
        wind_speed_10m_max: [15],
      },
    };

    server.use(
      rest.get('https://api.open-meteo.com/v1/forecast', (req, res, ctx) => {
        return res(ctx.json(mockWeatherData));
      })
    );

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual(mockWeatherData);
  });

  it('should return a 500 status code on fetch failure', async () => {
    server.use(
      rest.get('https://api.open-meteo.com/v1/forecast', (req, res, ctx) => {
        return res.networkError('API is down');
      })
    );

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Failed to fetch'); // whatwg-fetch throws this on network error
  });

  it('should return a 500 status code on non-ok response from Open-Meteo', async () => {
    server.use(
      rest.get('https://api.open-meteo.com/v1/forecast', (req, res, ctx) => {
        return res(ctx.status(500));
      })
    );

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ success: false, error: 'Failed to fetch weather data from Open-Meteo' });
  });
});
