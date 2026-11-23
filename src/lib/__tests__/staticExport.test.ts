import { getAppConfig, STATIC_MOCK_CONFIG, isSiteInitialized } from '../config';
import { attractionsRepository } from '@/features/attractions';
import { logisticsRepository } from '@/features/logistics';
import { weddingPartyRepository } from '@/features/wedding-party';
import { prisma } from '../prisma';

jest.mock('../prisma', () => ({
  prisma: {
    appConfig: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    attraction: {
      findMany: jest.fn(),
    },
    contentNode: {
      findMany: jest.fn(),
    },
    weddingPartyMember: {
      findMany: jest.fn(),
    },
  },
}));

describe('Dual-mode static export mock adapter', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('provides initialized static mock config without database queries when STATIC_EXPORT is enabled', async () => {
    process.env.STATIC_EXPORT = 'true';

    const config = await getAppConfig();

    expect(prisma.appConfig.findUnique).not.toHaveBeenCalled();
    expect(prisma.appConfig.upsert).not.toHaveBeenCalled();
    expect(config.venueName).toBe(STATIC_MOCK_CONFIG.venueName);
    expect(config.partner1Name).toBe('Alex Morgan');
    expect(config.partner2Name).toBe('Taylor Jordan');
    expect(isSiteInitialized(config)).toBe(true);
  });

  it('provides mock logistics nodes without database queries when STATIC_EXPORT is enabled', async () => {
    process.env.STATIC_EXPORT = 'true';

    const nodes = await logisticsRepository.getLogisticsNodes();

    expect(prisma.contentNode.findMany).not.toHaveBeenCalled();
    expect(nodes.length).toBeGreaterThan(0);
    const ceremony = nodes.find(n => (n.data as any)?.ceremonyTitle);
    expect(ceremony).toBeDefined();
    expect((ceremony?.data as any)?.ceremonyTitle).toBe('Wedding Ceremony');
  });

  it('provides mock attractions with hotel block details without database queries when STATIC_EXPORT is enabled', async () => {
    process.env.STATIC_EXPORT = 'true';

    const attractions = await attractionsRepository.getVisibleAttractions();

    expect(prisma.attraction.findMany).not.toHaveBeenCalled();
    expect(attractions.length).toBeGreaterThan(0);
    const hotel = attractions.find((a) => a.category === 'hotel');
    expect(hotel).toBeDefined();
    expect(hotel?.promoCode).toBe('WEDDING2026');
    expect(hotel?.roomRate).toBe('$189/night');
  });

  it('provides mock wedding party members across both partner sides without database queries when STATIC_EXPORT is enabled', async () => {
    process.env.STATIC_EXPORT = 'true';

    const members = await weddingPartyRepository.getMembers();

    expect(prisma.weddingPartyMember.findMany).not.toHaveBeenCalled();
    expect(members.length).toBeGreaterThanOrEqual(2);
    expect(members.some((m) => m.side === 'BRIDE')).toBe(true);
    expect(members.some((m) => m.side === 'GROOM')).toBe(true);
  });
});
