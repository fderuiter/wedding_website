import {
  hydrateDemoStateFromStorage,
  isDemoRuntimeActive,
  setDemoRuntimeActive,
} from './demoStore';
import {
  type DemoRouteContext,
  jsonResponse,
  resolveApiPathname,
} from './router/http';
import { handlePublicAndWeatherRoutes } from './router/publicWeatherRoutes';
import { handleGuestRoutes } from './router/guestRoutes';
import { handleRegistryAndThankYouRoutes } from './router/registryRoutes';
import { handleMediaAndPhotoRoutes } from './router/mediaRoutes';
import { handleAdminWorkflowRoutes } from './router/adminWorkflowRoutes';
import { handleAdminEntityRoutes } from './router/entityEngine';

type DemoRouteHandler = (ctx: DemoRouteContext) => Promise<Response | null>;

const DEMO_ROUTE_PIPELINE: ReadonlyArray<DemoRouteHandler> = [
  handlePublicAndWeatherRoutes,
  handleGuestRoutes,
  handleRegistryAndThankYouRoutes,
  handleMediaAndPhotoRoutes,
  handleAdminWorkflowRoutes,
  handleAdminEntityRoutes,
];

async function dispatchDemoApiRequest(
  url: URL,
  init?: RequestInit,
  rawInput?: RequestInfo | URL
): Promise<Response> {
  const method = (init?.method || (rawInput instanceof Request ? rawInput.method : 'GET') || 'GET')
    .toUpperCase();
  const ctx: DemoRouteContext = {
    url,
    path: url.pathname,
    method,
    init,
    rawInput,
  };

  for (const handler of DEMO_ROUTE_PIPELINE) {
    const response = await handler(ctx);
    if (response) {
      return response;
    }
  }

  return jsonResponse(
    {
      success: false,
      error: `Demo endpoint not implemented: ${method} ${url.pathname}`,
    },
    404
  );
}

let activeInterceptCount = 0;
let originalFetchRef: typeof window.fetch | null = null;

export function installDemoFetchInterceptor(): () => void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return () => {};
  }

  activeInterceptCount += 1;
  if (activeInterceptCount === 1) {
    originalFetchRef = window.fetch.bind(window);
    const fallbackFetch = originalFetchRef;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (isDemoRuntimeActive()) {
        const apiUrl = resolveApiPathname(input);
        if (apiUrl) {
          if (init?.signal?.aborted) {
            throw new DOMException('The operation was aborted.', 'AbortError');
          }
          return dispatchDemoApiRequest(apiUrl, init, input);
        }
      }
      return fallbackFetch(input, init);
    };
  }

  return () => {
    activeInterceptCount = Math.max(0, activeInterceptCount - 1);
    if (activeInterceptCount === 0 && originalFetchRef) {
      window.fetch = originalFetchRef;
      originalFetchRef = null;
    }
  };
}

let primedInterceptorCleanup: (() => void) | null = null;

export function primeDemoRuntimeForMount(): void {
  if (typeof window === 'undefined') return;
  if (!isDemoRuntimeActive()) {
    hydrateDemoStateFromStorage();
    setDemoRuntimeActive(true);
  }
  if (!primedInterceptorCleanup && activeInterceptCount === 0) {
    primedInterceptorCleanup = installDemoFetchInterceptor();
  }
}

export function consumePrimedDemoFetchInterceptor(): (() => void) | null {
  const cleanup = primedInterceptorCleanup;
  primedInterceptorCleanup = null;
  return cleanup;
}
