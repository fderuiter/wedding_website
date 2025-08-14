import { isAdminRequest } from '../adminAuth.server';
import { cookies } from 'next/headers';

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

describe('isAdminRequest server component', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('resolves true when admin cookie is present', async () => {
    (cookies as jest.Mock).mockResolvedValue({
      get: () => ({ value: 'true' }),
    });

    await expect(isAdminRequest()).resolves.toBe(true);
  });

  it('resolves false when admin cookie is absent', async () => {
    (cookies as jest.Mock).mockResolvedValue({
      get: () => undefined,
    });

    await expect(isAdminRequest()).resolves.toBe(false);
  });
});
