import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import WeatherPage from '../page';

expect.extend(toHaveNoViolations);

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    modules: { weather: true },
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

    const dateSubtitle = screen.getByText('October 10, 2025');
    expect(dateSubtitle).toBeInTheDocument();
    expect(dateSubtitle.className).toContain('var(--color-muted-text');
    expect(dateSubtitle.className).not.toContain('text-gray-400');

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
