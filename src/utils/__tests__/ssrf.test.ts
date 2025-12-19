
import { isPrivateUrl } from '../ssrf';
import dns from 'dns';

// Mock dns.promises.lookup
jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn(),
  },
}));

describe('isPrivateUrl', () => {
  const mockLookup = dns.promises.lookup as jest.Mock;

  beforeEach(() => {
    mockLookup.mockReset();
  });

  it('should return true for private IPv4 addresses', async () => {
    // 127.0.0.1
    mockLookup.mockResolvedValue({ address: '127.0.0.1', family: 4 });
    expect(await isPrivateUrl('http://localhost')).toBe(true);

    // 10.0.0.1
    mockLookup.mockResolvedValue({ address: '10.0.0.1', family: 4 });
    expect(await isPrivateUrl('http://internal-service')).toBe(true);

    // 192.168.1.1
    mockLookup.mockResolvedValue({ address: '192.168.1.1', family: 4 });
    expect(await isPrivateUrl('http://router')).toBe(true);

    // 169.254.169.254 (Metadata service)
    mockLookup.mockResolvedValue({ address: '169.254.169.254', family: 4 });
    expect(await isPrivateUrl('http://metadata')).toBe(true);
  });

  it('should return true for private IPv6 addresses', async () => {
    // ::1
    mockLookup.mockResolvedValue({ address: '::1', family: 6 });
    expect(await isPrivateUrl('http://localhost-v6')).toBe(true);

    // fc00::1 (Unique Local)
    mockLookup.mockResolvedValue({ address: 'fc00::1', family: 6 });
    expect(await isPrivateUrl('http://private-v6')).toBe(true);
  });

  it('should return false for public addresses', async () => {
    // 8.8.8.8 (Google DNS)
    mockLookup.mockResolvedValue({ address: '8.8.8.8', family: 4 });
    expect(await isPrivateUrl('http://google.com')).toBe(false);

    // 1.1.1.1 (Cloudflare)
    mockLookup.mockResolvedValue({ address: '1.1.1.1', family: 4 });
    expect(await isPrivateUrl('http://cloudflare.com')).toBe(false);
  });

  it('should return true (safe) when DNS lookup fails', async () => {
    mockLookup.mockRejectedValue(new Error('DNS lookup failed'));
    expect(await isPrivateUrl('http://non-existent-domain')).toBe(true);
  });

  it('should return true (safe) for invalid URLs', async () => {
    expect(await isPrivateUrl('not-a-url')).toBe(true);
  });

  it('should return true for AWS metadata IP', async () => {
      mockLookup.mockResolvedValue({ address: '169.254.169.254', family: 4 });
      expect(await isPrivateUrl('http://169.254.169.254')).toBe(true);
  });
});
