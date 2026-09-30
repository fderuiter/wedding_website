/** @jest-environment node */

import { GET as healthRoute } from '@/app/api/health/route';

describe('health Route', () => {
  it('returns 200 with ok status and timestamp', async () => {
    const req = new Request('http://localhost/api/health', {
      method: 'GET',
    });
    const res = await healthRoute(req as any, {});
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.status).toBe('ok');
    expect(json.data.timestamp).toBeDefined();
  });
});
