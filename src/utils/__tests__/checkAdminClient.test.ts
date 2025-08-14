import { checkAdminClient } from '../adminAuth.client';

describe('checkAdminClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.resetAllMocks();
    global.fetch = originalFetch;
  });

  it('returns true when response ok and isAdmin true', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ isAdmin: true }),
    } as unknown as Response);

    await expect(checkAdminClient()).resolves.toBe(true);
  });

  it('returns false when response ok but isAdmin false', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ isAdmin: false }),
    } as unknown as Response);

    await expect(checkAdminClient()).resolves.toBe(false);
  });

  it('returns false when response not ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false } as unknown as Response);

    await expect(checkAdminClient()).resolves.toBe(false);
  });

  it('returns false when fetch rejects', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network'));

    await expect(checkAdminClient()).resolves.toBe(false);
  });
});
