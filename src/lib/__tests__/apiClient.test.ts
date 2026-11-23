import { ApiClient, getResponsePaginationMeta } from '../apiClient';

describe('ApiClient pagination header metadata', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('exposes X-Total-Count and pagination headers via getWithMeta and getResponsePaginationMeta while preserving plain array semantics on get()', async () => {
    const mockHeaders = new Headers({
      'Content-Type': 'application/json',
      'X-Total-Count': '122',
      'X-Page': '1',
      'X-Limit': '1000',
      'X-Total-Pages': '1',
      'X-Has-Next-Page': 'false',
      'X-Has-Prev-Page': 'false',
      'X-Next-Cursor': 'inv-122',
    });

    global.fetch = jest.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      headers: mockHeaders,
      text: async () =>
        JSON.stringify({
          success: true,
          data: [
            { id: 'inv-1', guestName: 'Household 1' },
            { id: 'inv-122', guestName: 'Household 122' },
          ],
        }),
    })) as unknown as typeof fetch;

    const client = new ApiClient();

    const items = await client.get<Array<{ id: string; guestName: string }>>(
      '/api/admin/invitation-codes?limit=1000'
    );
    expect(Array.isArray(items)).toBe(true);
    expect(items).toEqual([
      { id: 'inv-1', guestName: 'Household 1' },
      { id: 'inv-122', guestName: 'Household 122' },
    ]);
    expect(Object.keys(items)).toEqual(['0', '1']);

    const attachedMeta = getResponsePaginationMeta(items);
    expect(attachedMeta).toEqual({
      totalCount: 122,
      page: 1,
      limit: 1000,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false,
      nextCursor: 'inv-122',
    });

    const withMeta = await client.getWithMeta<Array<{ id: string; guestName: string }>>(
      '/api/admin/invitation-codes?limit=1000'
    );
    expect(withMeta.data).toEqual(items);
    expect(withMeta.meta.totalCount).toBe(122);
    expect(withMeta.meta.limit).toBe(1000);
  });
});
