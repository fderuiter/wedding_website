
import { isPrivateUrl, isPrivateIP, validateAndResolveHost } from '../ssrf';
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

describe('isPrivateIP', () => {
  it('identifies private and reserved IPv4 addresses', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true);
    expect(isPrivateIP('10.0.0.1')).toBe(true);
    expect(isPrivateIP('192.168.1.1')).toBe(true);
    expect(isPrivateIP('172.16.0.1')).toBe(true);
    expect(isPrivateIP('172.31.255.255')).toBe(true);
    expect(isPrivateIP('169.254.169.254')).toBe(true);
    expect(isPrivateIP('100.64.0.1')).toBe(true);
    expect(isPrivateIP('0.0.0.0')).toBe(true);
    expect(isPrivateIP('224.0.0.1')).toBe(true);
    expect(isPrivateIP('255.255.255.255')).toBe(true);

    expect(isPrivateIP('8.8.8.8')).toBe(false);
    expect(isPrivateIP('1.1.1.1')).toBe(false);
    expect(isPrivateIP('93.184.216.34')).toBe(false);
  });

  it('identifies private and reserved IPv6 addresses', () => {
    expect(isPrivateIP('::1')).toBe(true);
    expect(isPrivateIP('[::1]')).toBe(true);
    expect(isPrivateIP('::')).toBe(true);
    expect(isPrivateIP('fc00::1')).toBe(true);
    expect(isPrivateIP('fd12:3456:789a::1')).toBe(true);
    expect(isPrivateIP('fe80::1')).toBe(true);
    expect(isPrivateIP('[fe80::1]')).toBe(true);
    expect(isPrivateIP('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIP('ff02::1')).toBe(true);
    expect(isPrivateIP('2001:db8::1')).toBe(true);

    expect(isPrivateIP('2606:4700:4700::1111')).toBe(false);
    expect(isPrivateIP('[2606:4700:4700::1111]')).toBe(false);
  });
});

describe('validateAndResolveHost', () => {
  const mockLookup = dns.promises.lookup as jest.Mock;

  beforeEach(() => {
    mockLookup.mockReset();
  });

  it('validates IP literals directly without DNS lookup', async () => {
    await expect(validateAndResolveHost('127.0.0.1')).rejects.toThrow(
      'Blocked: URL resolves to a private or restricted IP address'
    );
    await expect(validateAndResolveHost('[::1]')).rejects.toThrow(
      'Blocked: URL resolves to a private or restricted IP address'
    );
    expect(mockLookup).not.toHaveBeenCalled();

    const publicV4 = await validateAndResolveHost('93.184.216.34');
    expect(publicV4).toEqual({ address: '93.184.216.34', family: 4 });

    const publicV6 = await validateAndResolveHost('[2606:4700:4700::1111]');
    expect(publicV6).toEqual({ address: '2606:4700:4700::1111', family: 6 });
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('resolves hostnames and returns the first public address', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '93.184.216.35', family: 4 },
    ]);

    const result = await validateAndResolveHost('example.com');
    expect(result).toEqual({ address: '93.184.216.34', family: 4 });
  });

  it('rejects hostnames if any resolved record is private', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);

    await expect(validateAndResolveHost('mixed.example.com')).rejects.toThrow(
      'Blocked: URL resolves to a private or restricted IP address'
    );
  });

  it('rejects hostnames when DNS lookup fails', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));

    await expect(validateAndResolveHost('unresolvable.test')).rejects.toThrow(
      'Blocked: URL resolves to a private or restricted IP address'
    );
  });
});
