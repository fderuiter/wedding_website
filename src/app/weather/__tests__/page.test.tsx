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
});
