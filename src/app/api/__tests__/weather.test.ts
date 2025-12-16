import { GET } from '@/app/api/weather/route';
import { NextRequest } from 'next/server';

// Mock the fetch function
global.fetch = jest.fn();

describe('Weather API Route', () => {
  beforeEach(() => {
    (fetch as jest.Mock).mockClear();
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

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockWeatherData),
    });

    const request = new NextRequest('http://localhost/api/weather');
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(mockWeatherData);
  });

  it('should return a 500 status code on fetch failure', async () => {
    const error = new Error('API is down');
    (fetch as jest.Mock).mockRejectedValueOnce(error);

    const request = new NextRequest('http://localhost/api/weather');
    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: 'Failed to fetch weather data' });
    expect(console.error).toHaveBeenCalledWith('Weather API error:', error);
  });

  it('should return a 500 status code on non-ok response from Open-Meteo', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
    });

    const request = new NextRequest('http://localhost/api/weather');
    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: 'Failed to fetch weather data' });
    expect(console.error).toHaveBeenCalledWith('Weather API error:', expect.any(Error));
  });
});
