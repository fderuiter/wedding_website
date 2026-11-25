/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('../../service', () => ({
  registryService: {
    getItemById: jest.fn(),
    contributeToItem: jest.fn(),
    getContributorWithItem: jest.fn(),
    confirmContribution: jest.fn(),
    cancelReservedContribution: jest.fn(),
  },
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn().mockResolvedValue(false),
}));

jest.mock('@/core/auth/guestInviteSession', () => ({
  getGuestInviteSession: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn(),
}));

import { MultiChannelMessagingProvider } from '@/features/broadcast';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { getAppConfig } from '@/lib/config';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';
import { GET as claimGET, POST as claimPOST } from '../claim';
import { POST as contributePOST } from '../contribute';
import {
  mintContributorActionPair,
  signContributorActionToken,
  verifyContributorActionToken,
} from '../../lib/contributorToken';
import { dispatchContributionNotifications } from '../../notifications';
import { registryService } from '../../service';

describe('Contributor Action Token Multisite Tenant Claims & Legacy Compatibility', () => {
  const originalEnv = { ...process.env };

  const aliceConfig = {
    id: 'site-alice',
    subdomain: 'alice',
    modules: ['registry', 'groupGifting'],
    emailProvider: 'smtp',
    smtpHost: 'smtp.wedding.test',
    contactEmail: 'alice@wedding.test',
    baseUrl: 'https://alice.wedding.test',
    defaultPaymentHandleType: 'Venmo',
    defaultPaymentHandle: '@alice-venmo',
  };

  const bobConfig = {
    ...aliceConfig,
    id: 'site-bob',
    subdomain: 'bob',
    contactEmail: 'bob@wedding.test',
    baseUrl: 'https://bob.wedding.test',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    await resetRateLimitsForTesting();
    process.env = {
      ...originalEnv,
      ALLOWED_HOSTS: 'localhost,*.wedding.test,wedding.test',
      MULTISITE_ENABLED: 'true',
      GUEST_SESSION_SECRET: 'contributor-tenant-claims-secret-32chars!!',
      GUEST_PASSCODE: 'wedding2026',
    };
    (getGuestInviteSession as jest.Mock).mockResolvedValue({
      code: 'ALICEVIP',
      guestName: 'Alice Friend',
    });
    (getAppConfig as jest.Mock).mockImplementation(async (subdomainOrId?: string) => {
      if (subdomainOrId === 'bob' || subdomainOrId === 'site-bob') {
        return bobConfig;
      }
      return aliceConfig;
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('stamps siteId and normalized subdomain in POST /api/registry/contribute claimActions under verified household sessions', async () => {
    const mockItem = {
      id: 'item-123',
      name: 'Espresso Machine',
      price: 200,
      amountContributed: 0,
      purchased: false,
      isGroupGift: true,
      isSample: false,
      paymentHandleType: 'Venmo' as const,
      paymentHandle: '@alice-venmo',
      image: { id: 'img-1', url: '/espresso.jpg' },
      contributors: [],
    };
    (registryService.getItemById as jest.Mock).mockResolvedValueOnce(mockItem);
    (registryService.contributeToItem as jest.Mock).mockResolvedValueOnce({
      ...mockItem,
      amountContributed: 75,
      contributors: [
        {
          id: 'contrib-alice-1',
          name: 'Alice Friend',
          amount: 75,
          status: 'RESERVED',
        },
      ],
    });
    (getAppConfig as jest.Mock).mockResolvedValueOnce({
      ...aliceConfig,
      subdomain: 'Alice',
      emailProvider: 'none',
    });

    const res = await contributePOST(
      new NextRequest('https://Alice.wedding.test/api/registry/contribute', {
        method: 'POST',
        headers: {
          host: 'Alice.wedding.test',
          origin: 'https://alice.wedding.test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          itemId: 'item-123',
          name: 'Alice Friend',
          amount: 75,
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    const verifiedConfirm = await verifyContributorActionToken(
      body.data.claimActions.confirmToken,
      'confirm'
    );
    const verifiedCancel = await verifyContributorActionToken(
      body.data.claimActions.cancelToken,
      'cancel'
    );
    expect(verifiedConfirm).toMatchObject({
      contributorId: 'contrib-alice-1',
      action: 'confirm',
      siteId: 'site-alice',
      subdomain: 'alice',
    });
    expect(verifiedCancel).toMatchObject({
      contributorId: 'contrib-alice-1',
      action: 'cancel',
      siteId: 'site-alice',
      subdomain: 'alice',
    });
  });

  it('stamps siteId and normalized subdomain in dispatchContributionNotifications, blocks cross-tenant and claimless tokens when MULTISITE_ENABLED=true, and accepts legacy tokens when MULTISITE_ENABLED=false', async () => {
    const sendEmailSpy = jest
      .spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail')
      .mockResolvedValue({ success: true });

    try {
      await dispatchContributionNotifications({
        itemId: 'item-tenant-1',
        targetItem: { id: 'item-tenant-1', name: 'Espresso Machine', itemType: 'PHYSICAL' },
        updatedItem: {
          id: 'item-tenant-1',
          name: 'Espresso Machine',
          itemType: 'PHYSICAL',
          contributors: [
            {
              id: 'contrib-alice-1',
              name: 'Alice Guest',
              email: 'guest@alice.test',
              amount: 150,
              status: 'RESERVED',
              invitationCode: {
                id: 'inv-1',
                code: 'ALICEVIP',
                email: 'guest@alice.test',
                isSample: false,
              },
            },
          ],
        },
        contribution: {
          name: 'Alice Guest',
          email: 'guest@alice.test',
          amount: 150,
        },
        config: { ...aliceConfig, subdomain: 'ALICE' },
        requestUrl: 'https://ALICE.wedding.test/api/registry/contribute',
        isReservation: true,
        verifiedInvitationCode: 'ALICEVIP',
      });

      const guestMailCall = sendEmailSpy.mock.calls.find(
        (call) => call[0].to === 'guest@alice.test'
      );
      expect(guestMailCall).toBeDefined();
      const tokenMatch = guestMailCall![0].body.match(/\/guest\/claim\?token=([^"&<\s]+)/);
      expect(tokenMatch).not.toBeNull();
      const emailedToken = decodeURIComponent(tokenMatch![1]);
      expect(await verifyContributorActionToken(emailedToken)).toMatchObject({
        contributorId: 'contrib-alice-1',
        siteId: 'site-alice',
        subdomain: 'alice',
      });
    } finally {
      sendEmailSpy.mockRestore();
    }

    const { confirmToken: aliceConfirmToken } = await mintContributorActionPair({
      contributorId: 'contrib-alice-1',
      config: { id: 'site-alice', subdomain: 'Alice' },
      requestUrl: 'https://Alice.wedding.test/api/registry/contribute',
    });

    (registryService.getContributorWithItem as jest.Mock).mockResolvedValue({
      contributor: { id: 'contrib-alice-1', status: 'RESERVED', amount: 150 },
      item: {
        id: 'item-tenant-1',
        name: 'Espresso Machine',
        itemType: 'PHYSICAL',
        isSample: false,
      },
    });

    // Cross-tenant GET and POST on Bob's site are rejected before DB lookup or mutation
    const bobGetRes = await claimGET(
      new NextRequest(
        `https://bob.wedding.test/api/registry/claim?token=${encodeURIComponent(aliceConfirmToken)}`,
        { headers: { host: 'bob.wedding.test' } }
      ),
      {}
    );
    expect(bobGetRes.status).toBe(401);
    expect(registryService.getContributorWithItem).not.toHaveBeenCalled();

    const bobPostRes = await claimPOST(
      new NextRequest('https://bob.wedding.test/api/registry/claim', {
        method: 'POST',
        headers: {
          host: 'bob.wedding.test',
          origin: 'https://bob.wedding.test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ token: aliceConfirmToken }),
      }),
      {}
    );
    expect(bobPostRes.status).toBe(401);
    expect(registryService.confirmContribution).not.toHaveBeenCalled();

    // Legacy claimless token is rejected when MULTISITE_ENABLED=true
    const legacyClaimlessToken = await signContributorActionToken({
      contributorId: 'contrib-legacy-1',
      action: 'confirm',
    });
    const multisiteLegacyRes = await claimGET(
      new NextRequest(
        `https://alice.wedding.test/api/registry/claim?token=${encodeURIComponent(legacyClaimlessToken)}`,
        { headers: { host: 'alice.wedding.test' } }
      ),
      {}
    );
    expect(multisiteLegacyRes.status).toBe(401);

    // Same-tenant token succeeds on Alice's site
    const aliceGetRes = await claimGET(
      new NextRequest(
        `https://alice.wedding.test/api/registry/claim?token=${encodeURIComponent(aliceConfirmToken)}`,
        { headers: { host: 'alice.wedding.test' } }
      ),
      {}
    );
    expect(aliceGetRes.status).toBe(200);

    // Legacy claimless 30-day email token remains valid when MULTISITE_ENABLED=false
    process.env.MULTISITE_ENABLED = 'false';
    const singleSiteLegacyGetRes = await claimGET(
      new NextRequest(
        `http://localhost:3000/api/registry/claim?token=${encodeURIComponent(legacyClaimlessToken)}`
      ),
      {}
    );
    expect(singleSiteLegacyGetRes.status).toBe(200);
  });
});
