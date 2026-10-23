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
});
