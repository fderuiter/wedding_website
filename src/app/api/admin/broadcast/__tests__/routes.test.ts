import { POST as sendRoute } from '../send/route';
import { POST as previewRoute } from '../preview/route';
import { GET as historyRoute } from '../history/route';
import { POST as retryRoute } from '../retry/route';
import { POST as testConnRoute } from '../test-connection/route';
import { NextRequest } from 'next/server';
import { BroadcastService } from '@/features/broadcast/service';

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/features/broadcast/service', () => ({
  BroadcastService: {
    sendBroadcast: jest.fn().mockResolvedValue({ id: 'b1', status: 'SENT', sentCount: 1, failedCount: 0 }),
    renderPreview: jest.fn().mockResolvedValue({ body: 'Rendered Body', destination: 'test@example.com' }),
    getBroadcastHistory: jest.fn().mockResolvedValue([{ id: 'b1', status: 'SENT' }]),
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

  it('GET /api/admin/broadcast/history returns history array', async () => {
    const req = new NextRequest('http://localhost/api/admin/broadcast/history');
    const res = await historyRoute(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
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

  it('POST /api/admin/broadcast/test-connection returns connection result', async () => {
    const req = new NextRequest('http://localhost/api/admin/broadcast/test-connection', {
      method: 'POST',
      body: JSON.stringify({
        type: 'email',
        provider: 'smtp',
        smtpHost: 'smtp.test.com',
      }),
    });

    const res = await testConnRoute(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
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
});
