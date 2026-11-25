
import {
  isPrivateUrl,
  isPrivateIP,
  validateAndResolveHost,
  parseIPv4ToBigInt,
  parseIPv6ToBigInt,
} from '../ssrf';
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

  it('rejects non-canonical IPv6, NAT64, transitional IPv6, benchmarking, and encoded IPv4 vectors without DNS lookup', async () => {
    const blockedLiterals = [
      '0:0:0:0:0:0:0:1',
      '[0:0:0:0:0:0:0:1]',
      '0:0:0:0:0:0:0:0',
      '0:0:0:0:0:ffff:127.0.0.1',
      '[0:0:0:0:0:ffff:127.0.0.1]',
      '0:0:0:0:0:ffff:169.254.169.254',
      '0:0:0:0:0:FFFF:7f00:0001',
      '64:ff9b::a9fe:a9fe',
      '[64:ff9b::a9fe:a9fe]',
      '64:ff9b:1::1',
      '::7f00:1',
      '[::7f00:1]',
      '2002:7f00:1::',
      '2001::1',
      '2001:2::1',
      '198.18.0.1',
      '198.19.255.255',
      '192.0.2.1',
      '198.51.100.10',
      '203.0.113.5',
      '0177.0.0.1',
      '0x7f000001',
      '2130706433',
      'fe80::1%eth0',
    ];

    for (const host of blockedLiterals) {
      expect(isPrivateIP(host)).toBe(true);
      await expect(validateAndResolveHost(host)).rejects.toThrow(
        'Blocked: URL resolves to a private or restricted IP address'
      );
    }
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('canonicalizes expanded public IPv6 literals and permits adjacent public ranges', async () => {
    await expect(
      validateAndResolveHost('2001:4860:4860:0000:0000:0000:0000:8888')
    ).resolves.toEqual({
      address: '2001:4860:4860::8888',
      family: 6,
    });

    await expect(validateAndResolveHost('198.17.255.254')).resolves.toEqual({
      address: '198.17.255.254',
      family: 4,
    });

    await expect(validateAndResolveHost('198.20.0.1')).resolves.toEqual({
      address: '198.20.0.1',
      family: 4,
    });
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('rejects multihomed DNS responses when any record is a non-canonical restricted IPv6 address', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '0:0:0:0:0:ffff:169.254.169.254', family: 6 },
    ]);

    await expect(validateAndResolveHost('dualstack-rebind.example.com')).rejects.toThrow(
      'Blocked: URL resolves to a private or restricted IP address'
    );
    expect(await isPrivateUrl('https://dualstack-rebind.example.com/item')).toBe(true);
  });
});

describe('parseIPv4ToBigInt and parseIPv6ToBigInt', () => {
  it('parses canonical IPv4 literals into unsigned 32-bit BigInts and rejects non-canonical strings', () => {
    expect(parseIPv4ToBigInt('0.0.0.0')).toBe(BigInt(0));
    expect(parseIPv4ToBigInt('127.0.0.1')).toBe(BigInt(0x7f000001));
    expect(parseIPv4ToBigInt('198.18.0.1')).toBe(BigInt(0xc6120001));
    expect(parseIPv4ToBigInt('255.255.255.255')).toBe(BigInt(0xffffffff));

    expect(parseIPv4ToBigInt('')).toBeNull();
    expect(parseIPv4ToBigInt('256.0.0.1')).toBeNull();
    expect(parseIPv4ToBigInt('0177.0.0.1')).toBeNull();
    expect(parseIPv4ToBigInt('127.1')).toBeNull();
  });

  it('parses expanded, compressed, and IPv4-embedded IPv6 literals into identical 128-bit BigInts', () => {
    expect(parseIPv6ToBigInt('::1')).toBe(BigInt(1));
    expect(parseIPv6ToBigInt('0:0:0:0:0:0:0:1')).toBe(BigInt(1));
    expect(parseIPv6ToBigInt('[0000:0000:0000:0000:0000:0000:0000:0001]')).toBe(BigInt(1));

    expect(parseIPv6ToBigInt('::ffff:127.0.0.1')).toBe(BigInt('0xffff7f000001'));
    expect(parseIPv6ToBigInt('0:0:0:0:0:ffff:127.0.0.1')).toBe(BigInt('0xffff7f000001'));
    expect(parseIPv6ToBigInt('0:0:0:0:0:ffff:169.254.169.254')).toBe(BigInt('0xffffa9fea9fe'));
    expect(parseIPv6ToBigInt('::7f00:1')).toBe(BigInt(0x7f000001));
    expect(parseIPv6ToBigInt('64:ff9b::a9fe:a9fe')).toBe(
      (BigInt(0x0064ff9b) << BigInt(96)) | BigInt(0xa9fea9fe)
    );

    expect(parseIPv6ToBigInt('')).toBeNull();
    expect(parseIPv6ToBigInt('fe80::1%lo0')).toBeNull();
    expect(parseIPv6ToBigInt('2001:::1')).toBeNull();
    expect(parseIPv6ToBigInt('1:2:3:4:5:6:7:8:9')).toBeNull();
  });
});
