
import {
  isPrivateUrl,
  isPrivateIP,
  parseIPv4ToBigInt,
  parseIPv6ToBigInt,
  validateAndResolveHost,
} from '../ssrf';
import dns from 'dns';

// Mock dns.promises.lookup
jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn(),
  },
}));

describe('parseIPv4ToBigInt & parseIPv6ToBigInt', () => {
  it('parses canonical decimal IPv4 addresses and rejects non-canonical or invalid strings', () => {
    expect(parseIPv4ToBigInt('0.0.0.0')).toBe(BigInt(0));
    expect(parseIPv4ToBigInt('127.0.0.1')).toBe(BigInt(0x7f000001));
    expect(parseIPv4ToBigInt('255.255.255.255')).toBe(BigInt(0xffffffff));

    expect(parseIPv4ToBigInt('')).toBeNull();
    expect(parseIPv4ToBigInt('0177.0.0.1')).toBeNull();
    expect(parseIPv4ToBigInt('0x7f.0.0.1')).toBeNull();
    expect(parseIPv4ToBigInt('256.0.0.1')).toBeNull();
    expect(parseIPv4ToBigInt('127.0.1')).toBeNull();
    expect(parseIPv4ToBigInt('127.0.0.1.2')).toBeNull();
  });

  it('parses compressed, expanded, bracketed, and IPv4-embedded IPv6 literals into 128-bit BigInts', () => {
    expect(parseIPv6ToBigInt('::1')).toBe(BigInt(1));
    expect(parseIPv6ToBigInt('0:0:0:0:0:0:0:1')).toBe(BigInt(1));
    expect(parseIPv6ToBigInt('[0000:0000:0000:0000:0000:0000:0000:0001]')).toBe(BigInt(1));
    expect(parseIPv6ToBigInt('::ffff:127.0.0.1')).toBe(
      parseIPv6ToBigInt('0:0:0:0:0:ffff:7f00:0001')
    );

    expect(parseIPv6ToBigInt('')).toBeNull();
    expect(parseIPv6ToBigInt('fe80::1%eth0')).toBeNull();
    expect(parseIPv6ToBigInt('2001:::1')).toBeNull();
    expect(parseIPv6ToBigInt(':1:2:3:4:5:6:7')).toBeNull();
    expect(parseIPv6ToBigInt('1:2:3:4:5:6:7:')).toBeNull();
    expect(parseIPv6ToBigInt('1:2:3:4:5:6:7:8:9')).toBeNull();
  });
});

describe('isPrivateUrl', () => {
  const mockLookup = dns.promises.lookup as jest.Mock;

  beforeEach(() => {
    mockLookup.mockReset();
  });

  it('should return true for private IPv4 addresses', async () => {
    mockLookup.mockResolvedValue({ address: '127.0.0.1', family: 4 });
    expect(await isPrivateUrl('http://localhost')).toBe(true);

    mockLookup.mockResolvedValue({ address: '10.0.0.1', family: 4 });
    expect(await isPrivateUrl('http://internal-service')).toBe(true);

    mockLookup.mockResolvedValue({ address: '192.168.1.1', family: 4 });
    expect(await isPrivateUrl('http://router')).toBe(true);

    mockLookup.mockResolvedValue({ address: '169.254.169.254', family: 4 });
    expect(await isPrivateUrl('http://metadata')).toBe(true);
  });

  it('should return true for alternate IPv4 notations and non-canonical IPv6 URLs without DNS lookup', async () => {
    expect(await isPrivateUrl('http://0177.0.0.1/admin')).toBe(true);
    expect(await isPrivateUrl('http://0x7f000001/admin')).toBe(true);
    expect(await isPrivateUrl('http://2130706433/admin')).toBe(true);
    expect(await isPrivateUrl('http://127.0.0.1./admin')).toBe(true);
    expect(await isPrivateUrl('http://[0:0:0:0:0:0:0:1]/admin')).toBe(true);
    expect(await isPrivateUrl('http://[0:0:0:0:0:ffff:127.0.0.1]/admin')).toBe(true);
    expect(await isPrivateUrl('http://[64:ff9b::a9fe:a9fe]/latest/meta-data')).toBe(true);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('should return true for private IPv6 addresses', async () => {
    mockLookup.mockResolvedValue({ address: '::1', family: 6 });
    expect(await isPrivateUrl('http://localhost-v6')).toBe(true);

    mockLookup.mockResolvedValue({ address: 'fc00::1', family: 6 });
    expect(await isPrivateUrl('http://private-v6')).toBe(true);
  });

  it('should return false for public addresses', async () => {
    mockLookup.mockResolvedValue({ address: '8.8.8.8', family: 4 });
    expect(await isPrivateUrl('http://google.com')).toBe(false);

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
  it('identifies private, special-purpose, and benchmarking IPv4 addresses with exact CIDR boundaries', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true);
    expect(isPrivateIP('10.0.0.1')).toBe(true);
    expect(isPrivateIP('192.168.1.1')).toBe(true);
    expect(isPrivateIP('172.16.0.1')).toBe(true);
    expect(isPrivateIP('172.31.255.255')).toBe(true);
    expect(isPrivateIP('169.254.169.254')).toBe(true);
    expect(isPrivateIP('100.64.0.1')).toBe(true);
    expect(isPrivateIP('100.127.255.254')).toBe(true);
    expect(isPrivateIP('192.0.0.1')).toBe(true);
    expect(isPrivateIP('192.0.2.1')).toBe(true);
    expect(isPrivateIP('198.18.0.1')).toBe(true);
    expect(isPrivateIP('198.19.255.254')).toBe(true);
    expect(isPrivateIP('198.51.100.1')).toBe(true);
    expect(isPrivateIP('203.0.113.1')).toBe(true);
    expect(isPrivateIP('0.0.0.0')).toBe(true);
    expect(isPrivateIP('224.0.0.1')).toBe(true);
    expect(isPrivateIP('240.0.0.1')).toBe(true);
    expect(isPrivateIP('255.255.255.255')).toBe(true);

    // Adjacent public CIDR boundary checks
    expect(isPrivateIP('8.8.8.8')).toBe(false);
    expect(isPrivateIP('1.1.1.1')).toBe(false);
    expect(isPrivateIP('93.184.216.34')).toBe(false);
    expect(isPrivateIP('100.63.255.254')).toBe(false);
    expect(isPrivateIP('100.128.0.1')).toBe(false);
    expect(isPrivateIP('172.15.255.254')).toBe(false);
    expect(isPrivateIP('172.32.0.1')).toBe(false);
    expect(isPrivateIP('198.17.255.254')).toBe(false);
    expect(isPrivateIP('198.20.0.1')).toBe(false);
  });

  it('identifies private, non-canonical, NAT64, transitional, and benchmarking IPv6 addresses', () => {
    expect(isPrivateIP('::1')).toBe(true);
    expect(isPrivateIP('[::1]')).toBe(true);
    expect(isPrivateIP('0:0:0:0:0:0:0:1')).toBe(true);
    expect(isPrivateIP('0000:0000:0000:0000:0000:0000:0000:0001')).toBe(true);
    expect(isPrivateIP('::')).toBe(true);
    expect(isPrivateIP('0:0:0:0:0:0:0:0')).toBe(true);
    expect(isPrivateIP('fc00::1')).toBe(true);
    expect(isPrivateIP('fd12:3456:789a::1')).toBe(true);
    expect(isPrivateIP('fe80::1')).toBe(true);
    expect(isPrivateIP('[fe80::1]')).toBe(true);
    expect(isPrivateIP('fe80::1%eth0')).toBe(true);
    expect(isPrivateIP('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIP('0:0:0:0:0:ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIP('::ffff:7f00:1')).toBe(true);
    expect(isPrivateIP('0:0:0:0:0:ffff:169.254.169.254')).toBe(true);
    expect(isPrivateIP('::ffff:0:a9fe:a9fe')).toBe(true);
    expect(isPrivateIP('::7f00:1')).toBe(true);
    expect(isPrivateIP('64:ff9b::1')).toBe(true);
    expect(isPrivateIP('64:ff9b::a9fe:a9fe')).toBe(true);
    expect(isPrivateIP('64:ff9b:1::1')).toBe(true);
    expect(isPrivateIP('2001::1')).toBe(true);
    expect(isPrivateIP('2001:2::1')).toBe(true);
    expect(isPrivateIP('2001:db8::1')).toBe(true);
    expect(isPrivateIP('2002:7f00:1::')).toBe(true);
    expect(isPrivateIP('2002:5db8:d822::1')).toBe(true);
    expect(isPrivateIP('ff02::1')).toBe(true);

    expect(isPrivateIP('2606:4700:4700::1111')).toBe(false);
    expect(isPrivateIP('[2606:4700:4700::1111]')).toBe(false);
    expect(isPrivateIP('2001:4860:4860:0000:0000:0000:0000:8888')).toBe(false);
  });
});

describe('validateAndResolveHost', () => {
  const mockLookup = dns.promises.lookup as jest.Mock;

  beforeEach(() => {
    mockLookup.mockReset();
  });

  it('validates canonical and non-canonical IP literals directly without DNS lookup', async () => {
    for (const blockedLiteral of [
      '127.0.0.1',
      '127.0.0.1.',
      '0177.0.0.1',
      '0x7f000001',
      '2130706433',
      '198.18.0.1',
      '[::1]',
      '[0:0:0:0:0:0:0:1]',
      '[0:0:0:0:0:ffff:127.0.0.1]',
      '[0:0:0:0:0:ffff:169.254.169.254]',
      '[64:ff9b::a9fe:a9fe]',
      '[::7f00:1]',
      '[2002:7f00:1::]',
      '[2001::1]',
      '[2001:2::1]',
      '[fe80::1%eth0]',
    ]) {
      await expect(validateAndResolveHost(blockedLiteral)).rejects.toThrow(
        'Blocked: URL resolves to a private or restricted IP address'
      );
    }
    expect(mockLookup).not.toHaveBeenCalled();

    const publicV4 = await validateAndResolveHost('93.184.216.34');
    expect(publicV4).toEqual({ address: '93.184.216.34', family: 4 });

    const trailingDotPublicV4 = await validateAndResolveHost('93.184.216.34.');
    expect(trailingDotPublicV4).toEqual({ address: '93.184.216.34', family: 4 });

    const publicV6 = await validateAndResolveHost('[2606:4700:4700::1111]');
    expect(publicV6).toEqual({ address: '2606:4700:4700::1111', family: 6 });

    const expandedPublicV6 = await validateAndResolveHost(
      '[2001:4860:4860:0000:0000:0000:0000:8888]'
    );
    expect(expandedPublicV6).toEqual({ address: '2001:4860:4860::8888', family: 6 });
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

  it('rejects hostnames if any resolved record is private (including non-canonical IPv6 AAAA records)', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '0:0:0:0:0:ffff:169.254.169.254', family: 6 },
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
