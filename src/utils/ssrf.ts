/**
 * Checks if a URL points to a private or loopback address.
 * This helps prevent Server-Side Request Forgery (SSRF) attacks.
 *
 * @param {string} url - The URL to check.
 * @returns {boolean} - True if the URL is private/unsafe, false otherwise.
 */
export function isPrivateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // Block localhost and loopback IPv6
    if (
      hostname === 'localhost' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      hostname === '0.0.0.0' ||
      hostname === '0'
    ) {
      return true;
    }

    // Block 127.0.0.0/8 (Loopback)
    if (hostname.startsWith('127.')) return true;

    // Block private IPv4 ranges
    // 10.0.0.0/8
    if (hostname.startsWith('10.')) return true;
    // 192.168.0.0/16
    if (hostname.startsWith('192.168.')) return true;
    // 172.16.0.0/12 (172.16.x.x - 172.31.x.x)
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)) return true;
    // 169.254.0.0/16 (Link-local / Cloud metadata)
    if (hostname.startsWith('169.254.')) return true;

    // Block "metadata.google.internal" and other common cloud metadata hostnames
    if (hostname === 'metadata.google.internal' || hostname === '169.254.169.254') return true;

    // Check for "localhost" or private IP disguised as other formats (basic check)
    // Note: This is not exhaustive against all bypasses (like octal/hex IPs), but covers common cases.

    return false;
  } catch {
    return true; // Fail safe on invalid URLs
  }
}
