/** @jest-environment node */

import { POST as sendRoute } from '../send/route';
import { POST as previewRoute } from '../preview/route';
import { GET as historyRoute } from '../history/route';
import { GET as detailRoute } from '../[id]/route';
import { POST as retryRoute } from '../retry/route';
import { POST as testConnRoute } from '../test-connection/route';
import { POST as testSendRoute } from '../test-send/route';
import net from 'node:net';
import { NextRequest } from 'next/server';
import { isAdminRequest } from '@/core/auth/auth.server';
import { BroadcastService } from '@/features/broadcast';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/features/broadcast/service', () => ({
  BroadcastService: {
    sendBroadcast: jest.fn().mockResolvedValue({ id: 'b1', status: 'SENT', sentCount: 1, failedCount: 0 }),
    sendTestBroadcast: jest.fn().mockResolvedValue({ success: true, channel: 'EMAIL', destination: 'host@example.com', subject: '[TEST] Test Subject', body: 'Test Body' }),
    renderPreview: jest.fn().mockResolvedValue({ body: 'Rendered Body', destination: 'test@example.com' }),
    getBroadcastHistory: jest.fn().mockResolvedValue([{ id: 'b1', status: 'SENT' }]),
    countBroadcastHistory: jest.fn().mockResolvedValue(1),
    getBroadcastById: jest.fn().mockResolvedValue({
      id: 'b1',
      channel: 'EMAIL',
      subject: 'Welcome',
      body: 'Full body',
      status: 'SENT',
      totalRecipients: 1,
      sentCount: 1,
      failedCount: 0,
      createdAt: '2026-06-01T12:00:00.000Z',
      recipients: [
        {
          id: 'r1',
          guestName: 'Alice',
          destination: 'alice@example.com',
          status: 'SENT',
          error: null,
        },
      ],
    }),
    retryFailedRecipients: jest.fn().mockResolvedValue({ id: 'b1', status: 'SENT' }),
  },
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({ emailProvider: 'smtp' }),
}));

describe('Broadcast API Routes', () => {
  it('POST /api/admin/broadcast/send returns broadcast result', async () => {
    const req = new NextRequest('http://localhost/api/admin/broadcast/send', {
      method: 'POST',
      body: JSON.stringify({
        channel: 'EMAIL',
        subject: 'Test Subject',
        body: 'Test Body',
      }),
    });

    const res = await sendRoute(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.status).toBe('SENT');
  });

  it('POST /api/admin/broadcast/send returns 400 for invalid schema', async () => {
    const req = new NextRequest('http://localhost/api/admin/broadcast/send', {
      method: 'POST',
      body: JSON.stringify({
        channel: 'EMAIL',
        body: '',
      }),
    });

    const res = await sendRoute(req);
    expect(res.status).toBe(400);
  });

  it('POST /api/admin/broadcast/send returns 500 when service fails', async () => {
    (BroadcastService.sendBroadcast as jest.Mock).mockRejectedValueOnce(new Error('Send error'));
    const req = new NextRequest('http://localhost/api/admin/broadcast/send', {
      method: 'POST',
      body: JSON.stringify({
        channel: 'EMAIL',
        body: 'Test',
      }),
    });

    const res = await sendRoute(req);
    expect(res.status).toBe(500);
  });

  it('POST /api/admin/broadcast/send returns 500 with default message when error has no message', async () => {
    (BroadcastService.sendBroadcast as jest.Mock).mockRejectedValueOnce({});
    const req = new NextRequest('http://localhost/api/admin/broadcast/send', {
      method: 'POST',
      body: JSON.stringify({
        channel: 'EMAIL',
        body: 'Test',
      }),
    });

    const res = await sendRoute(req);
    expect(res.status).toBe(500);
  });

  it('POST /api/admin/broadcast/preview returns preview object', async () => {
    const req = new NextRequest('http://localhost/api/admin/broadcast/preview', {
      method: 'POST',
      body: JSON.stringify({
        channel: 'EMAIL',
        subject: 'Test Subject',
        body: 'Test Body',
      }),
    });

    const res = await previewRoute(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.body).toBe('Rendered Body');
  });

  it('POST /api/admin/broadcast/preview returns 400 for empty body', async () => {
    const req = new NextRequest('http://localhost/api/admin/broadcast/preview', {
      method: 'POST',
      body: JSON.stringify({
        channel: 'EMAIL',
        body: '',
      }),
    });

    const res = await previewRoute(req);
    expect(res.status).toBe(400);
  });

  it('POST /api/admin/broadcast/preview returns 500 when render throws', async () => {
    (BroadcastService.renderPreview as jest.Mock).mockRejectedValueOnce(new Error('Preview error'));
    const req = new NextRequest('http://localhost/api/admin/broadcast/preview', {
      method: 'POST',
      body: JSON.stringify({
        channel: 'EMAIL',
        body: 'Test',
      }),
    });

    const res = await previewRoute(req);
    expect(res.status).toBe(500);
  });

  it('POST /api/admin/broadcast/preview returns 500 with default message when error has no message', async () => {
    (BroadcastService.renderPreview as jest.Mock).mockRejectedValueOnce({});
    const req = new NextRequest('http://localhost/api/admin/broadcast/preview', {
      method: 'POST',
      body: JSON.stringify({
        channel: 'EMAIL',
        body: 'Test',
      }),
    });

    const res = await previewRoute(req);
    expect(res.status).toBe(500);
  });

  it('GET /api/admin/broadcast/history returns history array', async () => {
    const req = new NextRequest('http://localhost/api/admin/broadcast/history');
    const res = await historyRoute(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
  });

  it('GET /api/admin/broadcast/history returns 500 when service fails', async () => {
    (BroadcastService.getBroadcastHistory as jest.Mock).mockRejectedValueOnce(new Error('History error'));
    const req = new NextRequest('http://localhost/api/admin/broadcast/history');
    const res = await historyRoute(req);
    expect(res.status).toBe(500);
  });

  it('GET /api/admin/broadcast/history returns 500 with default message when error has no message', async () => {
    (BroadcastService.getBroadcastHistory as jest.Mock).mockRejectedValueOnce({});
    const req = new NextRequest('http://localhost/api/admin/broadcast/history');
    const res = await historyRoute(req);
    expect(res.status).toBe(500);
  });

  it('GET /api/admin/broadcast/history parses page and caps limit at 100 with pagination headers', async () => {
    (BroadcastService.getBroadcastHistory as jest.Mock).mockResolvedValueOnce([
      { id: 'b-page-2', status: 'SENT' },
    ]);
    (BroadcastService.countBroadcastHistory as jest.Mock).mockResolvedValueOnce(135);

    const req = new NextRequest('http://localhost/api/admin/broadcast/history?page=2&limit=500');
    const res = await historyRoute(req);

    expect(res.status).toBe(200);
    expect(BroadcastService.getBroadcastHistory).toHaveBeenLastCalledWith({
      page: 2,
      limit: 100,
    });
    expect(res.headers.get('X-Total-Count')).toBe('135');
    expect(res.headers.get('X-Page')).toBe('2');
    expect(res.headers.get('X-Limit')).toBe('100');
    expect(res.headers.get('X-Total-Pages')).toBe('2');
    expect(res.headers.get('X-Has-Prev-Page')).toBe('true');
    expect(res.headers.get('X-Has-Next-Page')).toBe('false');
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
  });

  it('GET /api/admin/broadcast/history returns 400 for invalid page or limit parameters', async () => {
    const badLimitReq = new NextRequest('http://localhost/api/admin/broadcast/history?limit=0');
    const badLimitRes = await historyRoute(badLimitReq);
    expect(badLimitRes.status).toBe(400);

    const badPageReq = new NextRequest('http://localhost/api/admin/broadcast/history?page=abc');
    const badPageRes = await historyRoute(badPageReq);
    expect(badPageRes.status).toBe(400);
  });

  describe('GET /api/admin/broadcast/[id]', () => {
    it('returns full broadcast details and recipients for a known ID', async () => {
      const req = new NextRequest('http://localhost/api/admin/broadcast/b1');
      const res = await detailRoute(req, { params: Promise.resolve({ id: 'b1' }) });

      expect(res.status).toBe(200);
      expect(BroadcastService.getBroadcastById).toHaveBeenCalledWith('b1');
      const json = await res.json();
      expect(json.data.id).toBe('b1');
      expect(json.data.body).toBe('Full body');
      expect(json.data.recipients).toHaveLength(1);
      expect(json.data.recipients[0].guestName).toBe('Alice');
    });

    it('returns 404 when broadcast ID does not exist', async () => {
      (BroadcastService.getBroadcastById as jest.Mock).mockResolvedValueOnce(null);
      const req = new NextRequest('http://localhost/api/admin/broadcast/unknown-id');
      const res = await detailRoute(req, { params: Promise.resolve({ id: 'unknown-id' }) });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it('returns 401 when caller is unauthenticated', async () => {
      (isAdminRequest as jest.Mock).mockResolvedValueOnce(false);
      const req = new NextRequest('http://localhost/api/admin/broadcast/b1');
      const res = await detailRoute(req, { params: Promise.resolve({ id: 'b1' }) });

      expect(res.status).toBe(401);
    });

    it('returns 500 when BroadcastService.getBroadcastById throws', async () => {
      (BroadcastService.getBroadcastById as jest.Mock).mockRejectedValueOnce(new Error('DB failure'));
      const req = new NextRequest('http://localhost/api/admin/broadcast/b1');
      const res = await detailRoute(req, { params: Promise.resolve({ id: 'b1' }) });

      expect(res.status).toBe(500);
    });
  });

  it('POST /api/admin/broadcast/retry retries failed recipients', async () => {
    const req = new NextRequest('http://localhost/api/admin/broadcast/retry', {
      method: 'POST',
      body: JSON.stringify({
        broadcastId: 'b1',
      }),
    });

    const res = await retryRoute(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.status).toBe('SENT');
  });

  it('POST /api/admin/broadcast/retry returns 400 when broadcastId missing', async () => {
    const req = new NextRequest('http://localhost/api/admin/broadcast/retry', {
      method: 'POST',
      body: JSON.stringify({
        broadcastId: '',
      }),
    });

    const res = await retryRoute(req);
    expect(res.status).toBe(400);
  });

  it('POST /api/admin/broadcast/retry returns 500 when service throws', async () => {
    (BroadcastService.retryFailedRecipients as jest.Mock).mockRejectedValueOnce(new Error('Retry error'));
    const req = new NextRequest('http://localhost/api/admin/broadcast/retry', {
      method: 'POST',
      body: JSON.stringify({
        broadcastId: 'b1',
      }),
    });

    const res = await retryRoute(req);
    expect(res.status).toBe(500);
  });

  it('POST /api/admin/broadcast/retry returns 500 with default message when error has no message', async () => {
    (BroadcastService.retryFailedRecipients as jest.Mock).mockRejectedValueOnce({});
    const req = new NextRequest('http://localhost/api/admin/broadcast/retry', {
      method: 'POST',
      body: JSON.stringify({
        broadcastId: 'b1',
      }),
    });

    const res = await retryRoute(req);
    expect(res.status).toBe(500);
  });

  it('POST /api/admin/broadcast/test-connection verifies live SMTP connection and reports unreachable hosts', async () => {
    const server = net.createServer((socket) => {
      socket.write('220 localhost ESMTP\r\n');
      socket.on('data', (chunk) => {
        const cmd = chunk.toString('utf8').toUpperCase();
        if (cmd.startsWith('EHLO')) {
          socket.write('250 localhost\r\n');
        } else if (cmd.startsWith('QUIT')) {
          socket.write('221 Bye\r\n');
          socket.end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as net.AddressInfo;

    try {
      const req = new NextRequest('http://localhost/api/admin/broadcast/test-connection', {
        method: 'POST',
        body: JSON.stringify({
          type: 'email',
          provider: 'smtp',
          smtpHost: '127.0.0.1',
          smtpPort: port,
          smtpSecure: false,
        }),
      });

      const res = await testConnRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    const failReq = new NextRequest('http://localhost/api/admin/broadcast/test-connection', {
      method: 'POST',
      body: JSON.stringify({
        type: 'email',
        provider: 'smtp',
        smtpHost: '127.0.0.1',
        smtpPort: port,
        smtpSecure: false,
      }),
    });
    const failRes = await testConnRoute(failReq);
    expect(failRes.status).toBe(200);
    const failJson = await failRes.json();
    expect(failJson.success).toBe(false);
  });

  it('POST /api/admin/broadcast/test-connection returns 400 for invalid schema', async () => {
    const req = new NextRequest('http://localhost/api/admin/broadcast/test-connection', {
      method: 'POST',
      body: JSON.stringify({
        type: 'invalid-type',
      }),
    });

    const res = await testConnRoute(req);
    expect(res.status).toBe(400);
  });

  describe('POST /api/admin/broadcast/test-send', () => {
    beforeEach(() => {
      resetRateLimitsForTesting();
    });

    it('returns test broadcast result for valid email payload', async () => {
      const req = new NextRequest('http://localhost/api/admin/broadcast/test-send', {
        method: 'POST',
        headers: { 'x-forwarded-for': '10.0.0.1' },
        body: JSON.stringify({
          channel: 'EMAIL',
          subject: 'Sample Subject',
          body: 'Hello {{guestName}}',
          destination: 'admin@example.com',
        }),
      });

      const res = await testSendRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.destination).toBe('host@example.com');
      expect(BroadcastService.sendTestBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'EMAIL',
          subject: 'Sample Subject',
          body: 'Hello {{guestName}}',
          destination: 'admin@example.com',
        })
      );
    });

    it('returns 400 for empty body', async () => {
      const req = new NextRequest('http://localhost/api/admin/broadcast/test-send', {
        method: 'POST',
        headers: { 'x-forwarded-for': '10.0.0.2' },
        body: JSON.stringify({
          channel: 'EMAIL',
          body: '',
        }),
      });

      const res = await testSendRoute(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid email destination', async () => {
      const req = new NextRequest('http://localhost/api/admin/broadcast/test-send', {
        method: 'POST',
        headers: { 'x-forwarded-for': '10.0.0.3' },
        body: JSON.stringify({
          channel: 'EMAIL',
          body: 'Hello',
          destination: 'invalid-email-address',
        }),
      });

      const res = await testSendRoute(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 for non-E.164 phone destination on SMS', async () => {
      const req = new NextRequest('http://localhost/api/admin/broadcast/test-send', {
        method: 'POST',
        headers: { 'x-forwarded-for': '10.0.0.4' },
        body: JSON.stringify({
          channel: 'SMS',
          body: 'Hello',
          destination: '1234567890', // Missing leading '+'
        }),
      });

      const res = await testSendRoute(req);
      expect(res.status).toBe(400);
    });

    it('returns 500 when BroadcastService.sendTestBroadcast throws', async () => {
      (BroadcastService.sendTestBroadcast as jest.Mock).mockRejectedValueOnce(
        new Error('Provider API Key missing')
      );

      const req = new NextRequest('http://localhost/api/admin/broadcast/test-send', {
        method: 'POST',
        headers: { 'x-forwarded-for': '10.0.0.5' },
        body: JSON.stringify({
          channel: 'EMAIL',
          body: 'Hello',
        }),
      });

      const res = await testSendRoute(req);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toContain('Provider API Key missing');
    });

    it('enforces rate limit of 5 requests per minute per admin session', async () => {
      // 5 requests should pass
      for (let i = 0; i < 5; i++) {
        const req = new NextRequest('http://localhost/api/admin/broadcast/test-send', {
          method: 'POST',
          headers: {
            'x-forwarded-for': '10.0.0.6',
            cookie: 'admin_auth=test-admin-session-token',
          },
          body: JSON.stringify({
            channel: 'EMAIL',
            body: 'Hello',
          }),
        });
        const res = await testSendRoute(req);
        expect(res.status).toBe(200);
      }

      // 6th request from the same session should receive 429
      const req6 = new NextRequest('http://localhost/api/admin/broadcast/test-send', {
        method: 'POST',
        headers: {
          'x-forwarded-for': '10.0.0.6',
          cookie: 'admin_auth=test-admin-session-token',
        },
        body: JSON.stringify({
          channel: 'EMAIL',
          body: 'Hello',
        }),
      });
      const res6 = await testSendRoute(req6);
      expect(res6.status).toBe(429);
      const json6 = await res6.json();
      expect(json6.error).toContain('Too many requests');
    });
  });
});
