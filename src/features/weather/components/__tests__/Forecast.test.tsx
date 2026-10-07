import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import Forecast from '../Forecast';
import { server } from '@/mocks/server';
import { http, HttpResponse } from 'msw';

describe('Forecast Component', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should display a loading state initially with card skeleton', async () => {
    server.use(
      http.get('/api/weather', () => {
        return HttpResponse.json({
          daily: {
            time: ['2025-10-10'],
            weathercode: [0],
            temperature_2m_max: [70],
            temperature_2m_min: [50],
            apparent_temperature_max: [65],
            precipitation_probability_max: [0],
            wind_speed_10m_max: [5],
          }
        });
      })
    );

    render(<Forecast />);

    // Assert loading state and skeleton are present immediately
    expect(screen.getByText('Loading forecast...')).toBeInTheDocument();
    expect(screen.getByTestId('forecast-skeleton')).toBeInTheDocument();

    // Wait for the component to finish updating to prevent "act" warnings
    await waitFor(() => {
      expect(screen.queryByText('Loading forecast...')).not.toBeInTheDocument();
    });
  });

  it('should display an error message and retry button if the fetch fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    server.use(
      http.get('/api/weather', () => {
        return HttpResponse.json({ error: 'API is down' }, { status: 500 });
      })
    );

    render(<Forecast />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load forecast. Please try again later.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it('should re-fetch forecast data when tapping the retry button', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    let attempt = 0;

    server.use(
      http.get('/api/weather', () => {
        attempt++;
        if (attempt === 1) {
          return HttpResponse.json({ error: 'API failure' }, { status: 500 });
        }
        return HttpResponse.json({
          daily: {
            time: ['2025-10-10'],
            weathercode: [0],
            temperature_2m_max: [75],
            temperature_2m_min: [55],
            apparent_temperature_max: [70],
            precipitation_probability_max: [0],
            wind_speed_10m_max: [8],
          }
        });
      })
    );

    render(<Forecast />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load forecast. Please try again later.')).toBeInTheDocument();
    });

    const retryButton = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.getByText('Clear sky')).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
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

    server.use(
      http.get('/api/weather', () => {
        return HttpResponse.json(mockWeatherData);
      })
    );
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
