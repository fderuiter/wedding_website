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

    // Resolve hostname to IP
    const { address, family } = await dns.promises.lookup(hostname);

    if (family === 4) {
      return isPrivateIPv4(address);
    } else if (family === 6) {
      return isPrivateIPv6(address);
    }

    return true; // Unknown family, safer to block
  } catch {
    // If we can't parse or resolve, treat as unsafe
    return true;
  }
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;

  const [a, b] = parts;

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
