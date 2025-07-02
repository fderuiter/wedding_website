jest.mock('next/server', () => ({
  NextResponse: { json: jest.fn((data, init) => ({ status: init?.status || 200, json: () => data })) }
}));

jest.mock('../../../../services/registryService', () => ({
  RegistryService: { contributeToItem: jest.fn() }
}));

// Import after mocks
import { POST } from '../contribute/route';

describe('POST /api/registry/contribute', () => {
  it('returns 400 on invalid payload', async () => {
    const req = {
      json: async () => ({}),
    } as unknown as Request;
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });
});
