import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import WeatherPage from '../page';
import { getAppConfig } from '@/lib/config';

expect.extend(toHaveNoViolations);

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    modules: { weather: true },
    weddingDate: new Date('2026-06-20T16:00:00.000Z'),
  }),
}));

jest.mock('@/lib/modules', () => ({
  isFeatureEnabled: jest.fn().mockReturnValue(true),
}));

jest.mock('next/navigation', () => ({
  notFound: jest.fn(),
}));

jest.mock('@/features/weather', () => ({
  Forecast: () => <div data-testid="forecast-mock">Forecast Widget</div>,
}));

describe('WeatherPage', () => {
  it('renders date heading using contrast-checked muted text token without low-contrast gray classes', async () => {
    const pageElement = await WeatherPage();
    const { container } = render(pageElement);

    expect(screen.getByRole('heading', { level: 1, name: /the forecast for our big day/i })).toBeInTheDocument();

    const dateSubtitle = screen.getByText('June 20, 2026');
    expect(dateSubtitle).toBeInTheDocument();
    expect(dateSubtitle.className).toContain('var(--color-muted-text');
    expect(dateSubtitle.className).not.toContain('text-gray-400');

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('omits date subtitle when wedding date is missing or invalid', async () => {
    (getAppConfig as jest.Mock).mockResolvedValueOnce({
      modules: { weather: true },
      weddingDate: undefined,
    });

    const pageElement = await WeatherPage();
    render(pageElement);

    expect(screen.getByRole('heading', { level: 1, name: /the forecast for our big day/i })).toBeInTheDocument();
    expect(screen.queryByText(/June 20, 2026/i)).not.toBeInTheDocument();
  });

  it('renders June 20, 2027 for both legacy UTC-midnight rows and evening America/Los_Angeles ceremonies', async () => {
    (getAppConfig as jest.Mock).mockResolvedValueOnce({
      modules: { weather: true },
      weddingDate: new Date('2027-06-20T00:00:00.000Z'),
      timezone: 'America/Chicago',
    });
    const chicagoPage = await WeatherPage();
    const { unmount } = render(chicagoPage);
    expect(screen.getByText('June 20, 2027')).toBeInTheDocument();
    unmount();

    (getAppConfig as jest.Mock).mockResolvedValueOnce({
      modules: { weather: true },
      weddingDate: new Date('2027-06-21T02:30:00.000Z'),
      timezone: 'America/Los_Angeles',
    });
    const laPage = await WeatherPage();
    render(laPage);
    expect(screen.getByText('June 20, 2027')).toBeInTheDocument();
  });
});
