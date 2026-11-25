import dns from 'dns';

export interface ResolvedAddress {
  address: string;
  family: number;
}

interface CidrBlock {
  readonly network: bigint;
  readonly mask: bigint;
}

const ZERO = BigInt(0);
const ONE = BigInt(1);
const EIGHT = BigInt(8);
const SIXTEEN = BigInt(16);
const BYTE_MASK = BigInt(0xff);
const HEXTET_MASK = BigInt(0xffff);
const IPV4_MAX = BigInt(0xffffffff);
const IPV6_MAX = (ONE << BigInt(128)) - ONE;
const BLOCKED_HOST_MESSAGE = 'Blocked: URL resolves to a private or restricted IP address';

/**
 * Parses a canonical dotted-decimal IPv4 literal into an unsigned 32-bit BigInt.
 * Returns null if the input is not a valid 4-octet decimal IPv4 literal.
 */
export function parseIPv4ToBigInt(ip: string): bigint | null {
  const trimmed = ip.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split('.');
  if (parts.length !== 4) {
    return null;
  }

  let result = ZERO;
  for (const part of parts) {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet < 0 || octet > 255) {
      return null;
    }
    result = (result << EIGHT) | BigInt(octet);
  }

  return result & IPV4_MAX;
}

/**
 * Parses any valid IPv6 literal (expanded, compressed `::`, bracketed, mixed-case,
 * or IPv4-embedded) into an unsigned 128-bit BigInt.
 * Rejects scoped zone indices (`%`), malformed hextets, or invalid group counts.
 */
export function parseIPv6ToBigInt(ip: string): bigint | null {
  const clean = ip.trim().replace(/^\[|\]$/g, '').trim();
  if (!clean || clean.includes('%') || !clean.includes(':') || clean.includes(':::')) {
    return null;
  }

  const doubleColonSides = clean.split('::');
  if (doubleColonSides.length > 2) {
    return null;
  }

  const hasDoubleColon = doubleColonSides.length === 2;
  const leftRaw = doubleColonSides[0];
  const rightRaw = hasDoubleColon ? doubleColonSides[1] : '';

  if (!hasDoubleColon && (clean.startsWith(':') || clean.endsWith(':'))) {
    return null;
  }
  if (hasDoubleColon && (leftRaw.startsWith(':') || rightRaw.endsWith(':'))) {
    return null;
  }

  const leftTokens = leftRaw === '' ? [] : leftRaw.split(':');
  const rightTokens = hasDoubleColon ? (rightRaw === '' ? [] : rightRaw.split(':')) : [];

  if (hasDoubleColon && leftTokens.some((tok) => tok.includes('.'))) {
    return null;
  }

  const tailTokens = hasDoubleColon ? rightTokens : leftTokens;
  for (let i = 0; i < tailTokens.length; i++) {
    if (tailTokens[i].includes('.') && i !== tailTokens.length - 1) {
      return null;
    }
  }

  if (tailTokens.length > 0 && tailTokens[tailTokens.length - 1].includes('.')) {
    const v4Token = tailTokens[tailTokens.length - 1];
    const v4Value = parseIPv4ToBigInt(v4Token);
    if (v4Value === null) {
      return null;
    }
    const highHextet = ((v4Value >> SIXTEEN) & HEXTET_MASK).toString(16);
    const lowHextet = (v4Value & HEXTET_MASK).toString(16);
    tailTokens.splice(tailTokens.length - 1, 1, highHextet, lowHextet);
  }

  let groups: string[];
  if (hasDoubleColon) {
    const missingZeros = 8 - (leftTokens.length + rightTokens.length);
    if (missingZeros < 1) {
      return null;
    }
    groups = [...leftTokens, ...Array<string>(missingZeros).fill('0'), ...rightTokens];
  } else {
    if (leftTokens.length !== 8) {
      return null;
    }
    groups = leftTokens;
  }

  let result = ZERO;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
      return null;
    }
    result = (result << SIXTEEN) | BigInt(parseInt(group, 16));
  }

  return result & IPV6_MAX;
}

function formatIPv4BigInt(value: bigint): string {
  const a = Number((value >> BigInt(24)) & BYTE_MASK);
  const b = Number((value >> SIXTEEN) & BYTE_MASK);
  const c = Number((value >> EIGHT) & BYTE_MASK);
  const d = Number(value & BYTE_MASK);
  return `${a}.${b}.${c}.${d}`;
}

function formatIPv6BigInt(value: bigint): string {
  const groups: number[] = [];
  for (let i = 7; i >= 0; i--) {
    groups.push(Number((value >> BigInt(i * 16)) & HEXTET_MASK));
  }

  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;

  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (curStart === -1) {
        curStart = i;
        curLen = 1;
      } else {
        curLen++;
      }
      if (curLen >= 2 && curLen > bestLen) {
        bestStart = curStart;
        bestLen = curLen;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }

  if (bestStart === -1) {
    return groups.map((g) => g.toString(16)).join(':');
  }

  const left = groups
    .slice(0, bestStart)
    .map((g) => g.toString(16))
    .join(':');
  const right = groups
    .slice(bestStart + bestLen)
    .map((g) => g.toString(16))
    .join(':');
  return `${left}::${right}`;
}

function createIPv4Cidr(networkLiteral: string, prefixLength: number): CidrBlock {
  const parsed = parseIPv4ToBigInt(networkLiteral);
  if (parsed === null || prefixLength < 0 || prefixLength > 32) {
    throw new Error(`Invalid IPv4 CIDR definition: ${networkLiteral}/${prefixLength}`);
  }
  const mask =
    prefixLength === 0 ? ZERO : ((IPV4_MAX << BigInt(32 - prefixLength)) & IPV4_MAX);
  return { network: parsed & mask, mask };
}

function createIPv6Cidr(networkLiteral: string, prefixLength: number): CidrBlock {
  const parsed = parseIPv6ToBigInt(networkLiteral);
  if (parsed === null || prefixLength < 0 || prefixLength > 128) {
    throw new Error(`Invalid IPv6 CIDR definition: ${networkLiteral}/${prefixLength}`);
  }
  const mask =
    prefixLength === 0 ? ZERO : ((IPV6_MAX << BigInt(128 - prefixLength)) & IPV6_MAX);
  return { network: parsed & mask, mask };
}

const RESTRICTED_IPV4_CIDRS: readonly CidrBlock[] = [
  createIPv4Cidr('0.0.0.0', 8), // "This network" (RFC 1122)
  createIPv4Cidr('10.0.0.0', 8), // Private-Use (RFC 1918)
  createIPv4Cidr('100.64.0.0', 10), // Carrier-Grade NAT / Shared Address Space (RFC 6598)
  createIPv4Cidr('127.0.0.0', 8), // Loopback (RFC 1122)
  createIPv4Cidr('169.254.0.0', 16), // Link-Local & Cloud Metadata (RFC 3927)
  createIPv4Cidr('172.16.0.0', 12), // Private-Use (RFC 1918)
  createIPv4Cidr('192.0.0.0', 24), // IETF Protocol Assignments (RFC 6890)
  createIPv4Cidr('192.0.2.0', 24), // Documentation TEST-NET-1 (RFC 5737)
  createIPv4Cidr('192.88.99.0', 24), // 6to4 Relay Anycast (RFC 7526)
  createIPv4Cidr('192.168.0.0', 16), // Private-Use (RFC 1918)
  createIPv4Cidr('198.18.0.0', 15), // Benchmarking (RFC 2544)
  createIPv4Cidr('198.51.100.0', 24), // Documentation TEST-NET-2 (RFC 5737)
  createIPv4Cidr('203.0.113.0', 24), // Documentation TEST-NET-3 (RFC 5737)
  createIPv4Cidr('224.0.0.0', 4), // Multicast (RFC 5771)
  createIPv4Cidr('240.0.0.0', 4), // Reserved & Limited Broadcast 255.255.255.255/32 (RFC 1112)
];

const RESTRICTED_IPV6_CIDRS: readonly CidrBlock[] = [
  createIPv6Cidr('::', 128), // Unspecified (RFC 4291)
  createIPv6Cidr('::1', 128), // Loopback (RFC 4291)
  createIPv6Cidr('::', 96), // IPv4-compatible transitional (RFC 4291)
  createIPv6Cidr('::ffff:0:0', 96), // IPv4-mapped transitional (RFC 4291)
  createIPv6Cidr('::ffff:0:0:0', 96), // SIIT IPv4-translated (RFC 2765)
  createIPv6Cidr('64:ff9b::', 96), // NAT64 Well-Known Prefix (RFC 6052)
  createIPv6Cidr('64:ff9b:1::', 48), // NAT64 Local-Use Prefix (RFC 8215)
  createIPv6Cidr('100::', 64), // Discard-Only Prefix (RFC 6666)
  createIPv6Cidr('2001::', 32), // Teredo tunneling (RFC 4380)
  createIPv6Cidr('2001:2::', 48), // Benchmarking (RFC 5180)
  createIPv6Cidr('2001::', 23), // IETF Protocol Assignments (RFC 6890)
  createIPv6Cidr('2001:db8::', 32), // Documentation (RFC 3849)
  createIPv6Cidr('2002::', 16), // 6to4 transitional (RFC 3056)
  createIPv6Cidr('fc00::', 7), // Unique Local (RFC 4193)
  createIPv6Cidr('fe80::', 10), // Link-Local Unicast (RFC 4291)
  createIPv6Cidr('fec0::', 10), // Deprecated Site-Local (RFC 3879)
  createIPv6Cidr('ff00::', 8), // Multicast (RFC 4291)
];

function matchesAnyCidr(value: bigint, cidrs: readonly CidrBlock[]): boolean {
  for (const cidr of cidrs) {
    if ((value & cidr.mask) === cidr.network) {
      return true;
    }
  }
  return false;
}

function isPrivateIPv4BigInt(value: bigint): boolean {
  return matchesAnyCidr(value, RESTRICTED_IPV4_CIDRS);
}

function isPrivateIPv6BigInt(value: bigint): boolean {
  return matchesAnyCidr(value, RESTRICTED_IPV6_CIDRS);
}

interface CanonicalParsedIp {
  family: 4 | 6;
  value: bigint;
  address: string;
}

function parseHostIpCandidate(rawHost: string): CanonicalParsedIp | 'invalid-ip' | null {
  const clean = rawHost.trim().replace(/^\[|\]$/g, '').trim();
  if (!clean) {
    return 'invalid-ip';
  }

  if (clean.includes(':')) {
    const v6 = parseIPv6ToBigInt(clean);
    if (v6 === null) {
      return 'invalid-ip';
    }
    return { family: 6, value: v6, address: formatIPv6BigInt(v6) };
  }

  const directV4 = parseIPv4ToBigInt(clean);
  if (directV4 !== null) {
    return { family: 4, value: directV4, address: formatIPv4BigInt(directV4) };
  }

  // Catch shorthand, octal, hex, trailing-dot, or integer IPv4 notations via WHATWG URL canonicalization
  try {
    const parsedUrl = new URL(`http://${clean}`);
    if (
      parsedUrl.username ||
      parsedUrl.password ||
      parsedUrl.port ||
      parsedUrl.pathname !== '/' ||
      parsedUrl.search ||
      parsedUrl.hash
    ) {
      return 'invalid-ip';
    }
    const normalizedHost = parsedUrl.hostname.replace(/\.$/, '');
    const normalizedV4 = parseIPv4ToBigInt(normalizedHost);
    if (normalizedV4 !== null) {
      return { family: 4, value: normalizedV4, address: formatIPv4BigInt(normalizedV4) };
    }
  } catch {
    return 'invalid-ip';
  }

  return null;
}

/**
 * Checks if a URL resolves to a private IP address to prevent SSRF.
 * @param url The URL to check.
 * @returns True if the URL is private/internal, false otherwise.
 */
export async function isPrivateUrl(url: string): Promise<boolean> {
  try {
    const parsedUrl = new URL(url);
    await validateAndResolveHost(parsedUrl.hostname);
    return false;
  } catch {
    // If we can't parse or resolve, treat as unsafe
    return true;
  }
}

/**
 * Resolves a hostname to IP addresses and ensures none are private/restricted.
 * Returns the first resolved public IP address (canonicalized) to pin the connection.
 * Throws an error if any address is private or if resolution fails.
 */
export async function validateAndResolveHost(hostname: string): Promise<ResolvedAddress> {
  const cleanHost = hostname.trim().replace(/^\[|\]$/g, '').trim();
  if (!cleanHost) {
    throw new Error(BLOCKED_HOST_MESSAGE);
  }

  const directIp = parseHostIpCandidate(cleanHost);
  if (directIp === 'invalid-ip') {
    throw new Error(BLOCKED_HOST_MESSAGE);
  }
  if (directIp !== null) {
    const isRestricted =
      directIp.family === 4
        ? isPrivateIPv4BigInt(directIp.value)
        : isPrivateIPv6BigInt(directIp.value);
    if (isRestricted) {
      throw new Error(BLOCKED_HOST_MESSAGE);
    }
    return { address: directIp.address, family: directIp.family };
  }

  let lookupResult: unknown;
  try {
    lookupResult = await dns.promises.lookup(cleanHost, { all: true });
  } catch {
    throw new Error(BLOCKED_HOST_MESSAGE);
  }

  const rawRecords = Array.isArray(lookupResult) ? lookupResult : [lookupResult];
  const validatedAddresses: ResolvedAddress[] = [];

  for (const record of rawRecords) {
    if (!record) {
      continue;
    }
    const rawAddr =
      typeof record === 'string'
        ? record
        : typeof record === 'object' && 'address' in record && typeof record.address === 'string'
          ? record.address
          : '';
    const cleanAddr = rawAddr.trim().replace(/^\[|\]$/g, '').trim();
    if (!cleanAddr) {
      continue;
    }

    if (cleanAddr.includes(':')) {
      const v6 = parseIPv6ToBigInt(cleanAddr);
      if (v6 === null || isPrivateIPv6BigInt(v6)) {
        throw new Error(BLOCKED_HOST_MESSAGE);
      }
      validatedAddresses.push({ address: formatIPv6BigInt(v6), family: 6 });
    } else {
      const v4 = parseIPv4ToBigInt(cleanAddr);
      if (v4 === null || isPrivateIPv4BigInt(v4)) {
        throw new Error(BLOCKED_HOST_MESSAGE);
      }
      validatedAddresses.push({ address: formatIPv4BigInt(v4), family: 4 });
    }
  }

  if (validatedAddresses.length === 0) {
    throw new Error(BLOCKED_HOST_MESSAGE);
  }

  return validatedAddresses[0];
}

export function isPrivateIP(ip: string): boolean {
  const candidate = parseHostIpCandidate(ip);
  if (candidate === null || candidate === 'invalid-ip') {
    return true;
  }
  return candidate.family === 4
    ? isPrivateIPv4BigInt(candidate.value)
    : isPrivateIPv6BigInt(candidate.value);
}
