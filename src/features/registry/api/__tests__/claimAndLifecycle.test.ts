/** @jest-environment node */

import { NextRequest } from 'next/server';
import { signCompactToken } from '@/core/auth/tokenCookieHelpers';
import { middleware } from '@/middleware';
import { isAdminRequest } from '@/core/auth/auth.server';
import { isGuestRequest } from '@/core/auth/guest.server';
import { getAppConfig } from '@/lib/config';
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

        // 4. Physical item claim preview returns vendorUrl + shippingAddress with zero DB mutations, and POST forwards optional order tracking details
        (getAppConfig as jest.Mock).mockResolvedValueOnce({
          modules: { registry: true, groupGifting: true },
          contactEmail: 'couple@wedding.test',
          partner1Name: 'Alex',
          partner2Name: 'Taylor',
          shippingRecipientName: 'Alex & Taylor',
          shippingAddressLine1: '742 Evergreen Terrace',
          shippingCity: 'Portland',
          shippingState: 'OR',
          shippingZip: '97205',
          shippingCountry: 'United States',
        });
        const physicalConfirmToken = await signContributorActionToken({
          contributorId: 'c-phys-42',
          action: 'confirm',
        });
        (registryService.getContributorWithItem as jest.Mock).mockResolvedValue({
          contributor: {
            id: 'c-phys-42',
            name: 'Passcode Guest',
            email: 'guest@example.com',
            amount: 180,
            refundedAmount: 0,
            status: 'RESERVED',
          },
          item: {
            id: 'item-phys-42',
            name: 'Dutch Oven',
            itemType: 'PHYSICAL',
            isGroupGift: false,
            isSample: false,
            vendorUrl: 'https://retailer.example.com/dutch-oven',
            price: 180,
            amountContributed: 0,
            purchased: true,
            contributors: [],
          },
        });

        const physPreviewRes = await claimGET(
          new NextRequest(
            `http://localhost:3000/api/registry/claim?token=${encodeURIComponent(physicalConfirmToken)}`
          )
        );
        expect(physPreviewRes.status).toBe(200);
        const physPreviewJson = await physPreviewRes.json();
        expect(physPreviewJson.data.vendorUrl).toBe('https://retailer.example.com/dutch-oven');
        expect(physPreviewJson.data.shippingAddress).toMatchObject({
          recipientName: 'Alex & Taylor',
          addressLine1: '742 Evergreen Terrace',
          city: 'Portland',
          state: 'OR',
          zip: '97205',
        });
        expect(registryService.confirmContribution).toHaveBeenCalledTimes(1);

        (registryService.confirmContribution as jest.Mock).mockResolvedValueOnce({
          changed: true,
          previousStatus: 'RESERVED',
          contributor: {
            id: 'c-phys-42',
            name: 'Passcode Guest',
            email: 'guest@example.com',
            amount: 180,
            refundedAmount: 0,
            status: 'CONFIRMED',
            retailerOrderNumber: 'ORD-7788',
            carrier: 'FedEx',
            trackingNumber: '777123456789',
          },
          item: {
            id: 'item-phys-42',
            name: 'Dutch Oven',
            itemType: 'PHYSICAL',
            isGroupGift: false,
            price: 180,
            amountContributed: 180,
            purchased: true,
            contributors: [],
          },
        });

        const physPostRes = await claimPOST(
          new NextRequest('http://localhost:3000/api/registry/claim', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              token: physicalConfirmToken,
              retailerOrderNumber: ' ORD-7788 ',
              carrier: ' FedEx ',
              trackingNumber: ' 777123456789 ',
            }),
          })
        );
        expect(physPostRes.status).toBe(200);
        expect(registryService.confirmContribution).toHaveBeenLastCalledWith(
          'c-phys-42',
          'Guest',
          {
            retailerOrderNumber: 'ORD-7788',
            carrier: 'FedEx',
            trackingNumber: '777123456789',
          }
        );
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
});
