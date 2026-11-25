/** @jest-environment node */

import { NextRequest } from 'next/server';
import { signCompactToken } from '@/core/auth/tokenCookieHelpers';
import { middleware } from '@/middleware';
import { isAdminRequest } from '@/core/auth/auth.server';
import { isGuestRequest } from '@/core/auth/guest.server';
import { MultiChannelMessagingProvider } from '@/features/broadcast';
import {
  signContributorActionToken,
  verifyContributorActionToken,
} from '../../lib/contributorToken';
import { GET as claimGET, POST as claimPOST } from '../claim';
import { POST as adminActionPOST } from '@/app/api/admin/contributors/[id]/action/route';
import { registryService } from '../../service';

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn().mockResolvedValue(false),
}));

jest.mock('@/core/auth/guest.server', () => ({
  isGuestRequest: jest.fn().mockResolvedValue(false),
}));

jest.mock('@/core/auth/guestInviteToken', () => ({
  getSignedGuestInviteSession: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/core/auth/guestInviteSession', () => ({
  getGuestInviteSession: jest.fn().mockResolvedValue(null),
  GUEST_INVITE_COOKIE: 'guest_invite',
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    modules: ['registry', 'groupGifting'],
    emailProvider: 'smtp',
    smtpHost: 'smtp.wedding.test',
    contactEmail: 'couple@wedding.test',
    baseUrl: 'https://couple.wedding.test',
    defaultPaymentHandleType: 'Venmo',
    defaultPaymentHandle: '@couple-venmo',
  }),
}));

jest.mock('../../service', () => ({
  registryService: {
    getContributorWithItem: jest.fn(),
    confirmContribution: jest.fn(),
    cancelReservedContribution: jest.fn(),
    voidContribution: jest.fn(),
    markContributorReminderSent: jest.fn(),
    claimContributorEmailSend: jest.fn().mockResolvedValue(true),
  },
}));

describe('Contributor Signed Links, Scanner-Safe Claims, Middleware & Admin Lifecycle API', () => {
  const originalSessionSecret = process.env.GUEST_SESSION_SECRET;
  const originalPasscode = process.env.GUEST_PASSCODE;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GUEST_SESSION_SECRET = 'test-guest-session-secret-at-least-32-chars!!';
    process.env.GUEST_PASSCODE = 'wedding2026';
    (isAdminRequest as jest.Mock).mockResolvedValue(false);
    (isGuestRequest as jest.Mock).mockResolvedValue(false);
  });

  afterAll(() => {
    process.env.GUEST_SESSION_SECRET = originalSessionSecret;
    process.env.GUEST_PASSCODE = originalPasscode;
  });

  describe('signContributorActionToken & verifyContributorActionToken', () => {
    it('verifies valid tokens and rejects forged, expired, wrong-scope, or GUEST_PASSCODE-signed tokens', async () => {
      const confirmToken = await signContributorActionToken({
        contributorId: 'contrib-123',
        action: 'confirm',
      });

      const verified = await verifyContributorActionToken(confirmToken, 'confirm');
      expect(verified).toMatchObject({
        contributorId: 'contrib-123',
        action: 'confirm',
      });

      // Wrong expected scope rejected
      expect(await verifyContributorActionToken(confirmToken, 'cancel')).toBeNull();

      // Forged token signed with attacker secret or GUEST_PASSCODE rejected
      const forgedWithPasscode = await signCompactToken(
        {
          contributorId: 'contrib-123',
          action: 'confirm',
          iat: Date.now(),
          exp: Date.now() + 60_000,
        },
        'wedding2026'
      );
      expect(await verifyContributorActionToken(forgedWithPasscode)).toBeNull();

      // Expired token rejected
      const expiredToken = await signContributorActionToken({
        contributorId: 'contrib-123',
        action: 'cancel',
        iat: Date.now() - 120_000,
        exp: Date.now() - 60_000,
      });
      expect(await verifyContributorActionToken(expiredToken)).toBeNull();

      // Misconfiguration where GUEST_SESSION_SECRET === GUEST_PASSCODE throws on signing and fails verification
      process.env.GUEST_SESSION_SECRET = 'wedding2026';
      await expect(
        signContributorActionToken({ contributorId: 'contrib-123', action: 'confirm' })
      ).rejects.toThrow('GUEST_SESSION_SECRET must not use the value of GUEST_PASSCODE');
      expect(await verifyContributorActionToken(confirmToken)).toBeNull();
    });
  });

  describe('Edge middleware public exclusions', () => {
    it('allows unauthenticated access to /guest/claim and /api/registry/claim while protecting /registry and /api/admin/*', async () => {
      const claimPageRes = await middleware(
        new NextRequest('http://localhost:3000/guest/claim?token=abc', {
          headers: { host: 'localhost:3000' },
        })
      );
      expect(claimPageRes.status).toBe(200);

      const claimApiRes = await middleware(
        new NextRequest('http://localhost:3000/api/registry/claim?token=abc', {
          headers: { host: 'localhost:3000' },
        })
      );
      expect(claimApiRes.status).toBe(200);

      const protectedRegistryRes = await middleware(
        new NextRequest('http://localhost:3000/registry', {
          headers: { host: 'localhost:3000' },
        })
      );
      expect(protectedRegistryRes.status).toBe(303);

      const protectedAdminActionRes = await middleware(
        new NextRequest('http://localhost:3000/api/admin/contributors/c-1/action', {
          method: 'POST',
          headers: { host: 'localhost:3000' },
        })
      );
      expect(protectedAdminActionRes.status).toBe(401);
    });
  });

  describe('GET & POST /api/registry/claim (scanner-safe flow)', () => {
    it('returns non-PII preview on GET without mutating DB, then confirms or cancels only on explicit POST', async () => {
      const sendEmailSpy = jest
        .spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail')
        .mockResolvedValue({ success: true });

      try {
        const confirmToken = await signContributorActionToken({
          contributorId: 'c-reserved-99',
          action: 'confirm',
        });
        const cancelToken = await signContributorActionToken({
          contributorId: 'c-reserved-99',
          action: 'cancel',
        });

        (registryService.getContributorWithItem as jest.Mock).mockResolvedValue({
          contributor: {
            id: 'c-reserved-99',
            name: 'Private Guest Name',
            email: 'private@example.com',
            message: 'Secret gift note',
            trackingNumber: '1ZSECRET',
            amount: 120,
            refundedAmount: 0,
            status: 'RESERVED',
          },
          item: {
            id: 'item-fund-99',
            name: 'Honeymoon Flight Fund',
            itemType: 'CASH_FUND',
            isGroupGift: true,
            isSample: false,
            price: 500,
            amountContributed: 120,
            purchased: false,
            contributors: [],
          },
        });

        // 1. Email security scanner prefetches GET /api/registry/claim -> zero mutations, zero PII
        const getRes = await claimGET(
          new NextRequest(
            `http://localhost:3000/api/registry/claim?token=${encodeURIComponent(confirmToken)}`
          )
        );
        expect(getRes.status).toBe(200);
        const previewJson = await getRes.json();
        expect(previewJson.data).toEqual({
          action: 'confirm',
          status: 'RESERVED',
          amount: 120,
          itemId: 'item-fund-99',
          itemName: 'Honeymoon Flight Fund',
          itemType: 'CASH_FUND',
          isGroupGift: true,
          vendorUrl: null,
          paymentHandle: '@couple-venmo',
          paymentHandleType: 'Venmo',
        });
        expect(JSON.stringify(previewJson)).not.toContain('Private Guest Name');
        expect(JSON.stringify(previewJson)).not.toContain('private@example.com');
        expect(JSON.stringify(previewJson)).not.toContain('Secret gift note');
        expect(registryService.confirmContribution).not.toHaveBeenCalled();
        expect(registryService.cancelReservedContribution).not.toHaveBeenCalled();
        expect(sendEmailSpy).not.toHaveBeenCalled();

        // 2. Explicit form POST confirms RESERVED -> CONFIRMED and dispatches delayed couple alert
        (registryService.confirmContribution as jest.Mock).mockResolvedValueOnce({
          changed: true,
          previousStatus: 'RESERVED',
          contributor: {
            id: 'c-reserved-99',
            name: 'Private Guest Name',
            email: 'private@example.com',
            message: 'Secret gift note',
            amount: 120,
            refundedAmount: 0,
            status: 'CONFIRMED',
          },
          item: {
            id: 'item-fund-99',
            name: 'Honeymoon Flight Fund',
            itemType: 'CASH_FUND',
            isGroupGift: true,
            price: 500,
            amountContributed: 120,
            purchased: false,
            contributors: [],
          },
        });

        const postConfirmRes = await claimPOST(
          new NextRequest('http://localhost:3000/api/registry/claim', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: confirmToken }),
          })
        );
        expect(postConfirmRes.status).toBe(200);
        const confirmJson = await postConfirmRes.json();
        expect(confirmJson.data.status).toBe('CONFIRMED');
        expect(registryService.confirmContribution).toHaveBeenCalledWith('c-reserved-99', 'Guest');
        expect(sendEmailSpy).toHaveBeenCalledTimes(1);
        expect(sendEmailSpy.mock.calls[0][0].to).toBe('couple@wedding.test');

        // 3. Explicit form POST with cancelToken cancels RESERVED -> CANCELLED and reopens item
        (registryService.cancelReservedContribution as jest.Mock).mockResolvedValueOnce({
          changed: true,
          previousStatus: 'RESERVED',
          contributor: {
            id: 'c-reserved-99',
            name: 'Private Guest Name',
            amount: 120,
            refundedAmount: 0,
            status: 'CANCELLED',
          },
          item: {
            id: 'item-fund-99',
            name: 'Honeymoon Flight Fund',
            price: 500,
            amountContributed: 0,
            purchased: false,
            contributors: [],
          },
        });

        const postCancelRes = await claimPOST(
          new NextRequest('http://localhost:3000/api/registry/claim', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: cancelToken }),
          })
        );
        expect(postCancelRes.status).toBe(200);
        const cancelJson = await postCancelRes.json();
        expect(cancelJson.data.status).toBe('CANCELLED');
        expect(cancelJson.data.item.amountContributed).toBe(0);
      } finally {
        sendEmailSpy.mockRestore();
      }
    });
  });

  describe('POST /api/admin/contributors/[id]/action', () => {
    it('rejects unauthenticated requests with 401 and executes confirm, remind, and void for admins', async () => {
      const unauthRes = await adminActionPOST(
        new NextRequest('http://localhost:3000/api/admin/contributors/c-1/action', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'confirm' }),
        }),
        { params: Promise.resolve({ id: 'c-1' }) }
      );
      expect(unauthRes.status).toBe(401);

      (isAdminRequest as jest.Mock).mockResolvedValue(true);
      const sendEmailSpy = jest
        .spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail')
        .mockResolvedValue({ success: true });

      try {
        // Polite Reminder action
        (registryService.getContributorWithItem as jest.Mock).mockResolvedValueOnce({
          contributor: {
            id: 'c-remind-1',
            name: 'Reminder Guest',
            email: 'remind@example.com',
            amount: 80,
            refundedAmount: 0,
            status: 'RESERVED',
          },
          item: {
            id: 'item-remind-1',
            name: 'Toaster',
            itemType: 'PHYSICAL',
            vendorUrl: 'https://vendor.example.com/toaster',
          },
        });
        (registryService.markContributorReminderSent as jest.Mock).mockResolvedValueOnce({
          id: 'c-remind-1',
          status: 'RESERVED',
          refundedAmount: 0,
          reminderEmailSentAt: '2026-11-22T12:00:00.000Z',
        });

        const remindRes = await adminActionPOST(
          new NextRequest('http://localhost:3000/api/admin/contributors/c-remind-1/action', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'remind' }),
          }),
          { params: Promise.resolve({ id: 'c-remind-1' }) }
        );
        expect(remindRes.status).toBe(200);
        expect(sendEmailSpy).toHaveBeenCalledTimes(1);
        expect(sendEmailSpy.mock.calls[0][0].to).toBe('remind@example.com');
        expect(sendEmailSpy.mock.calls[0][0].body).toContain('/guest/claim?token=');
        expect(registryService.markContributorReminderSent).toHaveBeenCalledWith('c-remind-1');

        // Void action
        (registryService.voidContribution as jest.Mock).mockResolvedValueOnce({
          changed: true,
          previousStatus: 'RESERVED',
          contributor: {
            id: 'c-remind-1',
            status: 'CANCELLED',
            refundedAmount: 0,
            reminderEmailSentAt: null,
          },
          item: {
            id: 'item-remind-1',
            name: 'Toaster',
            price: 80,
            amountContributed: 0,
            purchased: false,
            contributors: [],
          },
        });

        const voidRes = await adminActionPOST(
          new NextRequest('http://localhost:3000/api/admin/contributors/c-remind-1/action', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'void' }),
          }),
          { params: Promise.resolve({ id: 'c-remind-1' }) }
        );
        expect(voidRes.status).toBe(200);
        const voidJson = await voidRes.json();
        expect(voidJson.data.contributor.status).toBe('CANCELLED');
        expect(voidJson.data.item.amountContributed).toBe(0);
      } finally {
        sendEmailSpy.mockRestore();
      }
    });
  });

  describe('Multisite Tenant Claims & Legacy Single-Site Claim Compatibility', () => {
    const originalMultisite = process.env.MULTISITE_ENABLED;
    const originalAllowedHosts = process.env.ALLOWED_HOSTS;

    afterEach(() => {
      if (originalMultisite !== undefined) {
        process.env.MULTISITE_ENABLED = originalMultisite;
      } else {
        delete process.env.MULTISITE_ENABLED;
      }
      if (originalAllowedHosts !== undefined) {
        process.env.ALLOWED_HOSTS = originalAllowedHosts;
      } else {
        delete process.env.ALLOWED_HOSTS;
      }
    });

    it('stamps siteId and normalized subdomain in signContributorActionToken and dispatchContributionNotifications, blocks cross-tenant claims when MULTISITE_ENABLED=true, and accepts legacy tokens when MULTISITE_ENABLED=false', async () => {
      const { getAppConfig } = await import('@/lib/config');
      const { dispatchContributionNotifications } = await import('../../notifications');

      process.env.ALLOWED_HOSTS = 'localhost,*.wedding.test,wedding.test';
      process.env.MULTISITE_ENABLED = 'true';

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

      (getAppConfig as jest.Mock).mockImplementation(async (subdomainOrId?: string) => {
        if (subdomainOrId === 'bob' || subdomainOrId === 'site-bob') {
          return bobConfig;
        }
        return aliceConfig;
      });

      // 1. Verify dispatchContributionNotifications stamps siteId + normalized subdomain on email links
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
        const verifiedEmailed = await verifyContributorActionToken(emailedToken);
        expect(verifiedEmailed).toMatchObject({
          contributorId: 'contrib-alice-1',
          siteId: 'site-alice',
          subdomain: 'alice',
        });
      } finally {
        sendEmailSpy.mockRestore();
      }

      // 2. Tenant A token succeeds on Tenant A and is rejected with 401 on Tenant B (GET & POST)
      const aliceConfirmToken = await signContributorActionToken({
        contributorId: 'contrib-alice-1',
        action: 'confirm',
        siteId: 'site-alice',
        subdomain: 'Alice',
      });
      expect(await verifyContributorActionToken(aliceConfirmToken)).toMatchObject({
        contributorId: 'contrib-alice-1',
        action: 'confirm',
        siteId: 'site-alice',
        subdomain: 'alice',
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

      // Same-tenant token succeeds when MULTISITE_ENABLED=true
      const aliceGetRes = await claimGET(
        new NextRequest(
          `https://alice.wedding.test/api/registry/claim?token=${encodeURIComponent(aliceConfirmToken)}`,
          { headers: { host: 'alice.wedding.test' } }
        ),
        {}
      );
      expect(aliceGetRes.status).toBe(200);

      // 3. Legacy claimless 30-day email token succeeds when MULTISITE_ENABLED=false
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
});
