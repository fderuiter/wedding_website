import { prisma } from '@/lib/prisma';
import { BroadcastService } from '../service';

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
    });
  });

  describe('sendTestBroadcast', () => {
    it('dispatches test email with [TEST] prefix and sample placeholders without touching guest records or DB tables', async () => {
      const { getAppConfig } = require('@/lib/config');
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
      const { getAppConfig } = require('@/lib/config');
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
      const { MultiChannelMessagingProvider } = require('../providers');
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
});
