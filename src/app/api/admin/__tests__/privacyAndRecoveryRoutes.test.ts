/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  unstable_cache: (fn: (...args: any[]) => any) => fn,
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    appConfig: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
    snapshotVersion: {
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
    },
    subEvent: {
      findMany: jest.fn(),
    },
    contentNode: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    invitationCode: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

import { POST as changeAdminPasswordPost } from '@/app/api/admin/password/route';
import { POST as requestResetPost } from '@/app/api/admin/password-reset/request/route';
import { POST as confirmResetPost } from '@/app/api/admin/password-reset/confirm/route';
import { PUT as updateSettingsPut, GET as getSettingsGet } from '@/app/api/admin/settings/route';
import { POST as importBackupPost } from '@/app/api/admin/maintenance/import/route';
import { POST as rsvpPost } from '@/app/api/rsvp/route';
import { GET as scheduleGet } from '@/app/api/schedule/route';
import { prisma } from '@/lib/prisma';
import { env } from '@/env';
import {
  ADMIN_COOKIE,
  signAdminToken,
} from '@/core/auth/auth.server';
import {
  GUEST_COOKIE,
  signGuestToken,
} from '@/core/auth/guest.server';
import {
  GUEST_INVITE_COOKIE,
  signGuestInviteSessionToken,
} from '@/core/auth/guestInviteSession';
import {
  isActiveAdminSession,
  isActiveGuestPasscodeSession,
} from '@/core/auth/nodeSessionGuards';
import {
  hashPassword,
  verifyPassword,
  signAdminPasswordResetToken,
} from '@/utils/password';
import {
  toPublicAppConfig,
  toAdminAppConfig,
  sanitizeAppConfigForBackup,
} from '@/lib/config';
import { AppConfigSchema } from '@/features/content';
import { MultiChannelMessagingProvider } from '@/features/broadcast';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';

function buildFullConfigRow(overrides: Record<string, unknown> = {}) {
  return AppConfigSchema.parse({
    id: 'global',
    partner1Name: 'Alex',
    partner2Name: 'Sam',
    brideName: 'Alex',
    groomName: 'Sam',
    weddingDate: new Date('2027-09-18T00:00:00.000Z'),
    baseUrl: 'https://celebration.example.com',
    contactEmail: 'hosts@celebration.example.com',
    venueName: 'Conservatory Hall',
    venueAddress: '100 Garden Way',
    venueCity: 'Portland',
    venueState: 'OR',
    venueZip: '97201',
    latitude: 45.52,
    longitude: -122.67,
    heroTitle: 'Welcome',
    heroSubtitle: 'Join us',
    storyText: 'Our story',
    venueDescription: 'Garden venue',
    travelAdvice: 'Fly PDX',
    seoTitle: 'Alex & Sam',
    seoDescription: 'Celebration details',
    faviconUrl: '/assets/favicon.png',
    ogImageUrl: '/api/og',
    seoKeywords: 'wedding, celebration',
    features: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    guestPasscodeEnabled: true,
    guestPasscode: 'garden2027',
    guestPasscodeVersion: 1,
    allowSearchIndexing: false,
    adminPasswordHash: null,
    adminSessionVersion: 1,
    emailProvider: 'resend',
    resendApiKey: 're_live_123456',
    resendFrom: 'noreply@celebration.example.com',
    ...overrides,
  });
}

function buildAdminRequest(
  url: string,
  method: string,
  adminToken: string,
  body?: unknown
): NextRequest {
  return new NextRequest(url, {
    method,
    headers: {
      host: 'localhost:3000',
      origin: 'http://localhost:3000',
      cookie: `${ADMIN_COOKIE}=${adminToken}`,
      'content-type': 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe('Privacy Settings, Session Versioning, Stateless Recovery & Secret Masking', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitsForTesting();
  });

  describe('Password scrypt hashing & verification', () => {
    it('hashes passwords with scrypt: prefix and verifies matching vs wrong inputs', async () => {
      const digest = await hashPassword('CorrectHorseBatteryStaple!99');
      expect(digest.startsWith('scrypt:')).toBe(true);
      expect(await verifyPassword('CorrectHorseBatteryStaple!99', digest)).toBe(true);
      expect(await verifyPassword('WrongPassword!99', digest)).toBe(false);
    });
  });

  describe('POST /api/admin/password (Admin Password Rotation & Session Revocation)', () => {
    it('rejects wrong currentPassword with 401 and rotates password + increments adminSessionVersion on valid input', async () => {
      const initialHash = await hashPassword('old-admin-pass-123');
      let storedRow = buildFullConfigRow({
        adminPasswordHash: initialHash,
        adminSessionVersion: 2,
      });

      (prisma.appConfig.findUnique as jest.Mock).mockImplementation(async () => storedRow);
      (prisma.appConfig.update as jest.Mock).mockImplementation(async ({ data }: any) => {
        storedRow = {
          ...storedRow,
          ...data,
        };
        return storedRow;
      });

      const oldAdminToken = await signAdminToken({
        isAdmin: true,
        adminSessionVersion: 2,
        iat: Date.now(),
        exp: Date.now() + 3600_000,
      });

      // 1. Reject wrong current password
      const badReq = buildAdminRequest(
        'http://localhost:3000/api/admin/password',
        'POST',
        oldAdminToken,
        {
          currentPassword: 'wrong-password',
          newPassword: 'new-admin-pass-456',
          confirmPassword: 'new-admin-pass-456',
        }
      );
      const badRes = await changeAdminPasswordPost(badReq);
      expect(badRes.status).toBe(401);

      // 2. Rotate to new password
      const goodReq = buildAdminRequest(
        'http://localhost:3000/api/admin/password',
        'POST',
        oldAdminToken,
        {
          currentPassword: 'old-admin-pass-123',
          newPassword: 'new-admin-pass-456',
          confirmPassword: 'new-admin-pass-456',
        }
      );
      const goodRes = await changeAdminPasswordPost(goodReq);
      expect(goodRes.status).toBe(200);
      expect(storedRow.adminSessionVersion).toBe(3);
      expect(await verifyPassword('new-admin-pass-456', storedRow.adminPasswordHash!)).toBe(true);

      // 3. Old session token (version 2) is immediately rejected by Node session guard & withApiMiddleware
      const staleCheckReq = buildAdminRequest(
        'http://localhost:3000/api/admin/settings',
        'GET',
        oldAdminToken
      );
      expect(await isActiveAdminSession(staleCheckReq)).toBe(false);
      const staleSettingsRes = await getSettingsGet(staleCheckReq);
      expect(staleSettingsRes.status).toBe(401);

      // 4. Newly minted cookie on response has version 3 and passes Node session guard
      const setCookieHeader = goodRes.headers.get('set-cookie') || '';
      const cookieMatch = setCookieHeader.match(/admin_auth=([^;]+)/);
      expect(cookieMatch).not.toBeNull();
      const freshToken = decodeURIComponent(cookieMatch![1]);
      const freshCheckReq = buildAdminRequest(
        'http://localhost:3000/api/admin/settings',
        'GET',
        freshToken
      );
      expect(await isActiveAdminSession(freshCheckReq)).toBe(true);
    });
  });

  describe('Stateless Admin Password Recovery (/api/admin/password-reset/request & confirm)', () => {
    it('returns uniform 200 without sending email when contactEmail is placeholder or email provider is unconfigured', async () => {
      const sendEmailSpy = jest
        .spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail')
        .mockResolvedValue({ success: true });

      const placeholderRow = buildFullConfigRow({
        contactEmail: 'hosts@wedding.example',
      });
      (prisma.appConfig.findUnique as jest.Mock).mockResolvedValue(placeholderRow);

      const req = new NextRequest('http://localhost:3000/api/admin/password-reset/request', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const res = await requestResetPost(req);
      expect(res.status).toBe(200);
      const payload = await res.json();
      expect(payload.success).toBe(true);
      expect(sendEmailSpy).not.toHaveBeenCalled();

      sendEmailSpy.mockRestore();
    });

    it('dispatches a 30-minute single-use recovery link, resets password once, and rejects token replay or expiry', async () => {
      let capturedBody = '';
      const sendEmailSpy = jest
        .spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail')
        .mockImplementation(async (msg) => {
          capturedBody = msg.body;
          return { success: true };
        });

      const initialHash = await hashPassword('forgotten-pass-111');
      let storedRow = buildFullConfigRow({
        adminPasswordHash: initialHash,
        adminSessionVersion: 4,
        contactEmail: 'couple@celebration.example.com',
        emailProvider: 'resend',
        resendApiKey: 're_test_key',
      });

      (prisma.appConfig.findUnique as jest.Mock).mockImplementation(async () => storedRow);
      (prisma.appConfig.update as jest.Mock).mockImplementation(async ({ data }: any) => {
        storedRow = { ...storedRow, ...data };
        return storedRow;
      });

      const reqReset = new NextRequest('http://localhost:3000/api/admin/password-reset/request', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      const resReset = await requestResetPost(reqReset);
      expect(resReset.status).toBe(200);
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);

      const urlMatch = capturedBody.match(/\/admin\/login\?token=([^\s]+)/);
      expect(urlMatch).not.toBeNull();
      const extractedToken = decodeURIComponent(urlMatch![1]);

      // Confirm reset with valid token
      const confirmReq = new NextRequest('http://localhost:3000/api/admin/password-reset/confirm', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          token: extractedToken,
          newPassword: 'recovered-admin-pass-999',
          confirmPassword: 'recovered-admin-pass-999',
        }),
      });
      const confirmRes = await confirmResetPost(confirmReq);
      expect(confirmRes.status).toBe(200);
      expect(storedRow.adminSessionVersion).toBe(5);
      expect(await verifyPassword('recovered-admin-pass-999', storedRow.adminPasswordHash!)).toBe(true);

      // Replay of the exact same token fails immediately (single-use stateless binding)
      const replayReq = new NextRequest('http://localhost:3000/api/admin/password-reset/confirm', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          token: extractedToken,
          newPassword: 'another-password-111',
          confirmPassword: 'another-password-111',
        }),
      });
      const replayRes = await confirmResetPost(replayReq);
      expect(replayRes.status).toBe(400);
      const replayJson = await replayRes.json();
      expect(replayJson.error).toMatch(/already been used|invalid/i);

      // Expired token fails with clear expired error
      const expiredToken = signAdminPasswordResetToken(
        {
          envAdminPassword: env.ADMIN_PASSWORD,
          activePasswordHash: storedRow.adminPasswordHash!,
          adminSessionVersion: storedRow.adminSessionVersion,
        },
        {
          iat: Date.now() - 31 * 60 * 1000,
        }
      );
      const expiredReq = new NextRequest('http://localhost:3000/api/admin/password-reset/confirm', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          token: expiredToken,
          newPassword: 'another-password-222',
          confirmPassword: 'another-password-222',
        }),
      });
      const expiredRes = await confirmResetPost(expiredReq);
      expect(expiredRes.status).toBe(400);
      const expiredJson = await expiredRes.json();
      expect(expiredJson.error).toMatch(/expired/i);

      sendEmailSpy.mockRestore();
    });
  });

  describe('Guest Passcode Rotation, Public Mode & Invitation Isolation', () => {
    it('increments guestPasscodeVersion when rotating passcode, revokes old guest_auth cookies, and preserves guest_invite_session', async () => {
      let storedRow = buildFullConfigRow({
        guestPasscodeEnabled: true,
        guestPasscode: 'spring2027',
        guestPasscodeVersion: 1,
        adminSessionVersion: 1,
      });

      const capturedSnapshots: unknown[] = [];
      (prisma.appConfig.findUnique as jest.Mock).mockImplementation(async () => storedRow);
      (prisma.appConfig.update as jest.Mock).mockImplementation(async ({ data }: any) => {
        storedRow = { ...storedRow, ...data };
        return storedRow;
      });
      (prisma.snapshotVersion.create as jest.Mock).mockImplementation(async ({ data }: any) => {
        capturedSnapshots.push(data);
        return { id: 'snap-1', ...data };
      });
      (prisma.snapshotVersion.findMany as jest.Mock).mockResolvedValue([{ id: 'snap-1' }]);

      const adminToken = await signAdminToken({
        isAdmin: true,
        adminSessionVersion: 1,
        iat: Date.now(),
        exp: Date.now() + 3600_000,
      });

      const oldGuestToken = await signGuestToken({
        guest: true,
        guestPasscodeVersion: 1,
        iat: Date.now(),
        exp: Date.now() + 3600_000,
      });

      // Saving unchanged passcode keeps version 1
      const unchangedPutReq = buildAdminRequest(
        'http://localhost:3000/api/admin/settings',
        'PUT',
        adminToken,
        {
          ...toAdminAppConfig(storedRow),
          guestPasscode: 'spring2027',
        }
      );
      const unchangedRes = await updateSettingsPut(unchangedPutReq);
      expect(unchangedRes.status).toBe(200);
      expect(storedRow.guestPasscodeVersion).toBe(1);

      // Rotating passcode increments version to 2
      const rotatePutReq = buildAdminRequest(
        'http://localhost:3000/api/admin/settings',
        'PUT',
        adminToken,
        {
          ...toAdminAppConfig(storedRow),
          guestPasscode: 'autumn2027',
        }
      );
      const rotateRes = await updateSettingsPut(rotatePutReq);
      expect(rotateRes.status).toBe(200);
      expect(storedRow.guestPasscode).toBe('autumn2027');
      expect(storedRow.guestPasscodeVersion).toBe(2);

      // Snapshot audit row must never contain guestPasscode or adminPasswordHash
      const snapshotData = (capturedSnapshots[capturedSnapshots.length - 1] as any).data;
      expect(snapshotData).not.toHaveProperty('guestPasscode');
      expect(snapshotData).not.toHaveProperty('adminPasswordHash');

      // Old guest_auth token (version 1) is now rejected
      const staleGuestReq = new NextRequest('http://localhost:3000/api/schedule', {
        headers: {
          host: 'localhost:3000',
          cookie: `${GUEST_COOKIE}=${oldGuestToken}`,
          'x-guest-gated-api': '1',
        },
      });
      expect(await isActiveGuestPasscodeSession(staleGuestReq)).toBe(false);

      // Reject setting guestPasscode equal to GUEST_SESSION_SECRET
      const originalGuestSecret = process.env.GUEST_SESSION_SECRET;
      process.env.GUEST_SESSION_SECRET = 'super-distinct-session-secret-xyz';
      try {
        const collisionReq = buildAdminRequest(
          'http://localhost:3000/api/admin/settings',
          'PUT',
          adminToken,
          {
            ...toAdminAppConfig(storedRow),
            guestPasscode: 'super-distinct-session-secret-xyz',
          }
        );
        const collisionRes = await updateSettingsPut(collisionReq);
        expect(collisionRes.status).toBe(400);
      } finally {
        if (originalGuestSecret === undefined) {
          delete process.env.GUEST_SESSION_SECRET;
        } else {
          process.env.GUEST_SESSION_SECRET = originalGuestSecret;
        }
      }
    });

    it('allows unauthenticated schedule browsing in Public mode while hiding private sub-events and still requiring guest_invite_session on POST /api/rsvp', async () => {
      const publicRow = buildFullConfigRow({
        guestPasscodeEnabled: false,
      });
      (prisma.appConfig.findUnique as jest.Mock).mockResolvedValue(publicRow);
      (prisma.subEvent.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'pub-ceremony',
          name: 'Main Ceremony',
          isPublic: true,
          sortOrder: 1,
          date: '2027-09-18',
          time: '16:00',
          location: 'Garden',
          description: 'Ceremony',
        },
      ]);

      // 1. Unauthenticated caller in Public mode gets public schedule items (and query filters isPrivate: false)
      const anonScheduleReq = new NextRequest('http://localhost:3000/api/schedule', {
        headers: {
          host: 'localhost:3000',
          'x-guest-gated-api': '1',
        },
      });
      const anonScheduleRes = await scheduleGet(anonScheduleReq);
      expect(anonScheduleRes.status).toBe(200);
      expect(prisma.subEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isPrivate: false },
        })
      );

      // 2. Unauthenticated caller in Public mode is still blocked with 401 on POST /api/rsvp (requires guest_invite_session)
      const anonRsvpReq = new NextRequest('http://localhost:3000/api/rsvp', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
          'x-guest-gated-api': '1',
        },
        body: JSON.stringify({
          invitationCode: 'FAM001',
          guests: [],
        }),
      });
      const anonRsvpRes = await rsvpPost(anonRsvpReq);
      expect(anonRsvpRes.status).toBe(401);

      // 3. Household with valid guest_invite_session sees private sub-events they are invited to
      (prisma.invitationCode.findUnique as jest.Mock).mockResolvedValue({
        id: 'inv-1',
        code: 'FAM001',
        guestName: 'Rivera Family',
        isSample: false,
        plusOneAllocations: 0,
      });
      const inviteToken = await signGuestInviteSessionToken({
        code: 'FAM001',
        guestName: 'Rivera Family',
        iat: Date.now(),
        exp: Date.now() + 3600_000,
      });
      const inviteScheduleReq = new NextRequest('http://localhost:3000/api/schedule', {
        headers: {
          host: 'localhost:3000',
          cookie: `${GUEST_INVITE_COOKIE}=${inviteToken}`,
          'x-guest-gated-api': '1',
        },
      });
      const inviteScheduleRes = await scheduleGet(inviteScheduleReq);
      expect(inviteScheduleRes.status).toBe(200);
      expect(prisma.subEvent.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([{ isPrivate: false }]),
          }),
        })
      );
    });
  });

  describe('DTO Secret Masking & Backup Export/Import Preservation', () => {
    it('strips guestPasscode and adminPasswordHash from public & backup DTOs, exposes effective guestPasscode only to admin DTO, and preserves secrets across backup import', async () => {
      const adminHash = await hashPassword('secret-admin-999');
      const fullRow = buildFullConfigRow({
        guestPasscode: 'custom-pass-2027',
        guestPasscodeVersion: 3,
        adminPasswordHash: adminHash,
        adminSessionVersion: 2,
      });

      const publicDto = toPublicAppConfig(fullRow);
      expect(publicDto).not.toHaveProperty('guestPasscode');
      expect(publicDto).not.toHaveProperty('adminPasswordHash');
      expect(publicDto.guestPasscodeEnabled).toBe(true);
      expect(publicDto.allowSearchIndexing).toBe(false);

      const adminDto = toAdminAppConfig(fullRow);
      expect(adminDto.guestPasscode).toBe('custom-pass-2027');
      expect(adminDto).not.toHaveProperty('adminPasswordHash');

      const sanitizedBackupRecord = sanitizeAppConfigForBackup(fullRow as unknown as Record<string, unknown>);
      expect(sanitizedBackupRecord).not.toHaveProperty('guestPasscode');
      expect(sanitizedBackupRecord).not.toHaveProperty('adminPasswordHash');

      // Import sanitized backup over existing row and verify secrets + versions remain intact
      let createdAppConfigs: any[] = [];
      (prisma.appConfig.findUnique as jest.Mock).mockResolvedValue(fullRow);
      (prisma.appConfig.findMany as jest.Mock).mockResolvedValue([fullRow]);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => {
        const tx = {
          broadcastRecipient: { deleteMany: jest.fn(), createMany: jest.fn() },
          broadcastMessage: { deleteMany: jest.fn(), createMany: jest.fn() },
          subEventRsvp: { deleteMany: jest.fn(), createMany: jest.fn() },
          subEventAccess: { deleteMany: jest.fn(), createMany: jest.fn() },
          subEvent: { deleteMany: jest.fn(), createMany: jest.fn() },
          contributor: { deleteMany: jest.fn(), createMany: jest.fn() },
          registryItem: { deleteMany: jest.fn(), createMany: jest.fn() },
          invitationCode: { deleteMany: jest.fn(), createMany: jest.fn() },
          seatingTable: { deleteMany: jest.fn(), createMany: jest.fn() },
          attraction: { deleteMany: jest.fn(), createMany: jest.fn() },
          weddingPartyMember: { deleteMany: jest.fn(), createMany: jest.fn() },
          media: { deleteMany: jest.fn(), createMany: jest.fn() },
          contentNode: { deleteMany: jest.fn(), createMany: jest.fn() },
          snapshotVersion: { createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
          appConfig: {
            findMany: jest.fn().mockResolvedValue([fullRow]),
            deleteMany: jest.fn(),
            createMany: jest.fn().mockImplementation(async ({ data }: any) => {
              createdAppConfigs = data;
              return { count: data.length };
            }),
          },
        };
        return cb(tx);
      });

      const adminToken = await signAdminToken({
        isAdmin: true,
        adminSessionVersion: 2,
        iat: Date.now(),
        exp: Date.now() + 3600_000,
      });

      const importReq = buildAdminRequest(
        'http://localhost:3000/api/admin/maintenance/import',
        'POST',
        adminToken,
        {
          version: '1.0',
          exportedAt: new Date().toISOString(),
          appConfig: [sanitizedBackupRecord],
          registryItem: [],
        }
      );

      const importRes = await importBackupPost(importReq);
      expect(importRes.status).toBe(200);
      expect(createdAppConfigs).toHaveLength(1);
      expect(createdAppConfigs[0].guestPasscode).toBe('custom-pass-2027');
      expect(createdAppConfigs[0].adminPasswordHash).toBe(adminHash);
      expect(createdAppConfigs[0].guestPasscodeVersion).toBe(3);
      expect(createdAppConfigs[0].adminSessionVersion).toBe(2);
    });
  });
});
