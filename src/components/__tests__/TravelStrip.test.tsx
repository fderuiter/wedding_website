import React from 'react';
import { render, screen } from '@testing-library/react';
import fetchMock from 'jest-fetch-mock';
import TravelStrip from '@/components/TravelStrip';

describe('TravelStrip', () => {
  const mockWeatherData = {
    daily: {
      time: ['2025-10-01', '2025-10-02'],
      weathercode: [1, 80],
      temperature_2m_max: [70, 65],
      temperature_2m_min: [50, 45],
    },
  };

  beforeEach(() => {
    fetchMock.resetMocks();
  });

  it('should not be visible more than 10 days before the wedding', () => {
    jest.useFakeTimers().setSystemTime(new Date('2025-09-29'));
    render(<TravelStrip />);
    expect(screen.queryByText('10-Day Forecast for Rochester, MN')).not.toBeInTheDocument();
  });

  it('should be visible within 10 days of the wedding', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2025-10-01'));
    fetchMock.mockResponseOnce(JSON.stringify(mockWeatherData));

    render(<TravelStrip />);

    expect(await screen.findByText('10-Day Forecast for Rochester, MN')).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('RST Airport Status')).toBeInTheDocument();
    expect(screen.getByText('MSP Airport Status')).toBeInTheDocument();
  });

  it('should display weather data when visible', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2025-10-05'));
    fetchMock.mockResponseOnce(JSON.stringify(mockWeatherData));

    render(<TravelStrip />);

    expect(await screen.findByText('Mainly clear')).toBeInTheDocument();
    expect(await screen.findByText(/H: 70°F \/ L: 50°F/)).toBeInTheDocument();
    expect(await screen.findByText('Slight rain showers')).toBeInTheDocument();
    expect(await screen.findByText(/H: 65°F \/ L: 45°F/)).toBeInTheDocument();
  });

  it('should be visible on the wedding day', () => {
    jest.useFakeTimers().setSystemTime(new Date('2025-10-10'));
    render(<TravelStrip />);
    expect(screen.queryByText('10-Day Forecast for Rochester, MN')).toBeInTheDocument();
  });

  it('should not be visible after the wedding day', () => {
    jest.useFakeTimers().setSystemTime(new Date('2025-10-11'));
    render(<TravelStrip />);
    expect(screen.queryByText('10-Day Forecast for Rochester, MN')).not.toBeInTheDocument();
  });

  it('should handle fetch errors gracefully', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2025-10-01'));
    fetchMock.mockReject(new Error('API is down'));

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    render(<TravelStrip />);

    expect(await screen.findByText('10-Day Forecast for Rochester, MN')).toBeInTheDocument();
    expect(await screen.findByText('Loading weather...')).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });
});
