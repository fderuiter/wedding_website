/** @jest-environment node */

import { NextRequest } from 'next/server';

const mockGetAppConfig = jest.fn();
const mockFindManyContentNode = jest.fn();
const mockFindManyMedia = jest.fn();
const mockFindUniqueInvitation = jest.fn();
const mockFindUniqueAppConfig = jest.fn();
const mockFindFirstAppConfig = jest.fn();
const mockConstructEvent = jest.fn();

jest.mock('@/lib/config', () => ({
  getAppConfig: (...args: unknown[]) => mockGetAppConfig(...args),
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    contentNode: {
      findMany: (...args: unknown[]) => mockFindManyContentNode(...args),
    },
    media: {
      findMany: (...args: unknown[]) => mockFindManyMedia(...args),
    },
    invitationCode: {
      findUnique: (...args: unknown[]) => mockFindUniqueInvitation(...args),
    },
    appConfig: {
      findUnique: (...args: unknown[]) => mockFindUniqueAppConfig(...args),
      findFirst: (...args: unknown[]) => mockFindFirstAppConfig(...args),
    },
  },
}));

jest.mock('@/lib/stripe', () => {
  const actual = jest.requireActual('@/lib/stripe');
  return {
    ...actual,
    getStripeInstance: jest.fn(() => ({
      webhooks: {
        constructEvent: mockConstructEvent,
      },
    })),
  };
});

import { GET as uploadGET, HEAD as uploadHEAD } from '@/app/api/uploads/[...path]/route';
import { POST as stripeWebhookPOST } from '@/app/api/registry/webhook/stripe/route';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';

describe('Direct Endpoint Burst Throttling (/api/uploads/[...path] & /api/registry/webhook/stripe)', () => {
  const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  beforeEach(async () => {
    jest.clearAllMocks();
    await resetRateLimitsForTesting();
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret_123';
    mockFindManyContentNode.mockResolvedValue([]);
    mockFindManyMedia.mockResolvedValue([]);
    mockFindUniqueAppConfig.mockResolvedValue({ guestPhotoQrTokenVersion: 1, adminTokenVersion: 1 });
    mockFindFirstAppConfig.mockResolvedValue({ guestPhotoQrTokenVersion: 1, adminTokenVersion: 1 });
    mockGetAppConfig.mockResolvedValue({
      ogImageUrl: '/images/og.jpg',
      faviconUrl: '/assets/favicon.png',
    });
  });

  afterAll(async () => {
    await resetRateLimitsForTesting();
    if (originalWebhookSecret !== undefined) {
      process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
    } else {
      delete process.env.STRIPE_WEBHOOK_SECRET;
    }
  });

  it('enforces 100-per-minute rateLimit across /uploads/* and /api/uploads/* before DB or storage reads while preserving sandbox CSP/CORP headers and empty HEAD bodies', async () => {
    for (let i = 0; i < 100; i++) {
      const url =
        i % 2 === 0
          ? `http://localhost:3000/uploads/photos/burst-${i}.jpg`
          : `http://localhost:3000/api/uploads/photos/burst-${i}.jpg`;
      const res = await uploadGET(new NextRequest(url), {
        params: Promise.resolve({ path: ['photos', `burst-${i}.jpg`] }),
      });
      expect(res.status).toBe(401);
    }

    mockFindManyContentNode.mockClear();
    mockFindManyMedia.mockClear();
    mockGetAppConfig.mockClear();

    const throttledGetRes = await uploadGET(
      new NextRequest('http://localhost:3000/uploads/photos/burst-overflow.jpg'),
      { params: Promise.resolve({ path: ['photos', 'burst-overflow.jpg'] }) }
    );
    expect(throttledGetRes.status).toBe(429);
    expect(throttledGetRes.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; sandbox"
    );
    expect(throttledGetRes.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(throttledGetRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await throttledGetRes.json()).toEqual({
      error: 'Too many requests, please try again later.',
    });
    expect(mockFindManyContentNode).not.toHaveBeenCalled();
    expect(mockFindManyMedia).not.toHaveBeenCalled();
    expect(mockGetAppConfig).not.toHaveBeenCalled();

    const throttledHeadRes = await uploadHEAD(
      new NextRequest('http://localhost:3000/api/uploads/photos/burst-overflow.jpg', {
        method: 'HEAD',
      }),
      { params: Promise.resolve({ path: ['photos', 'burst-overflow.jpg'] }) }
    );
    expect(throttledHeadRes.status).toBe(429);
    expect(throttledHeadRes.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; sandbox"
    );
    expect(throttledHeadRes.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(throttledHeadRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect((await throttledHeadRes.arrayBuffer()).byteLength).toBe(0);
  });

  it('enforces 100-per-minute IP rateLimit on POST /api/registry/webhook/stripe before reading request.text() or verifying Stripe signatures', async () => {
    for (let i = 0; i < 100; i++) {
      const res = await stripeWebhookPOST(
        new NextRequest('http://localhost:3000/api/registry/webhook/stripe', {
          method: 'POST',
          body: '{}',
        })
      );
      expect(res.status).toBe(400);
    }

    mockConstructEvent.mockClear();
    const overflowReq = new NextRequest('http://localhost:3000/api/registry/webhook/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 't=12345,v1=validsig' },
      body: JSON.stringify({ type: 'payment_intent.succeeded' }),
    });
    const textSpy = jest.spyOn(overflowReq, 'text');

    const throttledRes = await stripeWebhookPOST(overflowReq);
    expect(throttledRes.status).toBe(429);
    expect(await throttledRes.json()).toEqual({
      error: 'Too many requests, please try again later.',
    });
    expect(textSpy).not.toHaveBeenCalled();
    expect(mockConstructEvent).not.toHaveBeenCalled();
  });
});
