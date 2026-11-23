import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import WeatherError from '../error';
import { ToastProvider } from '@/components/ui/ToastProvider';

describe('WeatherError Boundary', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('renders weather forecast error boundary with alert role, retry, and return home actions', () => {
    const mockReset = jest.fn();
    const testError = new Error('Weather API failed');

    render(
      <ToastProvider>
        <WeatherError error={testError} reset={mockReset} />
      </ToastProvider>
    );

    const alerts = screen.getAllByRole('alert');
    expect(alerts.some((el) => el.getAttribute('aria-live') === 'assertive')).toBe(true);

    expect(screen.getByRole('heading', { level: 1, name: 'Weather Forecast Error' })).toBeInTheDocument();
    expect(screen.getAllByText(/loading the wedding day weather forecast/i).length).toBeGreaterThanOrEqual(1);

    const retryBtn = screen.getByRole('button', { name: 'Try Again' });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(mockReset).toHaveBeenCalledTimes(1);

    const homeLink = screen.getByRole('link', { name: 'Return Home' });
    expect(homeLink).toBeInTheDocument();
    expect(homeLink).toHaveAttribute('href', '/');
  });

  it('renders safely when ToastProvider context is missing', () => {
    const mockReset = jest.fn();
    const testError = new Error('Missing toast context');

    expect(() => {
      render(<WeatherError error={testError} reset={mockReset} />);
    }).not.toThrow();

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveAttribute('aria-live', 'assertive');
  });
});
