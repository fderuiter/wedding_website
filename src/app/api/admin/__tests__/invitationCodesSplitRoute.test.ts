/** @jest-environment node */

const mockCreateAuditSnapshot = jest.fn();
const mockIsAdminRequest = jest.fn();

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: (...args: unknown[]) => mockIsAdminRequest(...args),
}));

jest.mock('@/lib/audit', () => ({
  createAuditSnapshot: (...args: unknown[]) => mockCreateAuditSnapshot(...args),
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
  },
}));

import { NextRequest } from 'next/server';
import { POST as splitRoute } from '@/app/api/admin/invitation-codes/split/route';
import { prisma } from '@/lib/prisma';
import {
  isCombinedCoupleGuest,
  parseCombinedCoupleGuestNames,
  suggestHouseholdNameForSplit,
} from '@/utils/invitationValidation';

describe('Combined Couple Parsing & POST /api/admin/invitation-codes/split', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(true);
  });

  describe('Couple name parsing helpers', () => {
    it('detects combined couple entries by connector or named companion', () => {
      expect(isCombinedCoupleGuest({ guestName: 'Mr. & Mrs. Robert Smith' })).toBe(true);
      expect(isCombinedCoupleGuest({ guestName: 'Uncle David & Aunt Clara' })).toBe(true);
      expect(isCombinedCoupleGuest({ guestName: 'Oliver and Claire Bennett' })).toBe(true);
      expect(
        isCombinedCoupleGuest({
          guestName: 'Primary Guest',
          plusOneFirstName: 'Sam',
          plusOneLastName: 'Taylor',
        })
      ).toBe(true);
      expect(isCombinedCoupleGuest({ guestName: 'Eleanor Vance' })).toBe(false);
    });

    it('splits dual honorifics, shared surnames, kinship pairs, and named companions accurately', () => {
      expect(parseCombinedCoupleGuestNames({ guestName: 'Mr. & Mrs. Robert Smith' })).toEqual([
        'Mr. Robert Smith',
        'Mrs. Robert Smith',
      ]);
      expect(parseCombinedCoupleGuestNames({ guestName: 'Oliver & Claire Bennett' })).toEqual([
        'Oliver Bennett',
        'Claire Bennett',
      ]);
      expect(parseCombinedCoupleGuestNames({ guestName: 'Uncle David & Aunt Clara' })).toEqual([
        'Uncle David',
        'Aunt Clara',
      ]);
      expect(
        parseCombinedCoupleGuestNames({
          guestName: 'Jordan Lee',
          plusOneFirstName: 'Casey',
          plusOneLastName: 'Morgan',
        })
      ).toEqual(['Jordan Lee', 'Casey Morgan']);
    });

    it('suggests sensible default household names', () => {
      expect(
        suggestHouseholdNameForSplit({
          guestName: 'Oliver & Claire Bennett',
          householdName: 'The Bennetts',
        })
      ).toBe('The Bennetts');
      expect(suggestHouseholdNameForSplit({ guestName: 'Oliver & Claire Bennett' })).toBe(
        'Bennett Household'
      );
      expect(suggestHouseholdNameForSplit({ guestName: 'Uncle David & Aunt Clara' })).toBe(
        'Uncle David & Aunt Clara Household'
      );
    });
  });

  describe('POST /api/admin/invitation-codes/split', () => {
    it('returns 401 when caller is not an authenticated administrator', async () => {
      mockIsAdminRequest.mockResolvedValueOnce(false);
      const req = new NextRequest('http://localhost/api/admin/invitation-codes/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'inv-1',
          householdName: 'Smith Household',
          members: [{ guestName: 'Robert Smith' }, { guestName: 'Clara Smith' }],
        }),
      });
      expect((await splitRoute(req)).status).toBe(401);
    });

    it('returns 400 on invalid JSON or fewer than 2 members', async () => {
      const badJson = new NextRequest('http://localhost/api/admin/invitation-codes/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid',
      });
      expect((await splitRoute(badJson)).status).toBe(400);

      const tooFew = new NextRequest('http://localhost/api/admin/invitation-codes/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'inv-1',
          householdName: 'Smith Household',
          members: [{ guestName: 'Robert Smith' }],
        }),
      });
      expect((await splitRoute(tooFew)).status).toBe(400);
    });

    it('splits a combined couple into shared-household members, copying address, tags, and SubEventAccess while preserving primary code', async () => {
      const mockTx = {
        invitationCode: {
          findUnique: jest.fn(),
          update: jest.fn(),
          create: jest.fn(),
        },
        subEventAccess: {
          findMany: jest.fn(),
          createMany: jest.fn(),
        },
        subEventRsvp: {
          findMany: jest.fn(),
          createMany: jest.fn(),
        },
      };

      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: (tx: typeof mockTx) => unknown) =>
        cb(mockTx)
      );

      mockTx.invitationCode.findUnique
        .mockResolvedValueOnce({
          id: 'inv-couple-1',
          code: 'SMITH001',
          guestName: 'Oliver & Claire Bennett',
          email: 'oliver@example.com',
          addressLine1: '42 Bellevue Ave',
          addressLine2: 'Apt 2',
          city: 'Newport',
          state: 'RI',
          zipCode: '02840',
          country: 'USA',
          dietaryNotes: 'No peanuts',
          plusOneAllocations: 0,
          plusOneFirstName: null,
          plusOneLastName: null,
          householdName: null,
          partyGroup: 'Bride Family',
          partyTags: ['VIP', 'Rehearsal'],
          used: false,
          usedAt: null,
          isSample: false,
        })
        // Unique code check for member 2
        .mockResolvedValueOnce(null);

      mockTx.subEventAccess.findMany.mockResolvedValue([
        { id: 'acc-1', subEventId: 'se-rehearsal', invitationCodeId: 'inv-couple-1' },
      ]);
      mockTx.subEventRsvp.findMany.mockResolvedValue([
        {
          id: 'rsvp-1',
          subEventId: 'se-ceremony',
          invitationCodeId: 'inv-couple-1',
          status: 'attending',
        },
      ]);

      mockTx.invitationCode.update.mockImplementation(async ({ data }) => ({
        id: 'inv-couple-1',
        code: 'SMITH001',
        ...data,
      }));
      mockTx.invitationCode.create.mockImplementation(async ({ data }) => ({
        id: 'inv-couple-2',
        ...data,
      }));

      const req = new NextRequest('http://localhost/api/admin/invitation-codes/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'inv-couple-1',
          householdName: 'Bennett Household',
          members: [
            {
              guestName: 'Oliver Bennett',
              email: 'oliver@example.com',
              dietaryNotes: 'No peanuts',
              plusOneAllocations: 0,
            },
            {
              guestName: 'Claire Bennett',
              email: 'claire@example.com',
              dietaryNotes: 'Gluten-free',
              plusOneAllocations: 0,
            },
          ],
        }),
      });

      const res = await splitRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.householdName).toBe('Bennett Household');
      expect(json.createdCount).toBe(1);
      expect(json.records).toHaveLength(2);
      expect(json.records[0].code).toBe('SMITH001');
      expect(json.records[0].guestName).toBe('Oliver Bennett');
      expect(json.records[1].guestName).toBe('Claire Bennett');
      expect(json.records[1].code).not.toBe('SMITH001');
      expect(json.records[1].addressLine1).toBe('42 Bellevue Ave');
      expect(json.records[1].partyTags).toEqual(['VIP', 'Rehearsal']);

      expect(mockTx.subEventAccess.createMany).toHaveBeenCalledWith({
        data: [{ subEventId: 'se-rehearsal', invitationCodeId: 'inv-couple-2' }],
        skipDuplicates: true,
      });
      expect(mockTx.subEventRsvp.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              subEventId: 'se-ceremony',
              invitationCodeId: 'inv-couple-2',
              status: 'attending',
              dietaryNotes: 'Gluten-free',
            }),
          ],
        })
      );
      expect(mockCreateAuditSnapshot).toHaveBeenCalledWith(
        'InvitationCode',
        'split_couple',
        expect.objectContaining({
          sourceId: 'inv-couple-1',
          householdName: 'Bennett Household',
        }),
        'Admin',
        mockTx
      );
    });
  });
});
