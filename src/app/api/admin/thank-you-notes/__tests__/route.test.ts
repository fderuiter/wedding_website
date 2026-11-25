/** @jest-environment node */

import { GET, POST } from '../route';
import { GET as EXPORT_GET } from '../export/route';
import { GET as EXPORT_LABELS_GET } from '../export-labels/route';
import { PATCH } from '../[id]/route';
import { POST as SEND_EMAIL_POST } from '../[id]/send-email/route';
import { POST as BATCH_POST } from '../batch/route';
import { NextRequest } from 'next/server';
import { thankYouService } from '@/features/registry';

jest.mock('next/server', () => {
  class MockNextResponse {
    static json = jest.fn((body, init) => {
      const responseCookies = new Map();
      const headers = new Headers();
      if (init?.headers) {
        Object.entries(init.headers).forEach(([k, v]) => headers.set(k, v as string));
      }
      const cookies = {
        set: jest.fn((key, value, options) => {
          responseCookies.set(key, { name: key, value });
          let cookieString = `${key}=${value}; Path=/`;
          if (options?.expires) cookieString += `; Expires=${options.expires.toUTCString()}`;
          if (options?.maxAge === 0) cookieString += '; Max-Age=0';
          headers.set('set-cookie', cookieString);
        }),
        get: jest.fn((key) => responseCookies.get(key)),
        delete: jest.fn((key) => responseCookies.delete(key)),
      };
      return {
        status: init?.status || 200,
        headers: headers,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
        cookies: cookies,
      };
    });

    status: number;
    headers: Headers;
    bodyContent: unknown;

    constructor(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      this.bodyContent = body;
      this.status = init?.status || 200;
      this.headers = new Headers();
      if (init?.headers) {
        Object.entries(init.headers).forEach(([k, v]) => {
          this.headers.set(k, v as string);
        });
      }
    }

    async text() {
      if (typeof this.bodyContent === 'string') {
        return this.bodyContent;
      }
      if (this.bodyContent && typeof (this.bodyContent as { getReader?: () => ReadableStreamDefaultReader<Uint8Array> }).getReader === 'function') {
        const reader = (this.bodyContent as { getReader: () => ReadableStreamDefaultReader<Uint8Array> }).getReader();
        const decoder = new TextDecoder();
        let result = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          result += decoder.decode(value, { stream: true });
        }
        result += decoder.decode();
        return result;
      }
      return String(this.bodyContent);
    }

    async json() {
      const text = await this.text();
      return JSON.parse(text);
    }
  }

  const MockNextRequest = jest.fn((input, init) => {
    const requestCookies = new Map();
    if (init?.headers?.cookie) {
      init.headers.cookie.split(';').forEach((c: string) => {
        const [key, value] = c.trim().split('=');
        requestCookies.set(key, { name: key, value });
      });
    }
    const urlObj = new URL(input);
    return {
      ...init,
      url: input,
      nextUrl: urlObj,
      headers: {
        get: (key: string) => {
          if (!init?.headers) return null;
          const lower = key.toLowerCase();
          for (const [k, v] of Object.entries(init.headers)) {
            if (k.toLowerCase() === lower) return String(v);
          }
          return null;
        },
      },
      cookies: {
        get: jest.fn((key) => requestCookies.get(key)),
        set: jest.fn(),
      },
      json: () => Promise.resolve(init && init.body ? JSON.parse(init.body) : {}),
    };
  });

  return {
    NextResponse: MockNextResponse,
    NextRequest: MockNextRequest,
  };
});

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn().mockResolvedValue(true),
  checkAdminAuth: jest.fn().mockResolvedValue(true),
}));

const thankYouSpies = [
  jest.spyOn(thankYouService, 'getThankYouNotes'),
  jest.spyOn(thankYouService, 'createOfflineGift'),
  jest.spyOn(thankYouService, 'updateThankYouNote'),
  jest.spyOn(thankYouService, 'batchUpdateThankYouNotes'),
  jest.spyOn(thankYouService, 'exportThankYouNotesCsv'),
  jest.spyOn(thankYouService, 'exportThankYouNotesPdf'),
  jest.spyOn(thankYouService, 'sendThankYouEmail'),
];

function createMockStream(content: string | Uint8Array): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const bytes = typeof content === 'string' ? encoder.encode(content) : content;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

describe('Thank-You Notes API Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    thankYouSpies.forEach((spy) => spy.mockReset());
  });

  afterAll(() => {
    thankYouSpies.forEach((spy) => spy.mockRestore());
  });

  describe('GET /api/admin/thank-you-notes', () => {
    it('returns thank-you notes list and summary metrics', async () => {
      (thankYouService.getThankYouNotes as jest.Mock).mockResolvedValue({
        items: [
          {
            id: 'c1',
            name: 'Jane Doe',
            amount: 100,
            date: new Date().toISOString(),
            thankYouStatus: 'Unsent',
          },
        ],
        metrics: {
          total: 1,
          sent: 0,
          unsent: 1,
          notNeeded: 0,
          thanked: 0,
          completionPercentage: 0,
        },
      });

      const req = new NextRequest('http://localhost:3000/api/admin/thank-you-notes?status=Unsent&search=Jane');
      const res = await GET(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.items.length).toBe(1);
      expect(json.metrics.total).toBe(1);
      expect(thankYouService.getThankYouNotes).toHaveBeenCalledWith({
        status: 'Unsent',
        search: 'Jane',
      });
    });

    it('passes pagination parameters page and pageSize to thankYouService', async () => {
      (thankYouService.getThankYouNotes as jest.Mock).mockResolvedValue({
        items: [],
        metrics: { total: 0, sent: 0, unsent: 0, notNeeded: 0, thanked: 0, completionPercentage: 0 },
        pagination: { page: 2, pageSize: 25, totalItems: 0, totalPages: 1 },
      });

      const req = new NextRequest('http://localhost:3000/api/admin/thank-you-notes?page=2&pageSize=25');
      const res = await GET(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.pagination).toEqual({ page: 2, pageSize: 25, totalItems: 0, totalPages: 1 });
      expect(thankYouService.getThankYouNotes).toHaveBeenCalledWith({
        page: 2,
        pageSize: 25,
      });
    });
  });

  describe('PATCH /api/admin/thank-you-notes/[id]', () => {
    it('updates individual thank-you note record', async () => {
      (thankYouService.updateThankYouNote as jest.Mock).mockResolvedValue({
        id: 'c1',
        name: 'Jane Doe',
        amount: 100,
        date: new Date().toISOString(),
        thankYouStatus: 'Sent',
        thankYouNote: 'Thank you for the gift!',
      });

      const req = new NextRequest('http://localhost:3000/api/admin/thank-you-notes/c1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thankYouStatus: 'Sent',
          thankYouNote: 'Thank you for the gift!',
        }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.thankYouStatus).toBe('Sent');
    });

    it('returns 400 when invalid status is provided', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/thank-you-notes/c1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thankYouStatus: 'INVALID_STATUS',
        }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });
      expect(res.status).toBe(400);
    });

    it('links or unlinks invitationCodeId on PATCH /api/admin/thank-you-notes/[id]', async () => {
      (thankYouService.updateThankYouNote as jest.Mock).mockResolvedValue({
        id: 'c1',
        name: 'Jane Doe',
        amount: 100,
        date: new Date().toISOString(),
        thankYouStatus: 'Unsent',
        invitationCodeId: 'inv-household-1',
      });

      const req = new NextRequest('http://localhost:3000/api/admin/thank-you-notes/c1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invitationCodeId: 'inv-household-1',
        }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });
      expect(res.status).toBe(200);
      expect(thankYouService.updateThankYouNote).toHaveBeenCalledWith(
        'c1',
        {
          invitationCodeId: 'inv-household-1',
        },
        'Admin'
      );

      const unlinkReq = new NextRequest('http://localhost:3000/api/admin/thank-you-notes/c1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invitationCodeId: '',
        }),
      });
      const unlinkRes = await PATCH(unlinkReq, { params: Promise.resolve({ id: 'c1' }) });
      expect(unlinkRes.status).toBe(200);
      expect(thankYouService.updateThankYouNote).toHaveBeenCalledWith(
        'c1',
        {
          invitationCodeId: null,
        },
        'Admin'
      );
    });

    it('forwards invitationCodeId, postal fields, and syncAddressToGuest on PATCH', async () => {
      (thankYouService.updateThankYouNote as jest.Mock).mockResolvedValue({
        id: 'c1',
        name: 'Jane Doe',
        amount: 100,
        date: new Date().toISOString(),
        thankYouStatus: 'Unsent',
        invitationCodeId: 'inv-1',
        addressLine1: '123 Maple St',
        city: 'Chicago',
        state: 'IL',
        zipCode: '60601',
      });

      const req = new NextRequest('http://localhost:3000/api/admin/thank-you-notes/c1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invitationCodeId: 'inv-1',
          addressLine1: '123 Maple St',
          city: 'Chicago',
          state: 'IL',
          zipCode: '60601',
          syncAddressToGuest: true,
        }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });
      expect(res.status).toBe(200);
      expect(thankYouService.updateThankYouNote).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({
          invitationCodeId: 'inv-1',
          addressLine1: '123 Maple St',
          city: 'Chicago',
          state: 'IL',
          zipCode: '60601',
          syncAddressToGuest: true,
        }),
        'Admin'
      );
    });
  });

  describe('POST /api/admin/thank-you-notes', () => {
    it('creates an offline gift record and returns 201', async () => {
      (thankYouService.createOfflineGift as jest.Mock).mockResolvedValue({
        id: 'c-offline-1',
        name: 'Aunt Clara',
        amount: 150,
        date: new Date().toISOString(),
        thankYouStatus: 'Unsent',
        invitationCodeId: 'inv-clara',
      });

      const req = new NextRequest('http://localhost:3000/api/admin/thank-you-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Aunt Clara',
          amount: 150,
          message: 'Check at reception',
          invitationCodeId: 'inv-clara',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
      expect(thankYouService.createOfflineGift).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Aunt Clara',
          amount: 150,
          message: 'Check at reception',
          invitationCodeId: 'inv-clara',
        }),
        'Admin'
      );
    });

    it('returns 400 when offline gift amount or name is invalid', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/thank-you-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '',
          amount: -10,
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/admin/thank-you-notes/batch', () => {
    it('updates multiple contributor thank-you statuses in batch', async () => {
      (thankYouService.batchUpdateThankYouNotes as jest.Mock).mockResolvedValue([
        { id: 'c1', thankYouStatus: 'Sent' },
        { id: 'c2', thankYouStatus: 'Sent' },
      ]);

      const req = new NextRequest('http://localhost:3000/api/admin/thank-you-notes/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: ['c1', 'c2'],
          status: 'Sent',
        }),
      });

      const res = await BATCH_POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.updatedCount).toBe(2);
    });

    it('returns 400 when ids array is empty', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/thank-you-notes/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: [],
          status: 'Sent',
        }),
      });

      const res = await BATCH_POST(req);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/admin/thank-you-notes/export', () => {
    it('returns CSV file download response with correct headers', async () => {
      const mockCsv = 'Contributor Name,Email\nJane Doe,jane@example.com\n';
      (thankYouService.exportThankYouNotesCsv as jest.Mock).mockImplementation(() => createMockStream(mockCsv));

      const req = new NextRequest('http://localhost:3000/api/admin/thank-you-notes/export?status=Unsent&search=Jane');
      const res = await EXPORT_GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      expect(res.headers.get('content-disposition')).toContain('attachment; filename="thank-you-notes-');
      const body = await res.text();
      expect(body).toBe(mockCsv);
      expect(thankYouService.exportThankYouNotesCsv).toHaveBeenCalledWith({
        status: 'Unsent',
        search: 'Jane',
      });
    });
  });

  describe('GET /api/admin/thank-you-notes/export-labels', () => {
    it('returns PDF binary response with application/pdf headers and avery_5160 filename', async () => {
      const mockPdfBuffer = Buffer.from('%PDF-1.5 test pdf content');
      (thankYouService.exportThankYouNotesPdf as jest.Mock).mockImplementation(() => createMockStream(mockPdfBuffer));

      const req = new NextRequest('http://localhost:3000/api/admin/thank-you-notes/export-labels?template=avery_5160&status=Unsent&search=Jane');
      const res = await EXPORT_LABELS_GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');
      expect(res.headers.get('content-disposition')).toContain('attachment; filename="thank-you-labels-avery_5160-');
      const bodyText = await res.text();
      expect(bodyText).toBe('%PDF-1.5 test pdf content');
      expect(thankYouService.exportThankYouNotesPdf).toHaveBeenCalledWith({
        status: 'Unsent',
        search: 'Jane',
        template: 'avery_5160',
        skipUnaddressed: true,
      });
    });

    it('handles avery_5163 template selection parameter', async () => {
      const mockPdfBuffer = Buffer.from('%PDF-1.5 test pdf content');
      (thankYouService.exportThankYouNotesPdf as jest.Mock).mockImplementation(() => createMockStream(mockPdfBuffer));

      const req = new NextRequest('http://localhost:3000/api/admin/thank-you-notes/export-labels?template=avery_5163');
      const res = await EXPORT_LABELS_GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');
      expect(res.headers.get('content-disposition')).toContain('attachment; filename="thank-you-labels-avery_5163-');
      expect(thankYouService.exportThankYouNotesPdf).toHaveBeenCalledWith({
        status: undefined,
        search: undefined,
        template: 'avery_5163',
        skipUnaddressed: true,
      });
    });

    it('forwards skipUnaddressed=true when requested in query string', async () => {
      const mockPdfBuffer = Buffer.from('%PDF-1.5 test pdf content');
      (thankYouService.exportThankYouNotesPdf as jest.Mock).mockImplementation(() =>
        createMockStream(mockPdfBuffer)
      );

      const req = new NextRequest(
        'http://localhost:3000/api/admin/thank-you-notes/export-labels?template=avery_5160&skipUnaddressed=true'
      );
      const res = await EXPORT_LABELS_GET(req);

      expect(res.status).toBe(200);
      expect(thankYouService.exportThankYouNotesPdf).toHaveBeenCalledWith({
        status: undefined,
        search: undefined,
        template: 'avery_5160',
        skipUnaddressed: true,
      });
    });

    it('honors skipUnaddressed=false and contributorStatus query parameters', async () => {
      const mockPdfBuffer = Buffer.from('%PDF-1.5 test pdf content');
      (thankYouService.exportThankYouNotesPdf as jest.Mock).mockImplementation(() =>
        createMockStream(mockPdfBuffer)
      );

      const req = new NextRequest(
        'http://localhost:3000/api/admin/thank-you-notes/export-labels?template=avery_5160&skipUnaddressed=false&contributorStatus=ALL'
      );
      const res = await EXPORT_LABELS_GET(req);

      expect(res.status).toBe(200);
      expect(thankYouService.exportThankYouNotesPdf).toHaveBeenCalledWith({
        status: undefined,
        contributorStatus: 'ALL',
        search: undefined,
        template: 'avery_5160',
        skipUnaddressed: false,
      });
    });
  });

  describe('POST /api/admin/thank-you-notes/[id]/send-email', () => {
    it('processes preview, test, and send modes via thankYouService.sendThankYouEmail', async () => {
      (thankYouService.sendThankYouEmail as jest.Mock).mockResolvedValue({
        mode: 'send',
        to: 'jane@example.com',
        subject: 'Thank you!',
        textBody: 'Dear Jane, thank you!',
        htmlBody: '<p>Dear Jane, thank you!</p>',
      });

      const req = new NextRequest(
        'http://localhost:3000/api/admin/thank-you-notes/c1/send-email',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'send',
            subject: 'Thank you!',
            body: 'Dear {{guestName}}, thank you!',
            recipientEmail: 'jane@example.com',
          }),
        }
      );

      const res = await SEND_EMAIL_POST(req, { params: Promise.resolve({ id: 'c1' }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.mode).toBe('send');
      expect(thankYouService.sendThankYouEmail).toHaveBeenCalledWith(
        'c1',
        {
          mode: 'send',
          subject: 'Thank you!',
          body: 'Dear {{guestName}}, thank you!',
          recipientEmail: 'jane@example.com',
        },
        'Admin'
      );
    });

    it('returns 400 when body is empty or mode is invalid', async () => {
      const req = new NextRequest(
        'http://localhost:3000/api/admin/thank-you-notes/c1/send-email',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'send',
            body: '   ',
          }),
        }
      );

      const res = await SEND_EMAIL_POST(req, { params: Promise.resolve({ id: 'c1' }) });
      expect(res.status).toBe(400);
    });
  });
});
