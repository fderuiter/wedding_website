import { SendBroadcastSchema } from '../schemas';
import { BroadcastService } from '../service';
import { prisma } from '@/lib/prisma';
import { GET as cronGET, POST as cronPOST } from '@/app/api/cron/broadcasts/route';
import { DELETE as scheduleDELETE } from '@/app/api/admin/broadcast/schedule/[id]/route';
import { NextRequest } from 'next/server';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    invitationCode: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    broadcastMessage: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
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
    emailProvider: 'none',
    broadcastBatchSize: 50,
    broadcastBatchDelayMs: 0,
  }),
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn().mockResolvedValue(true),
  checkAdminAuth: jest.fn().mockResolvedValue(true),
}));

describe('Scheduled Broadcast Dispatch Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('SendBroadcastSchema Validation', () => {
    it('validates payloads containing a future ISO-8601 scheduledFor timestamp', () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const payload = {
        channel: 'EMAIL',
        subject: 'Rehearsal Dinner Update',
        body: 'Reminder for rehearsal dinner',
        scheduledFor: futureDate,
      };

      const result = SendBroadcastSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scheduledFor).toBe(futureDate);
      }
    });

    it('rejects payloads with invalid scheduledFor date string', () => {
      const payload = {
        channel: 'EMAIL',
        subject: 'Test',
        body: 'Test body',
        scheduledFor: 'not-a-valid-date',
      };

      const result = SendBroadcastSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe('BroadcastService.sendBroadcast', () => {
    it('creates a record with SCHEDULED status and skips immediate dispatch when scheduledFor is in the future', async () => {
      const futureTime = new Date(Date.now() + 3600000).toISOString();

      (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue([
        { id: 'guest1', guestName: 'Alice', code: 'A1', email: 'alice@example.com' },
      ]);

      (prisma.broadcastMessage.create as jest.Mock).mockResolvedValue({
        id: 'msg1',
        channel: 'EMAIL',
        subject: 'Scheduled Reminder',
        body: 'Hi {{guestName}}',
        status: 'SCHEDULED',
        scheduledFor: new Date(futureTime),
        totalRecipients: 1,
        recipients: [],
      });

      const message = await BroadcastService.sendBroadcast({
        channel: 'EMAIL',
        subject: 'Scheduled Reminder',
        body: 'Hi {{guestName}}',
        scheduledFor: futureTime,
      });

      expect(message.status).toBe('SCHEDULED');
      expect(prisma.broadcastMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'SCHEDULED',
            scheduledFor: new Date(futureTime),
          }),
        })
      );
      // Ensure recipient creation was NOT called during schedule phase
      expect(prisma.broadcastRecipient.create).not.toHaveBeenCalled();
    });

    it('dispatches immediately when scheduledFor is not provided', async () => {
      (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue([
        { id: 'guest1', guestName: 'Alice', code: 'A1', email: 'alice@example.com' },
      ]);

      (prisma.broadcastMessage.create as jest.Mock).mockResolvedValue({
        id: 'msg2',
        channel: 'EMAIL',
        subject: 'Immediate Announcement',
        body: 'Hello {{guestName}}',
        status: 'SENDING',
      });

      (prisma.broadcastRecipient.create as jest.Mock).mockResolvedValue({
        id: 'rec1',
        broadcastId: 'msg2',
        destination: 'alice@example.com',
        status: 'PENDING',
      });

      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
        id: 'msg2',
        status: 'SENT',
        sentCount: 1,
        failedCount: 0,
      });

      const message = await BroadcastService.sendBroadcast({
        channel: 'EMAIL',
        subject: 'Immediate Announcement',
        body: 'Hello {{guestName}}',
      });

      expect(prisma.broadcastRecipient.create).toHaveBeenCalled();
      expect(prisma.broadcastMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'SENT',
          }),
        })
      );
    });
  });

  describe('BroadcastService.processScheduledBroadcasts', () => {
    it('processes due SCHEDULED broadcasts atomically and resolves dynamic recipients', async () => {
      const pastTime = new Date(Date.now() - 3600000);

      (prisma.broadcastMessage.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'msg-due-1',
          channel: 'EMAIL',
          subject: 'Due Announcement',
          body: 'Hi {{guestName}}',
          status: 'SCHEDULED',
          scheduledFor: pastTime,
          targetFilters: {},
        },
      ]);

      (prisma.broadcastMessage.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue([
        { id: 'guest1', guestName: 'Alice', code: 'A1', email: 'alice@example.com' },
      ]);

      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValue({
        id: 'msg-due-1',
        channel: 'EMAIL',
        subject: 'Due Announcement',
        body: 'Hi {{guestName}}',
        status: 'SENDING',
      });

      (prisma.broadcastRecipient.create as jest.Mock).mockResolvedValue({
        id: 'rec1',
        broadcastId: 'msg-due-1',
        destination: 'alice@example.com',
        status: 'PENDING',
      });

      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
        id: 'msg-due-1',
        status: 'SENT',
        sentCount: 1,
        failedCount: 0,
      });

      const processed = await BroadcastService.processScheduledBroadcasts();

      expect(prisma.broadcastMessage.updateMany).toHaveBeenCalledWith({
        where: { id: 'msg-due-1', status: 'SCHEDULED' },
        data: { status: 'SENDING' },
      });
      expect(processed).toHaveLength(1);
      expect(processed[0].status).toBe('SENT');
    });

    it('skips broadcast if atomic updateMany returns count 0 (concurrent worker lock)', async () => {
      (prisma.broadcastMessage.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'msg-locked',
          channel: 'EMAIL',
          subject: 'Locked',
          body: 'Body',
          status: 'SCHEDULED',
          scheduledFor: new Date(),
        },
      ]);

      (prisma.broadcastMessage.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      const processed = await BroadcastService.processScheduledBroadcasts();
      expect(processed).toHaveLength(0);
    });
  });

  describe('BroadcastService.cancelScheduledBroadcast', () => {
    it('cancels a pending SCHEDULED broadcast', async () => {
      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValue({
        id: 'msg-sched',
        status: 'SCHEDULED',
      });

      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
        id: 'msg-sched',
        status: 'CANCELLED',
      });

      const result = await BroadcastService.cancelScheduledBroadcast('msg-sched');
      expect(result.status).toBe('CANCELLED');
      expect(prisma.broadcastMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'msg-sched' },
          data: { status: 'CANCELLED' },
        })
      );
    });

    it('throws error if broadcast is not in SCHEDULED status', async () => {
      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValue({
        id: 'msg-sent',
        status: 'SENT',
      });

      await expect(
        BroadcastService.cancelScheduledBroadcast('msg-sent')
      ).rejects.toThrow('Only pending scheduled broadcasts can be cancelled.');
    });
  });

  describe('API Endpoint Requirements', () => {
    const originalSecret = process.env.CRON_SECRET;

    beforeEach(() => {
      process.env.CRON_SECRET = 'test-cron-secret-123';
    });

    afterAll(() => {
      process.env.CRON_SECRET = originalSecret;
    });

    it('GET /api/cron/broadcasts rejects unauthorized triggers without proper secret', async () => {
      const req = new NextRequest('http://localhost:3000/api/cron/broadcasts', {
        headers: { authorization: 'Bearer wrong-secret' },
      });

      const response = await cronGET(req);
      expect(response.status).toBe(401);
    });

    it('POST /api/cron/broadcasts processes due broadcasts with valid authorization header', async () => {
      (prisma.broadcastMessage.findMany as jest.Mock).mockResolvedValue([]);

      const req = new NextRequest('http://localhost:3000/api/cron/broadcasts', {
        method: 'POST',
        headers: { authorization: 'Bearer test-cron-secret-123' },
      });

      const response = await cronPOST(req);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.processedCount).toBe(0);
    });

    it('DELETE /api/admin/broadcast/schedule/[id] cancels a scheduled broadcast', async () => {
      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValue({
        id: 'sched-1',
        status: 'SCHEDULED',
      });

      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
        id: 'sched-1',
        status: 'CANCELLED',
      });

      const req = new NextRequest('http://localhost:3000/api/admin/broadcast/schedule/sched-1', {
        method: 'DELETE',
      });

      const response = await scheduleDELETE(req, {
        params: Promise.resolve({ id: 'sched-1' }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      const cancelledMsg = json.data || json;
      expect(cancelledMsg.status).toBe('CANCELLED');
    });
  });
});
