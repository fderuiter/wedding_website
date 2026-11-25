import { consolidateHouseholdCsvRows, type EditableCsvRow } from '@/utils/csv';
import { DatabaseBackupSchema, reviveDates } from '@/utils/backupValidation';
import {
  computeTableMealCounts,
  generateAveryCardsPdf,
  generateSeatingChartPdf,
  getInvitationPartyMembers,
  resolveDetailedSeatAssignments,
} from '@/features/seating';
import {
  filterTargetGuestsInMemory,
  getGuestEmail,
  getGuestPhone,
  hasBroadcastChannelContact,
} from '../audience';

function buildEditableRow(overrides: Partial<EditableCsvRow> & { guestName: string }): EditableCsvRow {
  return {
    code: '',
    email: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    zipCode: '',
    country: '',
    dietaryNotes: '',
    plusOneAllocations: '',
    plusOneFirstName: '',
    plusOneLastName: '',
    householdName: '',
    partyGroup: '',
    partyTags: '',
    extraFields: {},
    ...overrides,
  };
}

describe('Relational Household Member Workflows (Unit)', () => {
  describe('CSV Household Consolidation', () => {
    it('consolidates multi-row households into relational member records without losing secondary contacts or roles', () => {
      const consolidated = consolidateHouseholdCsvRows(
        [
          buildEditableRow({
            householdName: 'The Rivera Family',
            guestName: 'Elena Rivera',
            email: 'elena@example.com',
            phone: '+1-555-0100',
            dietaryNotes: 'Vegetarian',
            partyTags: 'Bride Side, VIP',
          }),
          buildEditableRow({
            householdName: 'The Rivera Family',
            guestName: 'Marcus Rivera',
            email: 'marcus@example.com',
            phone: '+1-555-0101',
            dietaryNotes: 'Nut allergy',
            partyTags: 'Groom Side',
          }),
          buildEditableRow({
            householdName: 'The Rivera Family',
            guestName: 'Sofia Rivera',
            dietaryNotes: 'Dairy-free',
            partyTags: 'kids',
          }),
        ],
        { groupBy: 'householdName' }
      );

      expect(consolidated).toHaveLength(1);
      const household = consolidated[0]!;
      expect(household.guestName).toBe('Elena Rivera');
      expect(household.plusOneAllocations).toBe('2');
      expect(household.partyTags).toContain('Bride Side');
      expect(household.partyTags).toContain('Groom Side');
      expect(household.members).toHaveLength(3);
      expect(household.members?.[0]).toMatchObject({
        fullName: 'Elena Rivera',
        role: 'PRIMARY',
        email: 'elena@example.com',
        phone: '+15550100',
        dietaryNotes: 'Vegetarian',
        displayOrder: 0,
      });
      expect(household.members?.[1]).toMatchObject({
        fullName: 'Marcus Rivera',
        role: 'PARTNER',
        email: 'marcus@example.com',
        phone: '+15550101',
        dietaryNotes: 'Nut allergy',
        displayOrder: 1,
      });
      expect(household.members?.[2]).toMatchObject({
        fullName: 'Sofia Rivera',
        role: 'CHILD',
        dietaryNotes: 'Dairy-free',
        displayOrder: 2,
      });
    });
  });

  describe('Broadcast Audience Targeting', () => {
    const familyRecord = {
      id: 'inv-1',
      code: 'RIVERA26',
      guestName: 'Elena Rivera',
      householdName: 'The Rivera Family',
      email: null,
      extraFields: {},
      plusOneFirstName: 'Marcus',
      plusOneLastName: 'Rivera',
      partyTags: ['Family'],
      used: true,
      members: [
        {
          id: 'm-1',
          fullName: 'Elena Rivera',
          firstName: 'Elena',
          lastName: 'Rivera',
          role: 'PRIMARY',
          email: null,
          phone: null,
          displayOrder: 0,
        },
        {
          id: 'm-2',
          fullName: 'Marcus Rivera',
          firstName: 'Marcus',
          lastName: 'Rivera',
          role: 'PARTNER',
          email: 'marcus.work@example.com',
          phone: '+1-555-0199',
          dietaryNotes: 'Tree nut allergy',
          displayOrder: 1,
        },
        {
          id: 'm-3',
          fullName: 'Sofia Rivera',
          firstName: 'Sofia',
          lastName: 'Rivera',
          role: 'CHILD',
          email: 'sofia.school@example.com',
          phone: '+1-555-0188',
          displayOrder: 2,
        },
      ],
      subEventRsvps: [
        {
          subEventId: 'se-dinner',
          status: 'attending',
          memberRsvps: [
            { householdMemberId: 'm-1', status: 'declined' },
            { householdMemberId: 'm-2', status: 'attending' },
            { householdMemberId: 'm-3', status: 'declined' },
          ],
        },
      ],
    };

    it('matches secondary adult email, phone, and dietary notes while excluding CHILD profiles from adult contacts', () => {
      expect(
        filterTargetGuestsInMemory([familyRecord], {
          searchQuery: 'marcus.work@example.com',
        })
      ).toHaveLength(1);
      expect(
        filterTargetGuestsInMemory([familyRecord], {
          searchQuery: '0199',
        })
      ).toHaveLength(1);
      expect(
        filterTargetGuestsInMemory([familyRecord], {
          searchQuery: 'sofia.school@example.com',
        })
      ).toHaveLength(0);
      expect(
        filterTargetGuestsInMemory([familyRecord], {
          dietaryCategory: 'nut-free',
        })
      ).toHaveLength(1);

      // Resolves secondary adult email & phone when primary contact is blank
      expect(getGuestEmail(familyRecord)).toBe('marcus.work@example.com');
      expect(getGuestPhone(familyRecord)).toBe('+1-555-0199');
      expect(hasBroadcastChannelContact(familyRecord, 'EMAIL')).toBe(true);
      expect(hasBroadcastChannelContact(familyRecord, 'SMS')).toBe(true);
    });

    it('matches sub-event attendance when a secondary partner attends solo', () => {
      expect(
        filterTargetGuestsInMemory(
          [familyRecord],
          {
            subEventId: 'se-dinner',
            subEventRsvpStatus: 'attending',
          },
          { isPublicSubEvent: true }
        )
      ).toHaveLength(1);
    });
  });

  describe('Seating Chair Binding, Caterer PDFs & Meal Counts', () => {
    it('binds chairs, dietary badges, and meals strictly to attending relational members without Seat 1 bleed', async () => {
      const guest = {
        id: 'inv-1',
        code: 'RIVERA26',
        guestName: 'Elena Rivera',
        householdName: 'The Rivera Family',
        used: true,
        plusOneAllocations: 2,
        plusOneFirstName: 'Marcus',
        plusOneLastName: 'Rivera',
        tableId: 'table-1',
        seatNumber: null,
        plusOneSeatNumbers: [4, 5],
        dietaryNotes: 'Vegetarian',
        partyTags: [],
        extraFields: {},
        members: [
          {
            id: 'm-1',
            fullName: 'Elena Rivera',
            role: 'PRIMARY',
            displayOrder: 0,
            dietaryNotes: 'Vegetarian',
            tags: [],
            seatNumber: null,
          },
          {
            id: 'm-2',
            fullName: 'Marcus Rivera',
            role: 'PARTNER',
            displayOrder: 1,
            dietaryNotes: 'Severe peanut allergy',
            tags: [],
            seatNumber: 4,
          },
          {
            id: 'm-3',
            fullName: 'Sofia Rivera',
            role: 'CHILD',
            displayOrder: 2,
            dietaryNotes: 'Dairy-free',
            tags: [],
            seatNumber: 5,
          },
        ],
        subEventRsvps: [
          {
            subEventId: 'se-reception',
            status: 'attending',
            plusOneCount: 1,
            dietaryNotes: '',
            subEvent: {
              mealOptions: [
                { id: 'meal-salmon', label: 'Herb Salmon', dietaryTags: [] },
                { id: 'meal-kids', label: 'Kids Pasta', dietaryTags: [] },
              ],
            },
            memberRsvps: [
              {
                householdMemberId: 'm-1',
                status: 'declined',
                mealOptionId: null,
                dietaryNotes: null,
              },
              {
                householdMemberId: 'm-2',
                status: 'attending',
                mealOptionId: 'meal-salmon',
                dietaryNotes: null,
              },
              {
                householdMemberId: 'm-3',
                status: 'attending',
                mealOptionId: 'meal-kids',
                dietaryNotes: null,
              },
            ],
          },
        ],
      };

      const partyMembers = getInvitationPartyMembers(guest as any);
      expect(partyMembers).toHaveLength(2);
      expect(partyMembers[0]).toMatchObject({
        memberId: 'm-2',
        attendeeName: 'Marcus Rivera',
        explicitSeatNumber: 4,
        mealChoice: 'Herb Salmon',
        dietaryNotesText: 'Severe peanut allergy',
      });
      // Primary guest's "Vegetarian" note must NOT bleed onto Marcus's seat!
      expect(partyMembers[0]?.dietaryBadges.map((b) => b.shortLabel)).toEqual(['NF']);

      expect(partyMembers[1]).toMatchObject({
        memberId: 'm-3',
        attendeeName: 'Sofia Rivera',
        explicitSeatNumber: 5,
        mealChoice: 'Kids Pasta',
        dietaryNotesText: 'Dairy-free',
      });
      // Child member gets Dairy-Free + Kids badges on their own seat!
      expect(partyMembers[1]?.dietaryBadges.map((b) => b.shortLabel)).toEqual(
        expect.arrayContaining(['DF', 'KIDS'])
      );

      const detailedSeats = resolveDetailedSeatAssignments([guest as any], 8);
      expect(detailedSeats.get(4)).toMatchObject({
        memberId: 'm-2',
        displayName: 'Marcus Rivera',
        mealChoice: 'Herb Salmon',
      });
      expect(detailedSeats.get(5)).toMatchObject({
        memberId: 'm-3',
        displayName: 'Sofia Rivera',
        mealChoice: 'Kids Pasta',
      });

      const summary = computeTableMealCounts([guest as any]);
      expect(summary.totalAttendees).toBe(2);
      expect(summary.mealCounts).toEqual([
        { label: 'Herb Salmon', count: 1 },
        { label: 'Kids Pasta', count: 1 },
      ]);

      const tableDto = {
        id: 'table-1',
        name: 'Table 1',
        shape: 'round',
        capacity: 8,
        x: 100,
        y: 100,
        width: 120,
        height: 120,
        rotation: 0,
        invitationCodes: [guest as any],
      };

      // Verify PDF generators succeed with relational chair bindings
      const chartPdf = await generateSeatingChartPdf([tableDto as any], []);
      expect(chartPdf.byteLength).toBeGreaterThan(500);

      const cardsPdf = await generateAveryCardsPdf([tableDto as any], 'place-cards');
      expect(cardsPdf.byteLength).toBeGreaterThan(500);
    });
  });

  describe('Backup v2.0 Backward Compatibility & Relational Validation', () => {
    const baseAppConfig = {
      id: 'singleton',
      createdAt: '2026-11-25T00:00:00.000Z',
      updatedAt: '2026-11-25T00:00:00.000Z',
    };

    it('accepts legacy v2.0 backup archives without householdMember or subEventMemberRsvp keys', () => {
      const revived = reviveDates({
        version: '2.0',
        exportedAt: '2026-11-25T00:00:00.000Z',
        appConfig: [baseAppConfig],
        registryItem: [],
      });
      const parsed = DatabaseBackupSchema.safeParse(revived);
      expect(parsed.success).toBe(true);
    });

    it('validates relational householdMember and subEventMemberRsvp arrays when present', () => {
      const revived = reviveDates({
        version: '2.0',
        exportedAt: '2026-11-25T00:00:00.000Z',
        appConfig: [baseAppConfig],
        registryItem: [],
        invitationCode: [
          {
            id: 'inv-1',
            code: 'TEST26',
            guestName: 'Elena Rivera',
            createdAt: '2026-11-25T00:00:00.000Z',
            updatedAt: '2026-11-25T00:00:00.000Z',
          },
        ],
        householdMember: [
          {
            id: 'hm-1',
            invitationCodeId: 'inv-1',
            fullName: 'Elena Rivera',
            role: 'PRIMARY',
            displayOrder: 0,
            createdAt: '2026-11-25T00:00:00.000Z',
            updatedAt: '2026-11-25T00:00:00.000Z',
          },
        ],
        subEventRsvp: [
          {
            id: 'rsvp-1',
            subEventId: 'se-1',
            invitationCodeId: 'inv-1',
            status: 'attending',
          },
        ],
        subEventMemberRsvp: [
          {
            id: 'semr-1',
            subEventRsvpId: 'rsvp-1',
            householdMemberId: 'hm-1',
            status: 'attending',
            mealOptionId: 'meal-1',
          },
        ],
      });
      const parsed = DatabaseBackupSchema.safeParse(revived);
      expect(parsed.success).toBe(true);
    });
  });
});
