import { getAppConfig, toPublicAppConfig } from '../config';
import { prisma } from '../prisma';

jest.mock('../prisma', () => ({
  prisma: {
    appConfig: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    contentNode: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
    },
  },
}));

describe('Unconfigured Template State', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns explicit unconfigured template defaults when no DB config exists', async () => {
    (prisma.appConfig.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.appConfig.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.appConfig.create as jest.Mock).mockImplementation(({ data }) => Promise.resolve(data));

    const config = await getAppConfig();

    expect(config.brideName).toBe('');
    expect(config.groomName).toBe('');
    expect(config.baseUrl).toBe('');
    expect(config.venueName).toBe('');
    expect(config.venueCity).toBe('');
    expect(config.seoDescription).toBe('');
    expect(config.ogImageUrl).toBe('/images/placeholder.png');
    expect(config.timezone).toBe('UTC');

    const isUninitialized = !config.brideName || !config.groomName || !config.baseUrl;
    expect(isUninitialized).toBe(true);
  });

  it('toPublicAppConfig preserves unconfigured fields without leaking secrets', () => {
    const unconfigured = {
      id: 'global',
      brideName: '',
      groomName: '',
      baseUrl: '',
      adminPassword: 'secret-hash',
    };

    const publicConfig: any = toPublicAppConfig(unconfigured as any);
    expect(publicConfig.brideName).toBe('');
    expect(publicConfig.adminPassword).toBeUndefined();
  });
});
