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
