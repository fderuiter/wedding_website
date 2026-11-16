import { render, screen } from '@testing-library/react';
import ThingsToDoPage, { metadata } from '../page';
import { getAppConfig } from '@/lib/config';

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    modules: { attractions: true },
    venueCity: 'Chicago',
    latitude: 41.8781,
    longitude: -87.6298,
  }),
}));

jest.mock('@/lib/modules', () => ({
  isFeatureEnabled: jest.fn().mockReturnValue(true),
}));

jest.mock('@/features/attractions', () => ({
  attractionsRepository: {
    getVisibleAttractions: jest.fn().mockResolvedValue([]),
  },
}));

// Mock the ThingsToDoList component
jest.mock('../components/ThingsToDoList', () => {
  return function DummyThingsToDoList() {
    return <div data-testid="things-to-do-list" />;
  };
});

describe('ThingsToDoPage', () => {
  it('defines canonical alternate metadata', () => {
    expect(metadata.alternates?.canonical).toBe('/things-to-do');
  });

  it('renders the main heading with configured venue city', async () => {
    const Component = await ThingsToDoPage();
    render(Component);
    expect(screen.getByRole('heading', { name: 'Things to Do in Chicago' })).toBeInTheDocument();
  });

  it('falls back to generic heading when venue city is not configured', async () => {
    (getAppConfig as jest.Mock).mockResolvedValueOnce({
      modules: { attractions: true },
      venueCity: '',
      latitude: 0,
      longitude: 0,
    });

    const Component = await ThingsToDoPage();
    render(Component);
    expect(screen.getByRole('heading', { name: 'Things to Do' })).toBeInTheDocument();
  });

  it('renders the ThingsToDoList component', async () => {
    const Component = await ThingsToDoPage();
    render(Component);
    expect(screen.getByTestId('things-to-do-list')).toBeInTheDocument();
  });
});
