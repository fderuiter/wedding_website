export interface JsonResponseOptions {
  status?: number;
  headers?: Record<string, string>;
}

/**
 * Mirrors `src/utils/withApiMiddleware.ts` JSON envelope normalization so both
 * `apiClient` (which unwraps `{ success: true, data }`) and raw `fetch()` callers
 * receive the exact server-equivalent payload structure.
 */
export function wrapMiddlewareJson(
  payload: unknown,
  options: JsonResponseOptions = {},
): Response {
  const status = options.status ?? 200;
  const headers = new Headers({
    'Content-Type': 'application/json',
    'x-api-version': 'v2',
    ...(options.headers ?? {}),
  });

  if (status >= 400) {
    const record =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
    const errorMessage =
      typeof record.error === 'string'
        ? record.error
        : typeof record.message === 'string'
          ? record.message
          : 'API Error';
    const errorBody: Record<string, unknown> = {
      success: false,
      error: errorMessage,
      ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
      ...(typeof record.valid === 'boolean' ? { valid: record.valid } : {}),
      ...(record.details !== undefined ? { details: record.details } : {}),
      ...(record.helpPrompt !== undefined ? { helpPrompt: record.helpPrompt } : {}),
    };
    return new Response(JSON.stringify(errorBody), { status, headers });
  }

  if (
    payload !== null &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    'success' in (payload as Record<string, unknown>)
  ) {
    return new Response(JSON.stringify(payload), { status, headers });
  }

  return new Response(
    JSON.stringify({
      success: true,
      data: payload,
    }),
    { status, headers },
  );
}

export function errorJson(
  status: number,
  error: string,
  extra?: Record<string, unknown>,
): Response {
  return wrapMiddlewareJson(
    {
      error,
      ...(extra ?? {}),
    },
    { status },
  );
}

export function binaryResponse(
  content: Uint8Array | string,
  contentType: string,
  headers: Record<string, string> = {},
  status = 200,
): Response {
  const resHeaders = new Headers({
    'Content-Type': contentType,
    'x-api-version': 'v2',
    ...headers,
  });
  if (typeof content === 'string') {
    return new Response(content, { status, headers: resHeaders });
  }
  const copy = new Uint8Array(content.byteLength);
  copy.set(content);
  return new Response(copy.buffer, { status, headers: resHeaders });
}

export async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

let idCounter = 1;

export function generateDemoId(prefix: string): string {
  idCounter += 1;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}
