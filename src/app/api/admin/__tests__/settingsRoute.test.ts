/** @jest-environment node */

import { GET, PUT, POST } from '../settings/route';
import { NextRequest } from 'next/server';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    appConfig: {
      update: jest.fn(),
      findUnique: jest.fn().mockImplementation(({ where }) => {
        if (where.id) {
          return Promise.resolve({ id: where.id, subdomain: null });
        }
        return Promise.resolve(null);
      }),
      findFirst: jest.fn().mockImplementation(({ where }) => {
        if (where.id) {
          return Promise.resolve({ id: where.id, subdomain: null });
        }
        return Promise.resolve(null);
      }),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    snapshotVersion: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/config', () => {
  const actual = jest.requireActual('@/lib/config');
  return {
    getAppConfig: jest.fn(),
    toPublicAppConfig: jest.fn((config) => actual.toPublicAppConfig(config)),
    toAdminAppConfig: jest.fn((config) => actual.toAdminAppConfig(config)),
    isMultisiteEnabled: jest.fn(() => process.env.MULTISITE_ENABLED === 'true' || process.env.MULTISITE_ENABLED === '1'),
  };
});

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getAppConfig, toPublicAppConfig, toAdminAppConfig } from '@/lib/config';
import { isAdminRequest } from '@/core/auth/auth.server';
import { revalidatePath } from 'next/cache';
import { AppConfigSchema, UpdateAppConfigSchema, toAppConfigDbPayload } from '@/features/content';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockGetAppConfig = getAppConfig as jest.MockedFunction<typeof getAppConfig>;
const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;
const mockRevalidatePath = revalidatePath as jest.MockedFunction<typeof revalidatePath>;

const validConfigData = {
  partner1Name: 'TestBride',
  partner2Name: 'TestGroom',
  brideName: 'TestBride',
  groomName: 'TestGroom',
  weddingDate: '2026-06-20T00:00:00.000Z',
  baseUrl: 'https://example.com',
  venueName: 'Test Venue',
  venueAddress: '123 Test St',
  venueCity: 'TestCity',
  venueState: 'TS',
  venueZip: '12345',
  latitude: 44.5,
  longitude: -93.5,
  storyText: 'Our story',
  venueDescription: 'A lovely place',
  travelAdvice: 'Fly here',
  heroTitle: 'Welcome',
  heroSubtitle: 'Join us',
  seoTitle: 'Test Wedding',
  seoDescription: 'Test description',
  contactEmail: '',
  faviconUrl: '/custom/favicon.ico',
  ogImageUrl: '/custom/og-image.jpg',
  seoKeywords: '{{brideName}} wedding, {{groomName}} wedding',
};

import { DEFAULT_MODULE_CONFIG } from '@/lib/modules';

const updatedConfig = AppConfigSchema.parse({
  id: 'global',
  ...validConfigData,
  weddingDate: new Date(validConfigData.weddingDate),
  colorPrimary: '#B91C1C',
  colorSecondary: '#B45309',
  themePreset: 'classic',
  themeTokens: {},
  layoutContainerMaxWidth: '64rem',
  layoutGridGap: '1.5rem',
  layoutCardPadding: '2rem',
  layoutBorderRadius: '1rem',
  brandLogoWidth: '120px',
  brandLogoHeight: '40px',
  brandHeroHeight: '400px',
  brandWatermarkWidth: '200px',
  brandWatermarkOpacity: '0.1',
  brandBadgeSize: '48px',
  timezone: 'America/Chicago',
  showCountdown: true,
  showAddToCalendar: true,
  emailProvider: 'smtp',
  smtpHost: '',
  smtpPort: 587,
  smtpUser: '',
  smtpPass: '',
  smtpFrom: '',
  smtpSecure: false,
  resendApiKey: '',
  resendFrom: '',
  sendgridApiKey: '',
  sendgridFrom: '',
  smsProvider: 'none',
  twilioAccountSid: '',
  twilioAuthToken: '',
  twilioFromNumber: '',
  broadcastBatchSize: 50,
  broadcastBatchDelayMs: 500,
  modules: DEFAULT_MODULE_CONFIG,
  features: [],
  createdAt: new Date(),
  updatedAt: new Date(),
});

function makeAuthReq(body?: object) {
  return new NextRequest('http://localhost/api/admin/settings', {
    method: body ? 'PUT' : 'GET',
    headers: { cookie: 'admin_auth=valid-token' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeUnauthReq() {
  return new NextRequest('http://localhost/api/admin/settings', {
    method: 'GET',
  });
}

describe('GET /api/admin/settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(false);
  });

  it('returns 401 when no auth cookie is present', async () => {
    const req = makeUnauthReq();
    const res = await GET(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 401 when token verification fails', async () => {
    mockIsAdminRequest.mockResolvedValue(false);
    const req = makeAuthReq();
    const res = await GET(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('returns masked admin config when authenticated and omits raw secrets', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const configWithSecrets = {
      ...updatedConfig,
      smtpUser: 'mailer@wedding.example',
      smtpPass: 'secret-smtp-pass',
      resendApiKey: 're_secret_123',
      sendgridApiKey: '',
      twilioAccountSid: 'AC12345',
      twilioAuthToken: 'twilio-secret-token',
    };
    mockGetAppConfig.mockResolvedValue(configWithSecrets as any);

    const req = makeAuthReq();
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockGetAppConfig).toHaveBeenCalled();
    expect(toAdminAppConfig).toHaveBeenCalledWith(configWithSecrets);

    const json = await res.json();
    expect(json.data.smtpUser).toBe('mailer@wedding.example');
    expect(json.data.twilioAccountSid).toBe('AC12345');
    expect(json.data.hasSmtpPass).toBe(true);
    expect(json.data.hasResendApiKey).toBe(true);
    expect(json.data.hasSendgridApiKey).toBe(false);
    expect(json.data.hasTwilioAuthToken).toBe(true);
    expect(json.data.smtpPass).toBeUndefined();
    expect(json.data.resendApiKey).toBeUndefined();
    expect(json.data.sendgridApiKey).toBeUndefined();
    expect(json.data.twilioAuthToken).toBeUndefined();
  });
});

describe('PUT /api/admin/settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(false);
    (mockPrisma.appConfig.update as jest.Mock).mockResolvedValue(updatedConfig);
    (mockPrisma.snapshotVersion.create as jest.Mock).mockResolvedValue({});
    (mockPrisma.snapshotVersion.findMany as jest.Mock).mockResolvedValue([]);
  });

  it('returns 401 when not authenticated', async () => {
    const req = makeUnauthReq();
    const res = await PUT(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 401 when token is invalid', async () => {
    mockIsAdminRequest.mockResolvedValue(false);
    const req = makeAuthReq(validConfigData);
    const res = await PUT(req);

    expect(res.status).toBe(401);
  });

  it('persists faviconUrl to database', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const req = makeAuthReq({
      ...validConfigData,
      faviconUrl: '/uploads/abc123.ico',
    });
    await PUT(req);

    expect(mockPrisma.appConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          faviconUrl: '/uploads/abc123.ico',
        }),
      })
    );
  });

  it('persists ogImageUrl to database', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const req = makeAuthReq({
      ...validConfigData,
      ogImageUrl: '/uploads/def456.jpg',
    });
    await PUT(req);

    expect(mockPrisma.appConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ogImageUrl: '/uploads/def456.jpg',
        }),
      })
    );
  });

  it('persists seoKeywords to database', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const req = makeAuthReq({
      ...validConfigData,
      seoKeywords: '{{brideName}} and {{groomName}} wedding, wedding website',
    });
    await PUT(req);

    expect(mockPrisma.appConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          seoKeywords: '{{brideName}} and {{groomName}} wedding, wedding website',
        }),
      })
    );
  });

  it('persists themePreset and themeTokens to database', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const customTokens = { '--btn-radius': '0.75rem', '--card-bg': '#fafafa' };
    const req = makeAuthReq({
      ...validConfigData,
      themePreset: 'modern',
      themeTokens: customTokens,
    });
    await PUT(req);

    expect(mockPrisma.appConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          themePreset: 'modern',
          themeTokens: customTokens,
        }),
      })
    );
  });

  it('persists themePreset and layout tokens to database', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const req = makeAuthReq({
      ...validConfigData,
      themePreset: 'modern',
      layoutContainerMaxWidth: '72rem',
      layoutGridGap: '2rem',
      layoutCardPadding: '2.5rem',
      layoutBorderRadius: '0.5rem',
    });
    await PUT(req);

    expect(mockPrisma.appConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          themePreset: 'modern',
          layoutContainerMaxWidth: '72rem',
          layoutGridGap: '2rem',
          layoutCardPadding: '2.5rem',
          layoutBorderRadius: '0.5rem',
        }),
      })
    );
  });

  it('persists all three new fields together', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const req = makeAuthReq({
      ...validConfigData,
      faviconUrl: '/uploads/favicon.ico',
      ogImageUrl: '/uploads/og.jpg',
      seoKeywords: 'custom keyword one, custom keyword two',
    });
    await PUT(req);

    expect(mockPrisma.appConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          faviconUrl: '/uploads/favicon.ico',
          ogImageUrl: '/uploads/og.jpg',
          seoKeywords: 'custom keyword one, custom keyword two',
        }),
      })
    );
  });

  it('calls revalidatePath("/", "layout") after successful update', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const req = makeAuthReq(validConfigData);
    await PUT(req);

    expect(mockRevalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('returns 400 for invalid latitude', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const req = makeAuthReq({
      ...validConfigData,
      latitude: 'not-a-number',
    });
    const res = await PUT(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid coordinate format/);
  });

  it('returns 400 for invalid longitude', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const req = makeAuthReq({
      ...validConfigData,
      longitude: 'bad-coord',
    });
    const res = await PUT(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid coordinate format/);
  });


  it('does not call revalidatePath when update fails with invalid coordinates', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const req = makeAuthReq({
      ...validConfigData,
      latitude: 'invalid-coord',
    });
    await PUT(req);

    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it('returns 500 when prisma update throws', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    (mockPrisma.appConfig.update as jest.Mock).mockRejectedValue(new Error('DB connection failed'));

    const req = makeAuthReq(validConfigData);
    const res = await PUT(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('DB connection failed');
  });

  it('does not call revalidatePath when prisma throws', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    (mockPrisma.appConfig.update as jest.Mock).mockRejectedValue(new Error('DB error'));

    const req = makeAuthReq(validConfigData);
    await PUT(req);

    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it('returns the masked admin config and saves sanitized snapshot on success', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const savedRecord = {
      ...updatedConfig,
      smtpPass: 'stored-smtp-pass',
      twilioAccountSid: 'AC_STORED',
      twilioAuthToken: 'stored-twilio-token',
    };
    (mockPrisma.appConfig.update as jest.Mock).mockResolvedValue(savedRecord);

    const req = makeAuthReq(validConfigData);
    const res = await PUT(req);

    expect(res.status).toBe(200);
    const parsedSaved = AppConfigSchema.parse(savedRecord);
    expect(toPublicAppConfig).toHaveBeenCalledWith(parsedSaved);
    expect(toAdminAppConfig).toHaveBeenCalledWith(parsedSaved);

    const json = await res.json();
    expect(json.data.hasSmtpPass).toBe(true);
    expect(json.data.hasTwilioAuthToken).toBe(true);
    expect(json.data.smtpPass).toBeUndefined();
    expect(json.data.twilioAuthToken).toBeUndefined();

    const snapshotCall = (mockPrisma.snapshotVersion.create as jest.Mock).mock.calls[0][0];
    expect(snapshotCall.data.data.smtpPass).toBeUndefined();
    expect(snapshotCall.data.data.twilioAccountSid).toBeUndefined();
    expect(snapshotCall.data.data.twilioAuthToken).toBeUndefined();
  });

  it('preserves stored secrets when password inputs are blank and rotates when provided', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'global',
      subdomain: null,
      smtpPass: 'existing-smtp-pass',
      resendApiKey: 'existing-resend-key',
      sendgridApiKey: 'existing-sendgrid-key',
      twilioAuthToken: 'existing-twilio-token',
    });

    const req = makeAuthReq({
      ...validConfigData,
      smtpPass: '',
      resendApiKey: '   ',
      sendgridApiKey: 'SG.rotated_key',
      // twilioAuthToken omitted
    });
    const res = await PUT(req);

    expect(res.status).toBe(200);
    expect(mockPrisma.appConfig.update).toHaveBeenCalledWith({
      where: { id: 'global' },
      data: expect.objectContaining({
        smtpPass: 'existing-smtp-pass',
        resendApiKey: 'existing-resend-key',
        sendgridApiKey: 'SG.rotated_key',
        twilioAuthToken: 'existing-twilio-token',
      }),
    });
  });

  it('persists a valid timezone to database', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const req = makeAuthReq({
      ...validConfigData,
      timezone: 'Europe/Paris',
    });
    await PUT(req);

    expect(mockPrisma.appConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          timezone: 'Europe/Paris',
        }),
      })
    );
  });

  it('returns 400 and does not save when an invalid timezone is provided', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const req = makeAuthReq({
      ...validConfigData,
      timezone: 'Invalid/Timezone_Name',
    });
    const res = await PUT(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid standard IANA timezone identifier/);
    expect(mockPrisma.appConfig.update).not.toHaveBeenCalled();
  });
});

describe('Single-Site Default Architecture (MULTISITE_ENABLED=false)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(true);
    process.env.MULTISITE_ENABLED = 'false';
  });

  it('GET with list=true returns only canonical global profile in single-site mode', async () => {
    mockGetAppConfig.mockResolvedValue(updatedConfig as any);
    const req = new NextRequest('http://localhost/api/admin/settings?list=true', {
      headers: { cookie: 'admin_auth=valid-token' }
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(mockGetAppConfig).toHaveBeenCalledWith('global');
  });

  it('GET with id passes global to getAppConfig in single-site mode', async () => {
    mockGetAppConfig.mockResolvedValue(updatedConfig as any);
    const req = new NextRequest('http://localhost/api/admin/settings?id=profile-1', {
      headers: { cookie: 'admin_auth=valid-token' }
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(mockGetAppConfig).toHaveBeenCalledWith('global');
  });

  it('POST /api/admin/settings rejects profile creation when multisite is disabled', async () => {
    const req = new NextRequest('http://localhost/api/admin/settings', {
      method: 'POST',
      headers: { cookie: 'admin_auth=valid-token' },
      body: JSON.stringify({
        brideName: 'StagingBride',
        groomName: 'StagingGroom',
        subdomain: 'staging'
      })
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Multi-site features are disabled/);
  });
});

describe('Multi-Profile Routing and Settings API (MULTISITE_ENABLED=true)', () => {
  let originalMultisite: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(true);
    originalMultisite = process.env.MULTISITE_ENABLED;
    process.env.MULTISITE_ENABLED = 'true';
  });

  afterEach(() => {
    process.env.MULTISITE_ENABLED = originalMultisite;
  });

  it('GET with list=true lists all profiles', async () => {
    const mockConfigs = [
      { ...updatedConfig, id: 'global', partner1Name: 'Abby', partner2Name: 'Fred', brideName: 'Abby' },
      { ...updatedConfig, id: 'profile-1', partner1Name: 'Staging', partner2Name: 'Test', brideName: 'Staging', subdomain: 'staging' }
    ];
    const mockFindMany = jest.spyOn(prisma.appConfig, 'findMany').mockResolvedValue(mockConfigs as any);

    const req = new NextRequest('http://localhost/api/admin/settings?list=true', {
      headers: { cookie: 'admin_auth=valid-token' }
    });
    const res = await GET(req);

    if (res.status !== 200) {
      console.log('GET list error:', await res.json());
    }

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
    expect(json.data[1].subdomain).toBe('staging');
    mockFindMany.mockRestore();
  });

  it('GET with id fetches a specific profile', async () => {
    mockGetAppConfig.mockResolvedValue(updatedConfig as any);
    const req = new NextRequest('http://localhost/api/admin/settings?id=profile-1', {
      headers: { cookie: 'admin_auth=valid-token' }
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockGetAppConfig).toHaveBeenCalledWith('profile-1');
  });

  it('POST /api/admin/settings creates a new profile', async () => {
    const mockCreate = jest.spyOn(prisma.appConfig, 'create').mockResolvedValue({
      ...updatedConfig,
      id: 'profile-new',
      partner1Name: 'StagingBride',
      partner2Name: 'StagingGroom',
      brideName: 'StagingBride',
      groomName: 'StagingGroom',
      subdomain: 'staging',
      weddingDate: new Date(),
      baseUrl: 'https://example.com',
    } as any);

    const req = new NextRequest('http://localhost/api/admin/settings', {
      method: 'POST',
      headers: { cookie: 'admin_auth=valid-token' },
      body: JSON.stringify({
        partner1Name: 'StagingBride',
        partner2Name: 'StagingGroom',
        subdomain: 'staging'
      })
    });
    const res = await POST(req);

    if (res.status !== 200) {
      console.log('POST error:', await res.json());
    }

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.subdomain).toBe('staging');
    expect(mockCreate).toHaveBeenCalled();
    mockCreate.mockRestore();
  });

  it('POST /api/admin/settings fails if subdomain is already in use', async () => {
    const mockFindUnique = jest.spyOn(prisma.appConfig, 'findUnique').mockResolvedValue({
      id: 'existing-profile',
      subdomain: 'staging'
    } as any);

    const req = new NextRequest('http://localhost/api/admin/settings', {
      method: 'POST',
      headers: { cookie: 'admin_auth=valid-token' },
      body: JSON.stringify({
        brideName: 'NewBride',
        groomName: 'NewGroom',
        subdomain: 'staging'
      })
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/already in use/);
    mockFindUnique.mockRestore();
  });
});

describe('toAppConfigDbPayload mapper', () => {
  it('correctly maps validated UpdateAppConfigSchema outputs into standard DB payload structure', () => {
    const rawData = {
      partner1Name: 'Alex',
      partner2Name: 'Jordan',
      brideName: 'Alex',
      groomName: 'Jordan',
      weddingDate: '2026-09-15T12:00:00.000Z',
      baseUrl: 'https://wedding.example',
      venueName: 'Grand Hall',
      venueAddress: '123 Main St',
      venueCity: 'Austin',
      venueState: 'TX',
      venueZip: '78701',
      latitude: 30.2672,
      longitude: -97.7431,
      storyText: 'Our story...',
      venueDescription: 'Beautiful venue',
      travelAdvice: 'Fly to AUS',
      heroTitle: 'Welcome',
      heroSubtitle: 'Join us',
      seoTitle: 'Alex & Jordan Wedding',
      seoDescription: 'Wedding details',
      faviconUrl: '/favicon.ico',
      ogImageUrl: '/og.jpg',
      seoKeywords: 'wedding, austin',
      colorPrimary: '#123456',
      colorSecondary: '#654321',
      timezone: 'America/Chicago',
      showCountdown: true,
      showAddToCalendar: true,
      subdomain: '',
    };

    const parsed = UpdateAppConfigSchema.parse(rawData);
    const dbPayload = toAppConfigDbPayload(parsed);

    expect(dbPayload).toEqual({
      partner1Name: 'Alex',
      partner2Name: 'Jordan',
      brideName: 'Alex',
      groomName: 'Jordan',
      subdomain: null,
      weddingDate: new Date('2026-09-15T12:00:00.000Z'),
      baseUrl: 'https://wedding.example',
      venueName: 'Grand Hall',
      venueAddress: '123 Main St',
      venueCity: 'Austin',
      venueState: 'TX',
      venueZip: '78701',
      latitude: 30.2672,
      longitude: -97.7431,
      storyText: 'Our story...',
      venueDescription: 'Beautiful venue',
      travelAdvice: 'Fly to AUS',
      heroTitle: 'Welcome',
      heroSubtitle: 'Join us',
      seoTitle: 'Alex & Jordan Wedding',
      seoDescription: 'Wedding details',
      faviconUrl: '/favicon.ico',
      ogImageUrl: '/og.jpg',
      brandMonogram: undefined,
      brandLogoUrl: undefined,
      brandLogoAlt: undefined,
      heroImageUrl: undefined,
      heroImageAlt: undefined,
      brandWatermarkUrl: undefined,
      brandWatermarkAlt: undefined,
      badgeGraphicUrl: undefined,
      badgeGraphicAlt: undefined,
      contactEmail: undefined,
      seoKeywords: 'wedding, austin',
      colorPrimary: '#123456',
      colorSecondary: '#654321',
      themePreset: 'classic',
      themeTokens: {},
      layoutContainerMaxWidth: '64rem',
      layoutGridGap: '1.5rem',
      layoutCardPadding: '2rem',
      layoutBorderRadius: '1rem',
      timezone: 'America/Chicago',
      showCountdown: true,
      showAddToCalendar: true,
      emailProvider: 'smtp',
      smtpHost: '',
      smtpPort: 587,
      smtpUser: '',
      smtpPass: '',
      smtpFrom: '',
      smtpSecure: false,
      resendApiKey: '',
      resendFrom: '',
      sendgridApiKey: '',
      sendgridFrom: '',
      smsProvider: 'none',
      twilioAccountSid: '',
      twilioAuthToken: '',
      twilioFromNumber: '',
      broadcastBatchSize: 50,
      broadcastBatchDelayMs: 500,
    });
  });

  it('preserves non-empty subdomain when provided', () => {
    const rawData = {
      brideName: 'Alex',
      groomName: 'Jordan',
      weddingDate: '2026-09-15T12:00:00.000Z',
      baseUrl: 'https://wedding.example',
      venueName: 'Grand Hall',
      venueAddress: '123 Main St',
      venueCity: 'Austin',
      venueState: 'TX',
      venueZip: '78701',
      latitude: 0,
      longitude: 0,
      storyText: '',
      venueDescription: '',
      travelAdvice: '',
      heroTitle: '',
      heroSubtitle: '',
      seoTitle: '',
      seoDescription: '',
      faviconUrl: '',
      ogImageUrl: '',
      seoKeywords: '',
      subdomain: 'alexjordan',
    };

    const parsed = UpdateAppConfigSchema.parse(rawData);
    const dbPayload = toAppConfigDbPayload(parsed);

    expect(dbPayload.subdomain).toBe('alexjordan');
  });
});