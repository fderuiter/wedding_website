import { validateAndResolveHost } from './ssrf';
import { Agent, type Dispatcher } from 'undici';

interface LegacyUndiciV6Handler {
  onConnect?: (abort: (err?: Error) => void, context?: unknown) => void;
  onRequestSent?: () => void;
  onBodySent?: (chunk: unknown) => void;
  onHeaders?: (
    statusCode: number,
    rawHeaders: Buffer[],
    resume: () => void,
    statusMessage: string
  ) => boolean | void;
  onData?: (chunk: Uint8Array) => boolean | void;
  onComplete?: (rawTrailers: string[] | null) => void;
  onError?: (err: Error) => void;
}

function adaptDispatchHandler(
  handler: Dispatcher.DispatchHandler
): Dispatcher.DispatchHandler {
  if (!handler || typeof handler.onRequestStart === 'function') {
    return handler;
  }
  const legacy = handler as unknown as LegacyUndiciV6Handler;
  return {
    onRequestStart(controller, context) {
      legacy.onConnect?.((err) => controller.abort(err ?? new Error('Request aborted')), context);
    },
    onRequestSent() {
      legacy.onRequestSent?.();
    },
    onBodySent(chunk) {
      legacy.onBodySent?.(chunk);
    },
    onResponseStart(controller, statusCode, headers, statusMessage) {
      const ctrlWithRaw = controller as Dispatcher.DispatchController & {
        rawHeaders?: Buffer[];
      };
      const rawHeaders =
        ctrlWithRaw.rawHeaders ??
        Object.entries(headers || {}).flatMap(([key, val]) =>
          Array.isArray(val)
            ? val.flatMap((item) => [Buffer.from(key), Buffer.from(String(item))])
            : [Buffer.from(key), Buffer.from(String(val ?? ''))]
        );
      const shouldContinue = legacy.onHeaders?.(
        statusCode,
        rawHeaders,
        () => controller.resume(),
        statusMessage ?? ''
      );
      if (shouldContinue === false) {
        controller.pause();
      }
    },
    onResponseData(controller, chunk) {
      const shouldContinue = legacy.onData?.(chunk);
      if (shouldContinue === false) {
        controller.pause();
      }
    },
    onResponseEnd(controller) {
      const ctrlWithRaw = controller as Dispatcher.DispatchController & {
        rawTrailers?: string[];
      };
      legacy.onComplete?.(ctrlWithRaw.rawTrailers ?? []);
    },
    onResponseError(_controller, err) {
      legacy.onError?.(err);
    },
  };
}

/**
 * Creates an undici Agent that pins the socket connection to a specific resolved IP.
 * Standard HTTP headers (e.g. Host) and TLS SNI continue to use the original hostname.
 */
export function createPinnedDispatcher(address: string, family: number): Agent {
  const agent = new Agent({
    connect: {
      lookup: (_hostname, opts, cb) => {
        let callback = cb;
        let options = opts;
        if (typeof options === 'function') {
          callback = options;
          options = {};
        }
        if (options && options.all) {
          callback(null, [{ address, family }]);
        } else {
          callback(null, address, family);
        }
      },
    },
  });
  const originalDispatch = agent.dispatch.bind(agent);
  agent.dispatch = (opts, handler) =>
    originalDispatch(opts, adaptDispatchHandler(handler));
  return agent;
}

/**
 * Safely fetches a URL by manually following redirects and validating each hop against SSRF.
 * Protects against Server-Side Request Forgery (SSRF) and DNS rebinding by pinning the
 * socket connection to the pre-validated public IP address via an undici dispatcher.
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

    // SSRF Guardrail & IP Resolution:
    // Resolves hostname to IP(s) and ensures no addresses belong to private/restricted ranges.
    const pinned = await validateAndResolveHost(parsedUrl.hostname);

    // Create a custom undici dispatcher that binds the connection to the validated IP
    const dispatcher = createPinnedDispatcher(pinned.address, pinned.family);

    // Override redirect to manual so we can intercept each hop and pin IP per hop
    const fetchOptions: RequestInit & { dispatcher?: Agent } = {
      ...currentOptions,
      redirect: 'manual',
      dispatcher,
    };

    let res: Response;
    try {
      res = await fetch(currentUrl, fetchOptions as RequestInit);
    } finally {
      dispatcher.close().catch(() => {});
    }

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
