import dns from 'dns';

/**
 * Checks if a URL resolves to a private IP address to prevent SSRF.
 * @param url The URL to check.
 * @returns True if the URL is private/internal, false otherwise.
 */
export async function isPrivateUrl(url: string): Promise<boolean> {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname;

    // Direct IP literal checks in URL before DNS lookup
    if (isPrivateIPv4(hostname) || isPrivateIPv6(hostname)) {
      return true;
    }

    // Resolve hostname to IP(s) - lookup with all: true returns all A and AAAA records
    const lookupResult = await dns.promises.lookup(hostname, { all: true } as any);
    const addresses = Array.isArray(lookupResult) ? lookupResult : [lookupResult];

    if (addresses.length === 0) return true;

    for (const record of addresses) {
      if (!record) continue;
      const address = record.address || (typeof record === 'string' ? record : '');
      const family = record.family || (address.includes(':') ? 6 : 4);

      if (family === 4 && isPrivateIPv4(address)) {
        return true;
      }
      if (family === 6 && isPrivateIPv6(address)) {
        return true;
      }
    }

    return false;
  } catch {
    // If we can't parse or resolve, treat as unsafe
    return true;
  }
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p))) return false;

  const [a, b, c] = parts;

  // 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8
  if (a === 0 || a === 10 || a === 127) return true;

  // 169.254.0.0/16
  if (a === 169 && b === 254) return true;

  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;

  // 100.64.0.0/10 (CGNAT)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 0 && c === 2) return true;

  // 198.51.100.0/24 (TEST-NET-2)
  if (a === 198 && b === 51 && c === 100) return true;

  // 203.0.113.0/24 (TEST-NET-3)
  if (a === 203 && b === 0 && c === 113) return true;

  // Multicast 224.0.0.0/4 & Reserved 240.0.0.0/4
  if (a >= 224) return true;

  // Broadcast
  if (ip === '255.255.255.255') return true;

  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  if (normalized === '::1' || normalized === '::') return true;

  // fc00::/7 (Unique Local)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  // fe80::/10 (Link Local)
  if (['fe8', 'fe9', 'fea', 'feb'].some(prefix => normalized.startsWith(prefix))) return true;

  // ::ffff:0:0/96 (IPv4-mapped) - Block to avoid bypass complexity
  if (normalized.startsWith('::ffff:')) return true;

  return false;
}
