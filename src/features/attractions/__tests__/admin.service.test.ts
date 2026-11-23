import { AttractionAdminService } from '../admin.service';
import { geocodeBestMatch } from '@/lib/geocoding';
import { getAppConfig } from '@/lib/config';

const mockCreate = jest.fn();
const mockUpdate = jest.fn();

jest.mock('@/core/infrastructure/repository', () => ({
  BaseRepository: jest.fn().mockImplementation(() => ({
    create: (...args: unknown[]) => mockCreate(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    transaction: async (fn: (txRepo: unknown) => Promise<unknown>) =>
      fn({
        client: {
          snapshotVersion: {
            create: jest.fn(),
            findMany: jest.fn().mockResolvedValue([]),
            deleteMany: jest.fn(),
          },
        },
        create: (...args: unknown[]) => mockCreate(...args),
        update: (...args: unknown[]) => mockUpdate(...args),
      }),
  })),
}));

jest.mock('@/features/admin', () => ({
  handleMediaFields: jest.fn(async (data: unknown) => ({ ...(data as Record<string, unknown>) })),
}));

jest.mock('@/lib/geocoding', () => ({
  geocodeBestMatch: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn(),
}));

const mockGeocodeBestMatch = geocodeBestMatch as jest.MockedFunction<typeof geocodeBestMatch>;
const mockGetAppConfig = getAppConfig as jest.MockedFunction<typeof getAppConfig>;

describe('AttractionAdminService auto-geocoding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAppConfig.mockResolvedValue({
      venueCity: 'Chicago',
      venueState: 'IL',
    } as any);
    mockCreate.mockImplementation(async (data: any) => ({
      id: 'attr-created',
      ...data,
    }));
    mockUpdate.mockImplementation(async (id: string, data: any) => ({
      id,
      ...data,
    }));
  });

  it('auto-geocodes non-placeholder name and street directions when coordinates are (0, 0)', async () => {
    mockGeocodeBestMatch.mockResolvedValue({
      displayName: 'The Drake Hotel, 140 E Walton Pl, Chicago, IL 60611, USA',
      name: 'The Drake Hotel',
      streetAddress: '140 E Walton Pl',
      city: 'Chicago',
      state: 'IL',
      zip: '60611',
      country: 'USA',
      latitude: 41.8998,
      longitude: -87.6233,
    });

    const service = new AttractionAdminService();
    await service.create({
      name: 'The Drake Hotel',
      description: 'Historic lakeside hotel',
      category: 'hotel',
      directions: '140 E Walton Pl, Chicago, IL',
      latitude: 0,
      longitude: 0,
      isVisible: true,
    });

    expect(mockGeocodeBestMatch).toHaveBeenCalledWith([
      'The Drake Hotel',
      '140 E Walton Pl, Chicago, IL',
    ]);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'The Drake Hotel',
        latitude: 41.8998,
        longitude: -87.6233,
      })
    );
  });

  it('preserves explicit non-zero coordinates without invoking geocodeBestMatch', async () => {
    const service = new AttractionAdminService();
    await service.update('attr-existing', {
      name: 'Millennium Park',
      description: 'Iconic downtown park',
      category: 'activity',
      latitude: 41.8826,
      longitude: -87.6226,
      isVisible: true,
    });

    expect(mockGeocodeBestMatch).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      'attr-existing',
      expect.objectContaining({
        latitude: 41.8826,
        longitude: -87.6226,
      })
    );
  });
});
