import { stripBasePath, withBasePath } from '@/utils/basePath';
import { getDemoState } from './store';
import { routeDemoApiRequest } from './apiRouter';

let installed = false;
let swRegistered = false;

function triggerBlobDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}

function extractFilenameFromHeaders(headers: Headers, fallbackPath: string): string {
  const disposition = headers.get('Content-Disposition');
  if (disposition) {
    const match = disposition.match(/filename="?([^";]+)"?/i);
    if (match?.[1]) return match[1];
  }
  const clean = fallbackPath.split('?')[0].split('/').filter(Boolean).pop() || 'download';
  return clean.includes('.') ? clean : `${clean}.txt`;
}

async function downloadDemoEndpoint(url: string): Promise<boolean> {
  const res = await routeDemoApiRequest(url, { method: 'GET' });
  if (!res) return false;
  const blob = await res.blob();
  const filename = extractFilenameFromHeaders(res.headers, url);
  triggerBlobDownload(blob, filename);
  return true;
}

export async function handleDemoFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  originalFetch: typeof window.fetch
): Promise<Response> {
  const routed = await routeDemoApiRequest(input, init);
  if (routed) {
    return routed;
  }
  return originalFetch(input, init);
}

export function installDemoBrowserRuntime(): void {
  if (typeof window === 'undefined') return;

  document.documentElement.dataset.staticDemo = 'true';

  const initialState = getDemoState();
  try {
    if (initialState.isAdmin) {
      window.localStorage.setItem('isAdminLoggedIn', 'true');
    }
  } catch {
    // Ignore storage errors
  }

  if (!installed) {
    installed = true;
    const win = window as Window & { __WEDDING_NATIVE_FETCH__?: typeof window.fetch };
    const nativeFetch = win.__WEDDING_NATIVE_FETCH__ ?? window.fetch.bind(window);
    win.__WEDDING_NATIVE_FETCH__ = nativeFetch;
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
      handleDemoFetch(input, init, nativeFetch);

    const nativeOpen = window.open?.bind(window);
    if (nativeOpen) {
      window.open = ((url?: string | URL, target?: string, features?: string): Window | null => {
        if (url) {
          const raw = typeof url === 'string' ? url : url.toString();
          try {
            const parsed = new URL(raw, window.location.origin);
            if (
              parsed.origin === window.location.origin &&
              stripBasePath(parsed.pathname).startsWith('/api/')
            ) {
              void downloadDemoEndpoint(parsed.toString());
              return null;
            }
          } catch {
            // Fall through to native window.open
          }
        }
        return nativeOpen(url, target, features);
      }) as typeof window.open;
    }

    document.addEventListener(
      'click',
      (event) => {
        if (event.defaultPrevented) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        const anchor = target.closest('a[href]');
        if (!anchor) return;
        const href = anchor.getAttribute('href');
        if (!href) return;
        try {
          const parsed = new URL(href, window.location.origin);
          if (
            parsed.origin === window.location.origin &&
            stripBasePath(parsed.pathname).startsWith('/api/')
          ) {
            event.preventDefault();
            void downloadDemoEndpoint(parsed.toString());
          }
        } catch {
          // Ignore malformed href
        }
      },
      true
    );
  }

  if (
    !swRegistered &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof navigator.serviceWorker?.register === 'function'
  ) {
    swRegistered = true;
    const swUrl = withBasePath('/mockServiceWorker.js');
    const scope = `${withBasePath('/')}`;
    navigator.serviceWorker
      .register(swUrl, { scope })
      .catch(() => {
        // Fetch interceptor remains active when Service Worker registration is unavailable
      });
  }
}
