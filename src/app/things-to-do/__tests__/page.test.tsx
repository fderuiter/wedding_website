import { render, screen } from '@testing-library/react';
import ThingsToDoPage from '../page';
import { getAppConfig } from '@/lib/config';
import { attractionsRepository } from '@/features/attractions';
import { geocodeBestMatch } from '@/lib/geocoding';

jest.mock('@/core/auth/guestInviteSession', () => ({
  enforceActiveGuestPageSession: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/config', () => {
  const actual = jest.requireActual('@/lib/config');
  return {
    ...actual,
    getAppConfig: jest.fn(),
  };
});

jest.mock('@/features/attractions', () => ({
  attractionsRepository: {
    getVisibleAttractions: jest.fn(),
  },
}));

jest.mock('@/lib/geocoding', () => ({
  geocodeBestMatch: jest.fn(),
}));

const capturedListProps: any[] = [];
jest.mock('../components/ThingsToDoList', () => ({
  __esModule: true,
  default: (props: any) => {
    capturedListProps.push(props);
    return <div data-testid="things-to-do-list-mock" />;
  },
}));

const mockGetAppConfig = getAppConfig as jest.MockedFunction<typeof getAppConfig>;
const mockGetVisibleAttractions = attractionsRepository.getVisibleAttractions as jest.MockedFunction<
  typeof attractionsRepository.getVisibleAttractions
>;
const mockGeocodeBestMatch = geocodeBestMatch as jest.MockedFunction<typeof geocodeBestMatch>;

describe('ThingsToDoPage coordinate filtering and fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedListProps.length = 0;
    mockGetVisibleAttractions.mockResolvedValue([]);
  });

  it('filters out (0, 0) coordinates when geocoding finds no match instead of centering on Gulf of Guinea', async () => {
    mockGetAppConfig.mockResolvedValue({
      venueName: 'TBD',
      venueAddress: 'TBD',
      venueCity: 'TBD',
      venueState: 'TBD',
      venueZip: 'TBD',
      latitude: 0,
      longitude: 0,
      modules: { attractions: true },
    } as any);
    mockGeocodeBestMatch.mockResolvedValue(null);

    const element = await ThingsToDoPage();
    render(element);

    expect(screen.getByTestId('things-to-do-list-mock')).toBeInTheDocument();
    expect(capturedListProps[0].defaultCenter).toBeUndefined();
    expect(capturedListProps[0].venue).toBeNull();
  });

  it('uses geocoded city coordinates as map defaultCenter when stored coordinates are (0, 0)', async () => {
    mockGetAppConfig.mockResolvedValue({
      venueName: 'Lakeside Pavilion',
      venueAddress: 'TBD',
      venueCity: 'Austin',
      venueState: 'TX',
      venueZip: 'TBD',
      latitude: 0,
      longitude: 0,
      modules: { attractions: true },
    } as any);
    mockGeocodeBestMatch.mockResolvedValue({
      displayName: 'Austin, TX, USA',
      name: 'Austin',
      streetAddress: '',
      city: 'Austin',
      state: 'TX',
      zip: '',
      country: 'USA',
      latitude: 30.2672,
      longitude: -97.7431,
    });

    const element = await ThingsToDoPage();
    render(element);

    expect(capturedListProps[0].defaultCenter).toEqual([30.2672, -97.7431]);
    expect(capturedListProps[0].venue).toMatchObject({
      name: 'Lakeside Pavilion',
      latitude: 30.2672,
      longitude: -97.7431,
    });
  });
});
