import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import fetchMock from 'jest-fetch-mock';
import Forecast from '@/components/Forecast';

// Enable fetch mocks
fetchMock.enableMocks();

describe('Forecast Component', () => {
  beforeEach(() => {
    fetchMock.resetMocks();
  });

  it('should display a loading state initially', () => {
    render(<Forecast />);
    expect(screen.getByText('Loading forecast...')).toBeInTheDocument();
  });

  it('should display an error message if the fetch fails', async () => {
    fetchMock.mockReject(new Error('API is down'));
    render(<Forecast />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load forecast. Please try again later.')).toBeInTheDocument();
    });
  });

  it('should render weather data successfully after a successful fetch', async () => {
    const mockWeatherData = {
      daily: {
        time: ['2025-10-10'],
        weathercode: [3],
        temperature_2m_max: [75.5],
        temperature_2m_min: [60.2],
        apparent_temperature_max: [72.8],
        precipitation_probability_max: [15],
        wind_speed_10m_max: [12.3],
      },
    };

    fetchMock.mockResponseOnce(JSON.stringify(mockWeatherData));
    render(<Forecast />);

    await waitFor(() => {
      expect(screen.getByText('Overcast')).toBeInTheDocument();
    });

    const temperatureElement = screen.getByTestId('temperature');
    expect(temperatureElement).toHaveTextContent('76°/60°');
    expect(screen.getByText('Feels like 73°')).toBeInTheDocument();
    expect(screen.getByText('15%')).toBeInTheDocument();
    expect(screen.getByText('12 mph')).toBeInTheDocument();
  });
});