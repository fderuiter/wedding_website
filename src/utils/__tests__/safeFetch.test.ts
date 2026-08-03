import { safeFetch } from '../safeFetch';
import dns from 'dns';

// Mock DNS for SSRF check
jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn(),
  },
}));

describe('safeFetch', () => {
  const mockLookup = dns.promises.lookup as jest.Mock;
  const originalFetch = global.fetch;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();
    mockFetch = jest.fn();
    global.fetch = mockFetch;

    // Default DNS lookup behavior is public IP (8.8.8.8)
    mockLookup.mockResolvedValue({ address: '8.8.8.8', family: 4 });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('should successfully resolve a direct public URL', async () => {
    const mockResponse = new Response('OK', { status: 200 });
    mockFetch.mockResolvedValueOnce(mockResponse);

    const res = await safeFetch('https://example.com/item');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/item', expect.objectContaining({
      redirect: 'manual',
    }));
  });

  it('should block a direct private URL', async () => {
    // DNS returns a private IP
    mockLookup.mockResolvedValue({ address: '127.0.0.1', family: 4 });

    await expect(safeFetch('https://localhost/item')).rejects.toThrow(
      'Blocked: URL resolves to a private or restricted IP address'
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should block invalid protocols', async () => {
    await expect(safeFetch('ftp://example.com/item')).rejects.toThrow(
      'Blocked: Only HTTP and HTTPS protocols are allowed'
    );
    await expect(safeFetch('javascript:alert(1)')).rejects.toThrow(
      'Blocked: Only HTTP and HTTPS protocols are allowed'
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should follow a standard redirect hop to a public URL', async () => {
    // Hop 1: Redirect to another public URL
    mockFetch.mockResolvedValueOnce(new Response('', {
      status: 302,
      headers: { location: 'https://example.com/target' },
    }));
    // Hop 2: Final destination
    mockFetch.mockResolvedValueOnce(new Response('Final content', { status: 200 }));

    const res = await safeFetch('https://example.com/redirect');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('Final content');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(1, 'https://example.com/redirect', expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(2, 'https://example.com/target', expect.any(Object));
  });

  it('should follow relative redirects correctly', async () => {
    mockFetch.mockResolvedValueOnce(new Response('', {
      status: 301,
      headers: { location: '/relative-path' },
    }));
    mockFetch.mockResolvedValueOnce(new Response('Relative target content', { status: 200 }));

    const res = await safeFetch('https://example.com/redirect');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('Relative target content');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(2, 'https://example.com/relative-path', expect.any(Object));
  });

  it('should block redirects if they point to private IPs', async () => {
    // First hop is allowed
    mockFetch.mockResolvedValueOnce(new Response('', {
      status: 302,
      headers: { location: 'https://internal-service/admin' },
    }));

    // DNS lookup behavior: first is public, second (for internal-service) is private
    mockLookup
      .mockResolvedValueOnce({ address: '8.8.8.8', family: 4 }) // For example.com/redirect
      .mockResolvedValueOnce({ address: '10.0.0.1', family: 4 }); // For internal-service/admin

    await expect(safeFetch('https://example.com/redirect')).rejects.toThrow(
      'Blocked: URL resolves to a private or restricted IP address'
    );
    expect(mockFetch).toHaveBeenCalledTimes(1); // Blocked before second fetch
  });

  it('should limit redirects to a maximum of 5 hops', async () => {
    // Return 6 redirects in a row
    for (let i = 1; i <= 6; i++) {
      mockFetch.mockResolvedValueOnce(new Response('', {
        status: 302,
        headers: { location: `https://example.com/redirect${i}` },
      }));
    }

    await expect(safeFetch('https://example.com/start')).rejects.toThrow(
      'Blocked: Too many redirects (maximum of 5 hops allowed)'
    );
    expect(mockFetch).toHaveBeenCalledTimes(6); // 1 start + 5 redirects = 6 fetch attempts, 6th redirect is blocked
  });
});
