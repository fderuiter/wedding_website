import { prisma } from '@/lib/prisma';
import { getAppConfig } from '@/lib/config';
import { BroadcastService } from '../service';
import { MultiChannelMessagingProvider } from '../providers';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    invitationCode: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    broadcastMessage: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    broadcastRecipient: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    weddingDate: new Date('2026-10-25'),
    venueName: 'Grand Hall',
    emailProvider: 'smtp',
    broadcastBatchSize: 50,
    broadcastBatchDelayMs: 0,
  }),
}));

describe('BroadcastService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('resolveTargetGuests', () => {
    it('queries invitation codes with selectedIds filter', async () => {
      (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue([
        { id: '1', guestName: 'Alice' },
      ]);

      const res = await BroadcastService.resolveTargetGuests({ selectedIds: ['1'] });
      expect(prisma.invitationCode.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['1'] } },
      });
      expect(res).toHaveLength(1);
    });

    it('queries invitation codes with partyTags filter', async () => {
      (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue([
        { id: '2', guestName: 'Bob', partyTags: ['VIP'] },
      ]);

      await BroadcastService.resolveTargetGuests({ partyTags: ['VIP'] });
      expect(prisma.invitationCode.findMany).toHaveBeenCalledWith({
        where: { partyTags: { hasSome: ['VIP'] } },
      });
    });

    describe('attendance status filtering via domain utility', () => {
      const mockGuestList = [
        // Attending guests
        { id: 'g1', guestName: 'Alice Attending', used: true, extraFields: null },
        { id: 'g2', guestName: 'Bob Confirmed', used: false, extraFields: { attendanceStatus: 'attending' } },
        { id: 'g3', guestName: 'Charlie Yes', used: true, extraFields: { rsvpStatus: 'yes' } },
        // Declined guests
        { id: 'g4', guestName: 'David Declined', used: false, extraFields: { attendanceStatus: 'declined' } },
        { id: 'g5', guestName: 'Eve No', used: false, extraFields: { rsvp: 'no' } },
        { id: 'g6', guestName: 'Frank Rejected', used: true, extraFields: { attendanceStatus: false } },
        // Pending guests
        { id: 'g7', guestName: 'Grace Pending Unused', used: false, extraFields: null },
        { id: 'g8', guestName: 'Heidi Explicit Pending', used: false, extraFields: { status: 'pending' } },
      ];

      beforeEach(() => {
        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(mockGuestList);
      });

      it('excludes declined and attending guests when filtering by pending status', async () => {
        const res = await BroadcastService.resolveTargetGuests({ attendanceStatus: 'pending' });

        expect(prisma.invitationCode.findMany).toHaveBeenCalledWith({ where: {} });
        const ids = res.map((g) => g.id);
        expect(ids).toEqual(['g7', 'g8']);
        expect(res.every((g) => ['Grace Pending Unused', 'Heidi Explicit Pending'].includes(g.guestName))).toBe(true);
        // Explicitly verify zero declined guests are returned
        expect(res.some((g) => ['David Declined', 'Eve No', 'Frank Rejected'].includes(g.guestName))).toBe(false);
      });

      it('excludes pending and attending guests when filtering by declined status', async () => {
        const res = await BroadcastService.resolveTargetGuests({ attendanceStatus: 'declined' });

        const ids = res.map((g) => g.id);
        expect(ids).toEqual(['g4', 'g5', 'g6']);
        expect(res.every((g) => ['David Declined', 'Eve No', 'Frank Rejected'].includes(g.guestName))).toBe(true);
        // Explicitly verify zero pending guests are returned
        expect(res.some((g) => ['Grace Pending Unused', 'Heidi Explicit Pending'].includes(g.guestName))).toBe(false);
      });

      it('returns attending guests when filtering by attending status', async () => {
        const res = await BroadcastService.resolveTargetGuests({ attendanceStatus: 'attending' });

        const ids = res.map((g) => g.id);
        expect(ids).toEqual(['g1', 'g2', 'g3']);
        expect(res.every((g) => ['Alice Attending', 'Bob Confirmed', 'Charlie Yes'].includes(g.guestName))).toBe(true);
        expect(res.some((g) => ['David Declined', 'Grace Pending Unused'].includes(g.guestName))).toBe(false);
      });

      it('returns all guests without attendance filtering when attendanceStatus is all', async () => {
        const res = await BroadcastService.resolveTargetGuests({ attendanceStatus: 'all' });
        expect(res).toHaveLength(mockGuestList.length);
      });

      it('returns all guests when filters is undefined', async () => {
        const res = await BroadcastService.resolveTargetGuests();
        expect(res).toHaveLength(mockGuestList.length);
      });

      it('filters attendance within selectedIds when both are supplied', async () => {
        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue([
          { id: 'g4', guestName: 'David Declined', used: false, extraFields: { attendanceStatus: 'declined' } },
          { id: 'g7', guestName: 'Grace Pending Unused', used: false, extraFields: null },
        ]);

        const res = await BroadcastService.resolveTargetGuests({
          selectedIds: ['g4', 'g7'],
          attendanceStatus: 'pending',
        });

        expect(prisma.invitationCode.findMany).toHaveBeenCalledWith({
          where: { id: { in: ['g4', 'g7'] } },
        });
        expect(res).toHaveLength(1);
        expect(res[0].id).toBe('g7');
      });

      it('partitions 200 wedding guests in under 10 milliseconds', async () => {
        const largeGuestList = Array.from({ length: 200 }, (_, i) => {
          if (i % 3 === 0) {
            return { id: `id-${i}`, guestName: `Guest ${i}`, used: true, extraFields: null };
          }
          if (i % 3 === 1) {
            return { id: `id-${i}`, guestName: `Guest ${i}`, used: false, extraFields: { attendanceStatus: 'declined' } };
          }
          return { id: `id-${i}`, guestName: `Guest ${i}`, used: false, extraFields: null };
        });

        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(largeGuestList);

        const start = performance.now();
        const pending = await BroadcastService.resolveTargetGuests({ attendanceStatus: 'pending' });
        const declined = await BroadcastService.resolveTargetGuests({ attendanceStatus: 'declined' });
        const attending = await BroadcastService.resolveTargetGuests({ attendanceStatus: 'attending' });
        const elapsed = performance.now() - start;

        expect(pending.length + declined.length + attending.length).toBe(200);
        expect(elapsed).toBeLessThan(10);
      });
    });
  });

  describe('renderPreview', () => {
    it('renders preview with sample guest details', async () => {
      (prisma.invitationCode.findUnique as jest.Mock).mockResolvedValue({
        id: '1',
        guestName: 'Charlie',
        code: 'CHARLIE2026',
        householdName: 'Charlie Family',
        email: 'charlie@example.com',
      });

      const preview = await BroadcastService.renderPreview({
        channel: 'EMAIL',
        subject: 'Hello {{guestName}}',
        body: 'Welcome to {{venueName}}, {{guestName}}! Your code is {{code}}.',
        sampleGuestId: '1',
      });

      expect(preview.subject).toBe('Hello Charlie');
      expect(preview.body).toBe('Welcome to Grand Hall, Charlie! Your code is CHARLIE2026.');
      expect(preview.destination).toBe('charlie@example.com');
    });

    it('displays sample recipient data matching the selected attendance status filter', async () => {
      (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue([
        // g1 is declined, g2 is pending
        { id: 'g1', guestName: 'Declined Guest', code: 'DEC1', email: 'dec@example.com', used: false, extraFields: { attendanceStatus: 'declined' } },
        { id: 'g2', guestName: 'Pending Guest', code: 'PEN1', email: 'pen@example.com', used: false, extraFields: null },
      ]);

      const preview = await BroadcastService.renderPreview({
        channel: 'EMAIL',
        subject: 'Reminder for {{guestName}}',
        body: 'Please RSVP {{guestName}} using {{code}}!',
        targetFilters: { attendanceStatus: 'pending' },
      });

      expect(preview.sampleGuestName).toBe('Pending Guest');
      expect(preview.subject).toBe('Reminder for Pending Guest');
      expect(preview.body).toContain('Pending Guest using PEN1');
      expect(preview.destination).toBe('pen@example.com');
    });
  });

  describe('sendBroadcast', () => {
    it('creates message, creates recipients, dispatches, and returns updated broadcast', async () => {
      const mockGuests = [
        { id: 'g1', guestName: 'David', code: 'D123', email: 'david@example.com', householdName: 'David HH' },
      ];
      (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(mockGuests);
      (prisma.broadcastMessage.create as jest.Mock).mockResolvedValue({
        id: 'bm1',
        status: 'SENDING',
      });
      (prisma.broadcastRecipient.create as jest.Mock).mockResolvedValue({
        id: 'br1',
        broadcastId: 'bm1',
        destination: 'david@example.com',
        status: 'PENDING',
      });
      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
        id: 'bm1',
        status: 'SENT',
        sentCount: 1,
        failedCount: 0,
      });

      const result = await BroadcastService.sendBroadcast({
        channel: 'EMAIL',
        subject: 'Subject for {{guestName}}',
        body: 'Body for {{guestName}}',
        targetFilters: { selectedIds: ['g1'] },
      });

      expect(prisma.broadcastMessage.create).toHaveBeenCalled();
      expect(prisma.broadcastRecipient.create).toHaveBeenCalled();
      expect(result.status).toBe('SENT');
      expect(result.sentCount).toBe(1);
    });

    describe('transactional bulk recipient insertion and chunking', () => {
      beforeEach(() => {
        (prisma as any).$transaction = jest.fn(async (cb: any) => cb(prisma));
        (prisma.broadcastRecipient as any).createMany = jest.fn().mockResolvedValue({ count: 0 });
      });

      afterEach(() => {
        delete (prisma as any).$transaction;
        delete (prisma.broadcastRecipient as any).createMany;
      });

      it('persists 150 recipient records in a single database round trip using createMany in a transaction', async () => {
        const guests = Array.from({ length: 150 }, (_, i) => ({
          id: `guest-${i}`,
          guestName: `Guest ${i}`,
          code: `CODE${i}`,
          email: `guest${i}@example.com`,
          householdName: `Household ${i}`,
        }));

        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(guests);
        (prisma.broadcastMessage.create as jest.Mock).mockResolvedValue({
          id: 'bm-bulk-150',
          status: 'SENDING',
        });
        (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
          id: 'bm-bulk-150',
          status: 'SENT',
          sentCount: 150,
          failedCount: 0,
        });

        const start = Date.now();
        const result = await BroadcastService.sendBroadcast({
          channel: 'EMAIL',
          subject: 'Big announcement',
          body: 'Hello everyone!',
        });
        const duration = Date.now() - start;

        // Metric 2: Recipient record insertion completes quickly
        expect(duration).toBeLessThan(1000);

        // Criterion 1: persists 150 recipient records in a single database round trip (1 createMany call)
        expect((prisma as any).$transaction).toHaveBeenCalledTimes(1);
        expect((prisma.broadcastRecipient as any).createMany).toHaveBeenCalledTimes(1);

        const createManyArg = (prisma.broadcastRecipient as any).createMany.mock.calls[0][0];
        expect(createManyArg.data).toHaveLength(150);
        expect(createManyArg.data[0]).toEqual(
          expect.objectContaining({
            broadcastId: 'bm-bulk-150',
            invitationCodeId: 'guest-0',
            guestName: 'Guest 0',
            destination: 'guest0@example.com',
            status: 'PENDING',
            error: null,
          })
        );
        expect(createManyArg.data[0].id).toBeDefined();
        expect(typeof createManyArg.data[0].id).toBe('string');

        // All IDs must be unique
        const ids = new Set(createManyArg.data.map((r: any) => r.id));
        expect(ids.size).toBe(150);
      });

      it('executes at most two database queries to persist up to 200 recipient records', async () => {
        const guests = Array.from({ length: 200 }, (_, i) => ({
          id: `guest-200-${i}`,
          guestName: `Guest ${i}`,
          code: `CODE${i}`,
          email: `guest${i}@example.com`,
        }));

        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(guests);
        (prisma.broadcastMessage.create as jest.Mock).mockResolvedValue({
          id: 'bm-bulk-200',
          status: 'SENDING',
        });
        (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
          id: 'bm-bulk-200',
          status: 'SENT',
          sentCount: 200,
          failedCount: 0,
        });

        await BroadcastService.sendBroadcast({
          channel: 'EMAIL',
          subject: '200 Guests',
          body: 'Hello!',
        });

        // Metric 1: At most two queries for up to 200 recipients (here 1 query with chunk size 250)
        expect((prisma.broadcastRecipient as any).createMany.mock.calls.length).toBeLessThanOrEqual(2);
      });

      it('chunks large recipient lists into fixed blocks under 500 records to respect parameter limits', async () => {
        const guests = Array.from({ length: 600 }, (_, i) => ({
          id: `guest-600-${i}`,
          guestName: `Guest ${i}`,
          code: `CODE${i}`,
          email: `guest${i}@example.com`,
        }));

        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(guests);
        (prisma.broadcastMessage.create as jest.Mock).mockResolvedValue({
          id: 'bm-bulk-600',
          status: 'SENDING',
        });
        (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
          id: 'bm-bulk-600',
          status: 'SENT',
          sentCount: 600,
          failedCount: 0,
        });

        await BroadcastService.sendBroadcast({
          channel: 'EMAIL',
          subject: '600 Guests',
          body: 'Hello!',
        });

        expect((prisma as any).$transaction).toHaveBeenCalledTimes(1);
        // With chunk size 250, 600 records requires 3 chunks (250, 250, 100)
        expect((prisma.broadcastRecipient as any).createMany).toHaveBeenCalledTimes(3);

        const chunk1 = (prisma.broadcastRecipient as any).createMany.mock.calls[0][0].data;
        const chunk2 = (prisma.broadcastRecipient as any).createMany.mock.calls[1][0].data;
        const chunk3 = (prisma.broadcastRecipient as any).createMany.mock.calls[2][0].data;

        expect(chunk1.length).toBe(250);
        expect(chunk2.length).toBe(250);
        expect(chunk3.length).toBe(100);

        // Constraint: each chunk must be under 500 records
        expect(chunk1.length).toBeLessThan(500);
        expect(chunk2.length).toBeLessThan(500);
        expect(chunk3.length).toBeLessThan(500);
      });

      it('preserves individual recipient tracking identifiers for all downstream dispatches', async () => {
        const guests = [
          { id: 'g1', guestName: 'Alice', code: 'A1', email: 'alice@example.com' },
          { id: 'g2', guestName: 'Bob', code: 'B2', email: 'bob@example.com' },
        ];

        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(guests);
        (prisma.broadcastMessage.create as jest.Mock).mockResolvedValue({
          id: 'bm-tracking',
          status: 'SENDING',
        });
        (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
          id: 'bm-tracking',
          status: 'SENT',
          sentCount: 2,
          failedCount: 0,
        });

        await BroadcastService.sendBroadcast({
          channel: 'EMAIL',
          subject: 'Tracking Test',
          body: 'Hello!',
        });

        const createdRecipients = (prisma.broadcastRecipient as any).createMany.mock.calls[0][0].data;
        expect(createdRecipients).toHaveLength(2);
        const [r1, r2] = createdRecipients;

        // Verify downstream updates used the exact assigned recipient IDs
        expect(prisma.broadcastRecipient.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: r1.id },
            data: expect.objectContaining({ status: 'SENT' }),
          })
        );
        expect(prisma.broadcastRecipient.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: r2.id },
            data: expect.objectContaining({ status: 'SENT' }),
          })
        );
      });

      it('marks dispatches with invalid contact details as FAILED without interrupting the bulk insert', async () => {
        const guests = [
          { id: 'g-valid', guestName: 'Valid Guest', code: 'V1', email: 'valid@example.com' },
          { id: 'g-invalid-1', guestName: 'No Email Guest', code: 'INV1', email: '' },
          { id: 'g-invalid-2', guestName: 'Undefined Email Guest', code: 'INV2', email: undefined },
        ];

        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(guests);
        (prisma.broadcastMessage.create as jest.Mock).mockResolvedValue({
          id: 'bm-invalid',
          status: 'SENDING',
        });
        (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
          id: 'bm-invalid',
          status: 'PARTIALLY_SENT',
          sentCount: 1,
          failedCount: 2,
        });

        await BroadcastService.sendBroadcast({
          channel: 'EMAIL',
          subject: 'Invalid Contact Test',
          body: 'Hello!',
        });

        // 1 single bulk insert with all 3 recipients
        expect((prisma.broadcastRecipient as any).createMany).toHaveBeenCalledTimes(1);
        const insertedData = (prisma.broadcastRecipient as any).createMany.mock.calls[0][0].data;
        expect(insertedData).toHaveLength(3);

        const validItem = insertedData.find((r: any) => r.guestName === 'Valid Guest');
        expect(validItem.status).toBe('PENDING');
        expect(validItem.error).toBeNull();
        expect(validItem.destination).toBe('valid@example.com');

        const invalidItem1 = insertedData.find((r: any) => r.guestName === 'No Email Guest');
        expect(invalidItem1.status).toBe('FAILED');
        expect(invalidItem1.error).toBe('Missing email address');
        expect(invalidItem1.destination).toBe('Missing Contact Info');

        const invalidItem2 = insertedData.find((r: any) => r.guestName === 'Undefined Email Guest');
        expect(invalidItem2.status).toBe('FAILED');
        expect(invalidItem2.error).toBe('Missing email address');
        expect(invalidItem2.destination).toBe('Missing Contact Info');

        // Only valid recipient dispatched
        expect(prisma.broadcastRecipient.update).toHaveBeenCalledTimes(1);
        expect(prisma.broadcastRecipient.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: validItem.id },
            data: expect.objectContaining({ status: 'SENT' }),
          })
        );
      });

      it('aborts and propagates error if transactional bulk insert fails', async () => {
        const guests = [{ id: 'g1', guestName: 'Alice', code: 'A1', email: 'alice@example.com' }];

        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(guests);
        (prisma.broadcastMessage.create as jest.Mock).mockResolvedValue({
          id: 'bm-fail',
          status: 'SENDING',
        });
        (prisma as any).$transaction = jest.fn().mockRejectedValue(new Error('Transaction deadlock'));

        await expect(
          BroadcastService.sendBroadcast({
            channel: 'EMAIL',
            subject: 'Fail Test',
            body: 'Hello!',
          })
        ).rejects.toThrow('Transaction deadlock');
      });

      it('dispatches SMS broadcast to guests using phone numbers stored in extraFields', async () => {
        const guests = [
          {
            id: 'g-sms-1',
            guestName: 'Phone Guest',
            code: 'SMS1',
            extraFields: { phone: '+15551234567', mobile: '+15551234567' },
          },
          {
            id: 'g-sms-2',
            guestName: 'Serialized Phone Guest',
            code: 'SMS2',
            extraFields: JSON.stringify({ phone: '+15559876543', mobile: '+15559876543' }),
          },
          {
            id: 'g-sms-3',
            guestName: 'Missing Phone Guest',
            code: 'SMS3',
            extraFields: null,
          },
        ];

        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(guests);
        (prisma.broadcastMessage.create as jest.Mock).mockResolvedValue({
          id: 'bm-sms-test',
          status: 'SENDING',
        });
        (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
          id: 'bm-sms-test',
          status: 'PARTIALLY_SENT',
          sentCount: 2,
          failedCount: 1,
        });

        await BroadcastService.sendBroadcast({
          channel: 'SMS',
          body: 'Wedding update for {{guestName}}!',
        });

        expect((prisma.broadcastRecipient as any).createMany).toHaveBeenCalledTimes(1);
        const insertedData = (prisma.broadcastRecipient as any).createMany.mock.calls[0][0].data;
        expect(insertedData).toHaveLength(3);

        const guest1 = insertedData.find((r: any) => r.guestName === 'Phone Guest');
        expect(guest1.status).toBe('PENDING');
        expect(guest1.error).toBeNull();
        expect(guest1.destination).toBe('+15551234567');

        const guest2 = insertedData.find((r: any) => r.guestName === 'Serialized Phone Guest');
        expect(guest2.status).toBe('PENDING');
        expect(guest2.error).toBeNull();
        expect(guest2.destination).toBe('+15559876543');

        const guest3 = insertedData.find((r: any) => r.guestName === 'Missing Phone Guest');
        expect(guest3.status).toBe('FAILED');
        expect(guest3.error).toBe('Missing phone number');
        expect(guest3.destination).toBe('Missing Contact Info');

        // Verify valid recipients were updated to SENT
        expect(prisma.broadcastRecipient.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: guest1.id },
            data: expect.objectContaining({ status: 'SENT' }),
          })
        );
        expect(prisma.broadcastRecipient.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: guest2.id },
            data: expect.objectContaining({ status: 'SENT' }),
          })
        );
      });
    });
  });

  describe('sendTestBroadcast', () => {
    it('dispatches test email with [TEST] prefix and sample placeholders without touching guest records or DB tables', async () => {
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        contactEmail: 'host@example.com',
        weddingDate: new Date('2026-10-25'),
        venueName: 'Grand Hall',
        emailProvider: 'smtp',
      });

      const res = await BroadcastService.sendTestBroadcast({
        channel: 'EMAIL',
        subject: 'Reminder for {{guestName}}',
        body: 'Welcome to {{venueName}}, {{guestName}}! Your code is {{code}}.',
      });

      expect(res.success).toBe(true);
      expect(res.destination).toBe('host@example.com');
      expect(res.subject).toBe('[TEST] Reminder for Jane Doe');
      expect(res.body).toContain('Welcome to Grand Hall, Jane Doe! Your code is SAMPLE2026.');

      // Guardrail: must NEVER read guest records or insert broadcast records
      expect(prisma.invitationCode.findMany).not.toHaveBeenCalled();
      expect(prisma.invitationCode.findUnique).not.toHaveBeenCalled();
      expect(prisma.broadcastMessage.create).not.toHaveBeenCalled();
      expect(prisma.broadcastRecipient.create).not.toHaveBeenCalled();
    });

    it('does not duplicate [TEST] prefix if subject already has it', async () => {
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        contactEmail: 'host@example.com',
      });

      const res = await BroadcastService.sendTestBroadcast({
        channel: 'EMAIL',
        subject: '[TEST] Already prefixed subject',
        body: 'Test body',
      });

      expect(res.subject).toBe('[TEST] Already prefixed subject');
    });

    it('supports custom override destination for test dispatch', async () => {
      const res = await BroadcastService.sendTestBroadcast({
        channel: 'EMAIL',
        subject: 'Custom test',
        body: 'Testing override',
        destination: 'assistant@example.com',
      });

      expect(res.destination).toBe('assistant@example.com');
      expect(prisma.invitationCode.findMany).not.toHaveBeenCalled();
    });

    it('supports SMS test dispatch to E.164 phone number', async () => {
      const res = await BroadcastService.sendTestBroadcast({
        channel: 'SMS',
        body: 'Hello {{guestName}}, wedding test SMS!',
        destination: '+15551234567',
      });

      expect(res.success).toBe(true);
      expect(res.destination).toBe('+15551234567');
      expect(res.body).toContain('Hello Jane Doe, wedding test SMS!');
      expect(res.subject).toBeUndefined();
    });

    it('rejects invalid email destination', async () => {
      await expect(
        BroadcastService.sendTestBroadcast({
          channel: 'EMAIL',
          subject: 'Test',
          body: 'Test',
          destination: 'not-an-email',
        })
      ).rejects.toThrow('Invalid email address format for test destination.');
    });

    it('rejects non-E.164 phone destination', async () => {
      await expect(
        BroadcastService.sendTestBroadcast({
          channel: 'SMS',
          body: 'Test',
          destination: '555-1234',
        })
      ).rejects.toThrow('Invalid phone number format. Must be in E.164 format');
    });

    it('throws error when provider dispatch fails', async () => {
      const spy = jest.spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail').mockResolvedValueOnce({
        success: false,
        error: 'Resend API Key is missing in settings',
      });

      await expect(
        BroadcastService.sendTestBroadcast({
          channel: 'EMAIL',
          subject: 'Fail test',
          body: 'Fail body',
          destination: 'host@example.com',
        })
      ).rejects.toThrow('Resend API Key is missing in settings');

      spy.mockRestore();
    });
  });

  describe('retryFailedRecipients', () => {
    it('returns broadcast immediately without dispatch or recounting when failed recipients list is empty', async () => {
      const broadcast = {
        id: 'b-empty',
        channel: 'EMAIL',
        body: 'Hello',
        recipients: [
          { id: 'r1', status: 'SENT', destination: 'r1@example.com' },
        ],
      };
      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValue(broadcast);

      const res = await BroadcastService.retryFailedRecipients('b-empty');
      expect(res).toBe(broadcast);
      expect(prisma.broadcastRecipient.updateMany).not.toHaveBeenCalled();
      expect(prisma.broadcastRecipient.update).not.toHaveBeenCalled();
      expect(prisma.broadcastRecipient.count).not.toHaveBeenCalled();
      expect(prisma.broadcastMessage.update).not.toHaveBeenCalled();
    });

    it('throws error when broadcast is not found', async () => {
      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        BroadcastService.retryFailedRecipients('nonexistent-id')
      ).rejects.toThrow('Broadcast message not found.');
    });

    it('dispatches failed recipients in bounded concurrent batches according to broadcastBatchSize', async () => {
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        weddingDate: new Date('2026-10-25'),
        venueName: 'Grand Hall',
        emailProvider: 'smtp',
        broadcastBatchSize: 2,
        broadcastBatchDelayMs: 0,
      });

      const recipients = Array.from({ length: 5 }, (_, i) => ({
        id: `r-${i}`,
        guestName: `Guest ${i}`,
        destination: `guest${i}@example.com`,
        status: 'FAILED',
        invitationCode: null,
      }));

      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValue({
        id: 'b-batch',
        channel: 'EMAIL',
        body: 'Hello {{guestName}}',
        recipients,
      });

      const sendEmailSpy = jest.spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail').mockResolvedValue({ success: true });

      (prisma.broadcastRecipient.updateMany as jest.Mock).mockResolvedValue({ count: 2 });
      (prisma.broadcastRecipient.count as jest.Mock)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(0);
      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
        id: 'b-batch',
        status: 'SENT',
        sentCount: 5,
        failedCount: 0,
        recipients,
      });

      const res = await BroadcastService.retryFailedRecipients('b-batch');

      expect(sendEmailSpy).toHaveBeenCalledTimes(5);
      expect(prisma.broadcastRecipient.updateMany).toHaveBeenCalledTimes(3);
      expect(prisma.broadcastRecipient.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: { in: ['r-0', 'r-1'] } },
        data: {
          status: 'SENT',
          error: null,
          sentAt: expect.any(Date),
        },
      });
      expect(prisma.broadcastRecipient.updateMany).toHaveBeenNthCalledWith(2, {
        where: { id: { in: ['r-2', 'r-3'] } },
        data: {
          status: 'SENT',
          error: null,
          sentAt: expect.any(Date),
        },
      });
      expect(prisma.broadcastRecipient.updateMany).toHaveBeenNthCalledWith(3, {
        where: { id: { in: ['r-4'] } },
        data: {
          status: 'SENT',
          error: null,
          sentAt: expect.any(Date),
        },
      });

      expect(res.status).toBe('SENT');
      sendEmailSpy.mockRestore();
    });

    it('applies configured rate limit delay between successive batches', async () => {
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        weddingDate: new Date('2026-10-25'),
        venueName: 'Grand Hall',
        emailProvider: 'smtp',
        broadcastBatchSize: 2,
        broadcastBatchDelayMs: 20,
      });

      const recipients = [
        { id: 'r-0', guestName: 'G0', destination: 'g0@example.com', status: 'FAILED' },
        { id: 'r-1', guestName: 'G1', destination: 'g1@example.com', status: 'FAILED' },
        { id: 'r-2', guestName: 'G2', destination: 'g2@example.com', status: 'FAILED' },
      ];

      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValue({
        id: 'b-delay',
        channel: 'EMAIL',
        body: 'Hello {{guestName}}',
        recipients,
      });

      const sendEmailSpy = jest.spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail').mockResolvedValue({ success: true });
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      (prisma.broadcastRecipient.updateMany as jest.Mock).mockResolvedValue({ count: 2 });
      (prisma.broadcastRecipient.count as jest.Mock).mockResolvedValue(0);
      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({ id: 'b-delay' });

      await BroadcastService.retryFailedRecipients('b-delay');

      expect(sendEmailSpy).toHaveBeenCalledTimes(3);
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 20);

      setTimeoutSpy.mockRestore();
      sendEmailSpy.mockRestore();
    });

    it('persists successful dispatches via updateMany and writes failed errors concurrently', async () => {
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        weddingDate: new Date('2026-10-25'),
        venueName: 'Grand Hall',
        emailProvider: 'smtp',
        broadcastBatchSize: 10,
        broadcastBatchDelayMs: 0,
      });

      const recipients = [
        { id: 'r-ok-1', guestName: 'Alice', destination: 'alice@example.com', status: 'FAILED' },
        { id: 'r-fail-1', guestName: 'Bob', destination: 'bob@example.com', status: 'FAILED' },
        { id: 'r-ok-2', guestName: 'Carol', destination: 'carol@example.com', status: 'FAILED' },
      ];

      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValue({
        id: 'b-mixed',
        channel: 'EMAIL',
        body: 'Hello {{guestName}}',
        recipients,
      });

      const sendEmailSpy = jest.spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail').mockImplementation(async (opts: { to?: string }) => {
        if (opts.to === 'bob@example.com') {
          return { success: false, error: 'Mailbox full' };
        }
        return { success: true };
      });

      (prisma.broadcastRecipient.updateMany as jest.Mock).mockResolvedValue({ count: 2 });
      (prisma.broadcastRecipient.update as jest.Mock).mockResolvedValue({ id: 'r-fail-1' });
      (prisma.broadcastRecipient.count as jest.Mock)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1);
      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
        id: 'b-mixed',
        status: 'PARTIALLY_SENT',
        sentCount: 2,
        failedCount: 1,
      });

      const res = await BroadcastService.retryFailedRecipients('b-mixed');

      expect(prisma.broadcastRecipient.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['r-ok-1', 'r-ok-2'] } },
        data: {
          status: 'SENT',
          error: null,
          sentAt: expect.any(Date),
        },
      });

      expect(prisma.broadcastRecipient.update).toHaveBeenCalledWith({
        where: { id: 'r-fail-1' },
        data: {
          status: 'FAILED',
          error: 'Mailbox full',
        },
      });

      expect(prisma.broadcastRecipient.findMany).not.toHaveBeenCalled();
      expect(prisma.broadcastRecipient.count).toHaveBeenCalledWith({
        where: { broadcastId: 'b-mixed', status: 'SENT' },
      });
      expect(prisma.broadcastRecipient.count).toHaveBeenCalledWith({
        where: { broadcastId: 'b-mixed', status: 'FAILED' },
      });

      expect(prisma.broadcastMessage.update).toHaveBeenCalledWith({
        where: { id: 'b-mixed' },
        data: {
          status: 'PARTIALLY_SENT',
          sentCount: 2,
          failedCount: 1,
        },
        include: {
          recipients: true,
        },
      });

      expect(res.status).toBe('PARTIALLY_SENT');
      sendEmailSpy.mockRestore();
    });

    it('sets status to FAILED when all retried dispatches fail', async () => {
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        weddingDate: new Date('2026-10-25'),
        venueName: 'Grand Hall',
        emailProvider: 'smtp',
        broadcastBatchSize: 10,
        broadcastBatchDelayMs: 0,
      });

      const recipients = [
        { id: 'r-fail-1', guestName: 'Alice', destination: 'alice@example.com', status: 'FAILED' },
        { id: 'r-fail-2', guestName: 'Bob', destination: 'bob@example.com', status: 'FAILED' },
      ];

      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValue({
        id: 'b-all-fail',
        channel: 'EMAIL',
        body: 'Hello {{guestName}}',
        recipients,
      });

      const sendEmailSpy = jest.spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail').mockResolvedValue({
        success: false,
        error: 'SMTP timeout',
      });

      (prisma.broadcastRecipient.update as jest.Mock).mockResolvedValue({ id: 'r-fail-1' });
      (prisma.broadcastRecipient.count as jest.Mock)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(2);
      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
        id: 'b-all-fail',
        status: 'FAILED',
        sentCount: 0,
        failedCount: 2,
      });

      const res = await BroadcastService.retryFailedRecipients('b-all-fail');

      expect(prisma.broadcastRecipient.updateMany).not.toHaveBeenCalled();
      expect(prisma.broadcastRecipient.update).toHaveBeenCalledTimes(2);
      expect(prisma.broadcastMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED', sentCount: 0, failedCount: 2 }),
        })
      );
      expect(res.status).toBe('FAILED');
      sendEmailSpy.mockRestore();
    });

    it('filters retries by recipientIds when specified', async () => {
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        weddingDate: new Date('2026-10-25'),
        venueName: 'Grand Hall',
        emailProvider: 'smtp',
        broadcastBatchSize: 10,
        broadcastBatchDelayMs: 0,
      });

      const recipients = [
        { id: 'r-1', guestName: 'Alice', destination: 'alice@example.com', status: 'FAILED' },
        { id: 'r-2', guestName: 'Bob', destination: 'bob@example.com', status: 'FAILED' },
      ];

      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValue({
        id: 'b-filtered',
        channel: 'EMAIL',
        body: 'Hello {{guestName}}',
        recipients,
      });

      const sendEmailSpy = jest.spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail').mockResolvedValue({ success: true });

      (prisma.broadcastRecipient.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.broadcastRecipient.count as jest.Mock)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1);
      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
        id: 'b-filtered',
        status: 'PARTIALLY_SENT',
        sentCount: 1,
        failedCount: 1,
      });

      await BroadcastService.retryFailedRecipients('b-filtered', ['r-1']);

      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
      expect(prisma.broadcastRecipient.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['r-1'] } },
        data: expect.objectContaining({ status: 'SENT' }),
      });

      sendEmailSpy.mockRestore();
    });

    it('dispatches SMS channel retries via sendSms', async () => {
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        weddingDate: new Date('2026-10-25'),
        venueName: 'Grand Hall',
        smsProvider: 'twilio',
        broadcastBatchSize: 10,
        broadcastBatchDelayMs: 0,
      });

      const recipients = [
        { id: 'r-sms-1', guestName: 'Alice', destination: '+15551234567', status: 'FAILED' },
      ];

      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValue({
        id: 'b-sms',
        channel: 'SMS',
        body: 'SMS Alert for {{guestName}}',
        recipients,
      });

      const sendSmsSpy = jest.spyOn(MultiChannelMessagingProvider.prototype, 'sendSms').mockResolvedValue({ success: true });

      (prisma.broadcastRecipient.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.broadcastRecipient.count as jest.Mock)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);
      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
        id: 'b-sms',
        status: 'SENT',
        sentCount: 1,
        failedCount: 0,
      });

      await BroadcastService.retryFailedRecipients('b-sms');

      expect(sendSmsSpy).toHaveBeenCalledWith({
        to: '+15551234567',
        body: 'SMS Alert for Alice',
      });

      sendSmsSpy.mockRestore();
    });
  });
});
