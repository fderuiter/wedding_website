import { getAppConfig, STATIC_MOCK_CONFIG, isSiteInitialized } from '../config';
import { logisticsRepository } from '@/features/logistics';
import { prisma } from '../prisma';

jest.mock('../prisma', () => ({
  prisma: {
    appConfig: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    contentNode: {
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
});
