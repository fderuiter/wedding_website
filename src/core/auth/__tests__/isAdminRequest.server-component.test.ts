import { isAdminRequest, signAdminToken } from '@/core/auth/auth.server';
import { cookies } from 'next/headers';

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

describe('isAdminRequest server component', () => {
  const previousAdminPassword = process.env.ADMIN_PASSWORD;

  beforeAll(() => {
    process.env.ADMIN_PASSWORD = 'test-admin-secret';
  });

  afterAll(() => {
    if (previousAdminPassword === undefined) {
      delete process.env.ADMIN_PASSWORD;
    } else {
      process.env.ADMIN_PASSWORD = previousAdminPassword;
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('resolves true when admin cookie is present and valid', async () => {
    const token = await signAdminToken({ isAdmin: true, iat: Date.now() });

    (cookies as jest.Mock).mockResolvedValue({
      get: () => ({ value: token }),
    });

    await expect(isAdminRequest()).resolves.toBe(true);
  });

  it('resolves false when admin cookie is absent', async () => {
    (cookies as jest.Mock).mockResolvedValue({
      get: () => undefined,
    });

    await expect(isAdminRequest()).resolves.toBe(false);
  });

  it('resolves false when admin cookie is invalid', async () => {
    (cookies as jest.Mock).mockResolvedValue({
      get: () => ({ value: 'invalid_token' }),
    });

    await expect(isAdminRequest()).resolves.toBe(false);
  });
});
