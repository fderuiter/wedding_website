/** @jest-environment node */

import { GET } from '../route';
import { GET as EXPORT_GET } from '../export/route';
import { GET as EXPORT_LABELS_GET } from '../export-labels/route';
import { PATCH } from '../[id]/route';
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
          if (key === 'cookie' && init?.headers) return init.headers.cookie;
          return null;
        }
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

jest.mock('@/features/registry', () => ({
  ...jest.requireActual('@/features/registry'),
  thankYouService: {
    getThankYouNotes: jest.fn(),
    updateThankYouNote: jest.fn(),
    batchUpdateThankYouNotes: jest.fn(),
    exportThankYouNotesCsv: jest.fn(),
    exportThankYouNotesPdf: jest.fn(),
  },
}));

jest.mock('@/features/registry/thank-you.service', () => ({
  thankYouService: {
    getThankYouNotes: jest.fn(),
    updateThankYouNote: jest.fn(),
    batchUpdateThankYouNotes: jest.fn(),
    exportThankYouNotesCsv: jest.fn(),
    exportThankYouNotesPdf: jest.fn(),
  },
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn().mockResolvedValue(true),
  checkAdminAuth: jest.fn().mockResolvedValue(true),
}));

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
        body: JSON.stringify({
          thankYouStatus: 'INVALID_STATUS',
        }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });
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
      });
    });
  });
});
