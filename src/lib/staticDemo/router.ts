import type { StaticDemoRouterOptions } from './types';
import { normalizeDemoRequest } from './url';
import { errorJson } from './responseHelpers';
import { handlePublicRoutes } from './handlers/publicHandlers';
import { handleRegistryRoutes } from './handlers/registryHandlers';
import { handleAdminWorkflowRoutes } from './handlers/adminWorkflowHandlers';
import { handleAdminEntityRoutes } from './handlers/adminEntityHandlers';

export type StaticDemoRequestHandler = (
  _input: RequestInfo | URL,
  _init?: RequestInit,
) => Promise<Response | null>;

/**
 * Creates a pure, isomorphic `Request -> Promise<Response | null>` router backed by
 * a `StaticDemoStore`. Returns `null` when a request does not target an `/api/*` route
 * (or targets a third-party external URL), allowing callers (`window.fetch` or MSW)
 * to pass non-API requests through untouched.
 */
export function createStaticDemoRouter(
  options: StaticDemoRouterOptions,
): StaticDemoRequestHandler {
  const mode = options.mode ?? 'browser';

  return async function routeStaticDemoRequest(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response | null> {
    const normalized = normalizeDemoRequest(input, init, {
      basePath: options.basePath,
      mode,
    });
    if (!normalized) {
      return null;
    }

    if (normalized.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          Allow: 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'x-api-version': 'v2',
        },
      });
    }

    try {
      const publicResponse = await handlePublicRoutes(normalized, options.store);
      if (publicResponse) return publicResponse;

      const registryResponse = await handleRegistryRoutes(
        normalized,
        options.store,
        mode,
      );
      if (registryResponse) return registryResponse;

      // Run specialized admin & media workflow routes BEFORE generic /api/admin/[entity]/[id]
      const workflowResponse = await handleAdminWorkflowRoutes(
        normalized,
        options.store,
      );
      if (workflowResponse) return workflowResponse;

      const entityResponse = await handleAdminEntityRoutes(
        normalized,
        options.store,
      );
      if (entityResponse) return entityResponse;

      if (mode === 'msw') {
        return null;
      }

      return errorJson(
        404,
        `Static demo endpoint not found: ${normalized.method} ${normalized.pathname}`,
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unexpected static demo router error';
      return errorJson(500, message);
    }
  };
}
