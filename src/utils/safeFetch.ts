import { isPrivateUrl } from './ssrf';

/**
 * Safely fetches a URL by manually following redirects and validating each hop against SSRF.
 * Protects against Server-Side Request Forgery (SSRF) and infinite redirect loops.
 *
 * @param url The target URL to fetch.
 * @param options Standard Fetch API request options.
 * @returns The final Response object.
 */
export async function safeFetch(url: string, options: RequestInit = {}): Promise<Response> {
  let currentUrl = url;
  const maxRedirects = 5;
  let hops = 0;
  let currentOptions = { ...options };

  while (true) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(currentUrl);
    } catch {
      throw new Error('Invalid URL');
    }

    // Protocol Guardrail
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('Blocked: Only HTTP and HTTPS protocols are allowed');
    }

    // SSRF Guardrail
    if (await isPrivateUrl(currentUrl)) {
      throw new Error('Blocked: URL resolves to a private or restricted IP address');
    }

    // Override redirect to manual so we can intercept each hop
    const fetchOptions: RequestInit = {
      ...currentOptions,
      redirect: 'manual',
    };

    const res = await fetch(currentUrl, fetchOptions);

    // If it's a redirect, handle manually
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      hops++;
      if (hops > maxRedirects) {
        throw new Error('Blocked: Too many redirects (maximum of 5 hops allowed)');
      }

      const location = res.headers.get('location');
      if (!location) {
        // Redirect status but no location header, return standard response
        return res;
      }

      // Resolve relative redirect location relative to the current URL
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        throw new Error('Blocked: Redirect to an invalid URL');
      }

      // For standard redirects (301, 302, 303), change method to GET and remove body, per HTTP spec
      if ([301, 302, 303].includes(res.status)) {
        currentOptions = {
          ...currentOptions,
          method: 'GET',
          body: undefined,
        };
      }
    } else {
      // Return the final successful non-redirect response
      return res;
    }
  }
}
