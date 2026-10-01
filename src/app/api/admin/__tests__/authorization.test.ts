/** @jest-environment node */

import { NextRequest } from 'next/server';
import { GET as exportMaintenance } from '../maintenance/export/route';
import { POST as importMaintenance } from '../maintenance/import/route';
import { POST as uploadFile } from '../upload/route';
import { POST as updateSettings } from '../settings/route';
import { PUT as updateFeatures } from '../features/route';
import { POST as restoreVersion } from '../versions/[id]/restore/route';
import { GET as getEntity, POST as createEntity } from '../[entity]/route';
import { GET as getEntityById, PUT as updateEntityById, DELETE as deleteEntityById } from '../[entity]/[id]/route';
import { registryScrapePOST as scrapeUrl } from '@/features/registry';
import { POST as guestLogin } from '@/app/api/guest/login/route';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';
import { redactLogData } from '@/lib/logger';

describe('High-Risk Admin Routes Explicit Authorization Tests', () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = 'scrypt:8R6mvU36W2Cqp3C8vq+r1g==:XlhFCFplIJUauzo9FzPUPVgA5458RRwbTpQtFCRWjoLN4AI6VCH76jOksMQdQX/5f45ALowp67Xxo58mFrcb3g==';
    process.env.GUEST_PASSCODE = 'secret-guest-code';
    resetRateLimitsForTesting();
  });

  describe('Unauthenticated Anonymous Request Rejection (401 Unauthorized)', () => {
    test('GET /api/admin/maintenance/export rejects unauthenticated request', async () => {
      const req = new NextRequest('http://localhost/api/admin/maintenance/export');
      const res = await exportMaintenance(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });

    test('POST /api/admin/maintenance/import rejects unauthenticated request', async () => {
      const req = new NextRequest('http://localhost/api/admin/maintenance/import', {
        method: 'POST',
        body: JSON.stringify({ appConfig: [], registryItem: [] }),
      });
      const res = await importMaintenance(req);
      expect(res.status).toBe(401);
    });

    test('POST /api/admin/upload rejects unauthenticated request', async () => {
      const req = new NextRequest('http://localhost/api/admin/upload', {
        method: 'POST',
      });
      const res = await uploadFile(req);
      expect(res.status).toBe(401);
    });

    test('POST /api/admin/settings rejects unauthenticated request', async () => {
      const req = new NextRequest('http://localhost/api/admin/settings', {
        method: 'POST',
        body: JSON.stringify({ brideName: 'Jane', groomName: 'John' }),
      });
      const res = await updateSettings(req);
      expect(res.status).toBe(401);
    });

    test('PUT /api/admin/features rejects unauthenticated request', async () => {
      const req = new NextRequest('http://localhost/api/admin/features', {
        method: 'PUT',
        body: JSON.stringify({ features: [] }),
      });
      const res = await updateFeatures(req);
      expect(res.status).toBe(401);
    });

    test('POST /api/admin/versions/[id]/restore rejects unauthenticated request', async () => {
      const req = new NextRequest('http://localhost/api/admin/versions/v1/restore', {
        method: 'POST',
      });
      const res = await restoreVersion(req, { params: Promise.resolve({ id: 'v1' }) });
      expect(res.status).toBe(401);
    });

    test('GET/POST /api/admin/content-nodes rejects unauthenticated request', async () => {
      const getReq = new NextRequest('http://localhost/api/admin/content-nodes');
      const getRes = await getEntity(getReq, { params: Promise.resolve({ entity: 'content-nodes' }) });
      expect(getRes.status).toBe(401);

      const postReq = new NextRequest('http://localhost/api/admin/content-nodes', {
        method: 'POST',
        body: JSON.stringify({ type: 'FAQ', tags: [], data: {} }),
      });
      const postRes = await createEntity(postReq, { params: Promise.resolve({ entity: 'content-nodes' }) });
      expect(postRes.status).toBe(401);
    });

    test('GET/PUT/DELETE /api/admin/content-nodes/[id] rejects unauthenticated request', async () => {
      const params = Promise.resolve({ entity: 'content-nodes', id: 'node-1' });

      const getReq = new NextRequest('http://localhost/api/admin/content-nodes/node-1');
      expect((await getEntityById(getReq, { params })).status).toBe(401);

      const putReq = new NextRequest('http://localhost/api/admin/content-nodes/node-1', { method: 'PUT' });
      expect((await updateEntityById(putReq, { params })).status).toBe(401);

      const delReq = new NextRequest('http://localhost/api/admin/content-nodes/node-1', { method: 'DELETE' });
      expect((await deleteEntityById(delReq, { params })).status).toBe(401);
    });

    test('POST /api/registry/scrape rejects unauthenticated request', async () => {
      const req = new NextRequest('http://localhost/api/registry/scrape', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com/item' }),
      });
      const res = await scrapeUrl(req);
      expect(res.status).toBe(401);
    });
  });

  describe('Guest Login Rate Limiting & Auth', () => {
    test('guest login applies strict rate limiting (5 attempts max)', async () => {
      const makeReq = () => new NextRequest('http://localhost/api/guest/login', {
        method: 'POST',
        body: JSON.stringify({ passcode: 'wrong-passcode' }),
      });

      for (let i = 0; i < 5; i++) {
        const res = await guestLogin(makeReq());
        expect(res.status).toBe(401);
      }

      // 6th attempt should be rate limited (429)
      const resRateLimited = await guestLogin(makeReq());
      expect(resRateLimited.status).toBe(429);
      const json = await resRateLimited.json();
      expect(json.error).toBe('Too many requests, please try again later.');
    });

    test('guest login succeeds with correct passcode', async () => {
      const req = new NextRequest('http://localhost/api/guest/login', {
        method: 'POST',
        body: JSON.stringify({ passcode: 'secret-guest-code' }),
      });
      const res = await guestLogin(req);
      expect(res.status).toBe(200);
      const cookie = res.cookies.get('guest_auth')?.value;
      expect(cookie).toBeDefined();
      expect(cookie).toContain('.');
    });
  });

  describe('Log Redaction Security Controls', () => {
    test('redactLogData strips sensitive credentials from log payloads', () => {
      const payload = {
        username: 'admin',
        password: 'my-super-secret-password',
        nested: {
          GUEST_PASSCODE: 'wedding2026',
          DATABASE_URL: 'postgresql://wedding:supersecret@localhost:5432/wedding_db',
          token: 'jwt.token.val',
        },
      };

      const redacted = redactLogData(payload);

      expect(redacted.password).toBe('[REDACTED]');
      expect(redacted.nested.GUEST_PASSCODE).toBe('[REDACTED]');
      expect(redacted.nested.token).toBe('[REDACTED]');
      expect(redacted.nested.DATABASE_URL).toContain('[REDACTED]');
      expect(redacted.nested.DATABASE_URL).not.toContain('supersecret');
      expect(redacted.username).toBe('admin');
    });
  });
});
