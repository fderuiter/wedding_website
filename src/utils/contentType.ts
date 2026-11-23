import { ApiError } from './ApiError';

interface HeaderAwareRequest {
  headers?: {
    get?: (_name: string) => string | null;
  };
  json: () => Promise<unknown>;
  text?: () => Promise<string>;
  clone?: () => HeaderAwareRequest;
}

export interface ParseJsonBodyOptions {
  allowEmpty?: boolean;
  invalidJsonMessage?: string;
}

export const UNSUPPORTED_JSON_MEDIA_TYPE_MESSAGE =
  'Unsupported Media Type: Content-Type must be application/json';

/**
 * Extracts the lowercase media-type essence (e.g. `application/json`) from a request's
 * `Content-Type` header, stripping optional parameters such as `; charset=utf-8`.
 */
export function getRequestMediaType(req: {
  headers?: { get?: (_name: string) => string | null };
}): string | null {
  const raw = typeof req?.headers?.get === 'function' ? req.headers.get('content-type') : null;
  if (!raw || !raw.trim()) {
    return null;
  }
  const essence = raw.split(';')[0]?.trim().toLowerCase() || '';
  return essence || null;
}

export function isJsonMediaType(mediaType: string | null): boolean {
  return mediaType === 'application/json';
}

/**
 * Requires `Content-Type: application/json` before parsing a JSON request body,
 * throwing `ApiError(415)` otherwise.
 */
export function assertJsonContentType(req: {
  headers?: { get?: (_name: string) => string | null };
}): void {
  const mediaType = getRequestMediaType(req);
  if (!isJsonMediaType(mediaType)) {
    throw new ApiError(415, UNSUPPORTED_JSON_MEDIA_TYPE_MESSAGE);
  }
}

/**
 * Validates `Content-Type: application/json` and parses the JSON body.
 * When `allowEmpty` is `true`, requests with no `Content-Type` header and an empty body
 * resolve to `{}` while non-empty bodies or non-JSON media types still throw `ApiError(415)`.
 */
export async function parseJsonRequestBody<T = unknown>(
  req: HeaderAwareRequest,
  options?: ParseJsonBodyOptions
): Promise<T> {
  const mediaType = getRequestMediaType(req);

  if (options?.allowEmpty && mediaType === null) {
    const contentLength =
      typeof req?.headers?.get === 'function' ? req.headers.get('content-length')?.trim() : null;
    if (contentLength === '0') {
      return {} as T;
    }

    if (typeof req.text === 'function') {
      const reader = typeof req.clone === 'function' ? req.clone() : req;
      const rawText = typeof reader.text === 'function' ? await reader.text() : '';
      if (!rawText || !rawText.trim()) {
        return {} as T;
      }
      throw new ApiError(415, UNSUPPORTED_JSON_MEDIA_TYPE_MESSAGE);
    }

    try {
      const parsed = await req.json();
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        Object.keys(parsed as Record<string, unknown>).length === 0
      ) {
        return {} as T;
      }
    } catch {
      return {} as T;
    }

    throw new ApiError(415, UNSUPPORTED_JSON_MEDIA_TYPE_MESSAGE);
  }

  assertJsonContentType(req);

  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, options?.invalidJsonMessage ?? 'Invalid JSON payload');
  }
}
