import { ApiError } from '../utils/ApiError';

export { ApiError };

/**
 * @internal
 */
interface ApiClientConfig {
  onUnauthorized?: () => void;
}

export interface ApiPaginationMeta {
  totalCount?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
  hasNextPage?: boolean;
  hasPrevPage?: boolean;
  nextCursor?: string | null;
}

export interface ApiResponseWithMeta<T> {
  data: T;
  meta: ApiPaginationMeta;
}

const API_PAGINATION_META_SYMBOL = Symbol.for('wedding.apiClient.paginationMeta');

function parseHeaderInt(value: string | null | undefined): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseHeaderBool(value: string | null | undefined): boolean | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return undefined;
}

function extractPaginationMetaFromHeaders(headers?: Headers | Record<string, string> | null): ApiPaginationMeta {
  if (!headers) return {};

  const readHeader = (name: string): string | null => {
    if (typeof (headers as Headers).get === 'function') {
      return (headers as Headers).get(name);
    }
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(headers as Record<string, string>)) {
      if (k.toLowerCase() === lower && typeof v === 'string') {
        return v;
      }
    }
    return null;
  };

  const totalCount = parseHeaderInt(readHeader('x-total-count'));
  const page = parseHeaderInt(readHeader('x-page')) ?? parseHeaderInt(readHeader('x-current-page'));
  const limit = parseHeaderInt(readHeader('x-limit')) ?? parseHeaderInt(readHeader('x-per-page'));
  const totalPages = parseHeaderInt(readHeader('x-total-pages'));
  const hasNextPage = parseHeaderBool(readHeader('x-has-next-page'));
  const hasPrevPage = parseHeaderBool(readHeader('x-has-prev-page'));
  const rawNextCursor = readHeader('x-next-cursor');
  const nextCursor = rawNextCursor && rawNextCursor.trim() ? rawNextCursor.trim() : undefined;

  const meta: ApiPaginationMeta = {};
  if (totalCount !== undefined) meta.totalCount = totalCount;
  if (page !== undefined) meta.page = page;
  if (limit !== undefined) meta.limit = limit;
  if (totalPages !== undefined) meta.totalPages = totalPages;
  if (hasNextPage !== undefined) meta.hasNextPage = hasNextPage;
  if (hasPrevPage !== undefined) meta.hasPrevPage = hasPrevPage;
  if (nextCursor !== undefined) meta.nextCursor = nextCursor;
  return meta;
}

export function attachResponsePaginationMeta<T>(target: T, meta: ApiPaginationMeta): T {
  if (
    target &&
    typeof target === 'object' &&
    Object.keys(meta).length > 0
  ) {
    try {
      Object.defineProperty(target, API_PAGINATION_META_SYMBOL, {
        value: meta,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    } catch {
      // Frozen objects cannot receive symbols; callers can still use getWithMeta
    }
  }
  return target;
}

export function getResponsePaginationMeta(value: unknown): ApiPaginationMeta | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const attached = (value as Record<symbol, ApiPaginationMeta | undefined>)[API_PAGINATION_META_SYMBOL];
  if (attached && typeof attached === 'object') {
    return attached;
  }
  return undefined;
}

export class ApiClient {
  private config: ApiClientConfig;

  constructor(config: ApiClientConfig = {}) {
    this.config = config;
  }

  private async handleResponseWithMeta<T>(res: Response): Promise<ApiResponseWithMeta<T>> {
    let isJson = false;
    if (res.headers && typeof res.headers.get === 'function') {
      isJson = res.headers.get('content-type')?.includes('application/json') ?? false;
    } else {
      // Fallback for mocked fetch where headers might not be a proper Headers object
      isJson = true;
    }

    let data: any;
    if (isJson && typeof res.json === 'function') {
      data = await res.json();
    } else if (isJson && typeof res.text === 'function') {
      const rawText = await res.text();
      data = rawText ? JSON.parse(rawText) : {};
    } else if (!isJson && typeof res.text === 'function') {
      data = await res.text();
    } else {
      data = {};
    }

    if (!res.ok) {
      if (res.status === 401 && this.config.onUnauthorized) {
        this.config.onUnauthorized();
      }
      const message = (data && data.error) ? data.error : (data && data.message) ? data.message : res.statusText || 'API Error';
      throw new ApiError(res.status || 500, message, data);
    }

    const headerMeta = extractPaginationMetaFromHeaders(res.headers as Headers | undefined);

    // Unwrap the standard response format if present
    const unwrapped =
      data && typeof data === 'object' && 'success' in data && 'data' in data
        ? (data.data as T)
        : (data as T);

    const payloadTotal =
      unwrapped &&
      typeof unwrapped === 'object' &&
      !Array.isArray(unwrapped) &&
      typeof (unwrapped as unknown as { total?: unknown }).total === 'number'
        ? (unwrapped as unknown as { total: number }).total
        : data &&
            typeof data === 'object' &&
            !Array.isArray(data) &&
            typeof (data as { total?: unknown }).total === 'number'
          ? (data as { total: number }).total
          : undefined;

    const mergedMeta: ApiPaginationMeta = {
      ...(payloadTotal !== undefined ? { totalCount: payloadTotal } : {}),
      ...headerMeta,
    };

    attachResponsePaginationMeta(unwrapped, mergedMeta);

    return {
      data: unwrapped,
      meta: mergedMeta,
    };
  }

  private async handleResponse<T>(res: Response): Promise<T> {
    const result = await this.handleResponseWithMeta<T>(res);
    return result.data;
  }

  private buildFetchOptions(options: RequestInit = {}): RequestInit {
    const fetchOptions: RequestInit = { ...options };

    if (options.body && !(options.body instanceof FormData)) {
      if (!fetchOptions.headers) {
        fetchOptions.headers = { 'Content-Type': 'application/json' };
      } else if (fetchOptions.headers instanceof Headers) {
        if (!fetchOptions.headers.has('Content-Type')) {
          fetchOptions.headers.set('Content-Type', 'application/json');
        }
      } else if (Array.isArray(fetchOptions.headers)) {
        const hasContentType = fetchOptions.headers.some(([key]) => key.toLowerCase() === 'content-type');
        if (!hasContentType) {
          fetchOptions.headers.push(['Content-Type', 'application/json']);
        }
      } else {
        const headersRecord = fetchOptions.headers as Record<string, string>;
        const hasContentType = Object.keys(headersRecord).some(key => key.toLowerCase() === 'content-type');
        if (!hasContentType) {
          fetchOptions.headers = { ...headersRecord, 'Content-Type': 'application/json' };
        }
      }
    }

    return fetchOptions;
  }

  async requestWithMeta<T = any>(url: string, options: RequestInit = {}): Promise<ApiResponseWithMeta<T>> {
    const fetchOptions = this.buildFetchOptions(options);
    const res = await fetch(url, fetchOptions);
    return this.handleResponseWithMeta<T>(res);
  }

  async request<T = any>(url: string, options: RequestInit = {}): Promise<T> {
    const fetchOptions = this.buildFetchOptions(options);
    const res = await fetch(url, fetchOptions);
    return this.handleResponse<T>(res);
  }

  getWithMeta<T = any>(url: string, options?: Omit<RequestInit, 'method' | 'body'>): Promise<ApiResponseWithMeta<T>> {
    return this.requestWithMeta<T>(url, { ...options, method: 'GET' });
  }

  get<T = any>(url: string, options?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
    return this.request<T>(url, { ...options, method: 'GET' });
  }

  post<T = any>(url: string, data?: any, options?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
    const isFormData = data instanceof FormData;
    return this.request<T>(url, {
      ...options,
      method: 'POST',
      body: isFormData ? data : (data ? JSON.stringify(data) : undefined)
    });
  }

  put<T = any>(url: string, data?: any, options?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
    const isFormData = data instanceof FormData;
    return this.request<T>(url, {
      ...options,
      method: 'PUT',
      body: isFormData ? data : (data ? JSON.stringify(data) : undefined)
    });
  }

  patch<T = any>(url: string, data?: any, options?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
    const isFormData = data instanceof FormData;
    return this.request<T>(url, {
      ...options,
      method: 'PATCH',
      body: isFormData ? data : (data ? JSON.stringify(data) : undefined)
    });
  }

  delete<T = any>(url: string, data?: any, options?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
    if (data && (data.headers || data.signal || data.credentials || data.mode) && !data.ids && !data.data) {
      return this.request<T>(url, { ...data, method: 'DELETE' });
    }
    const isFormData = data instanceof FormData;
    return this.request<T>(url, {
      ...options,
      method: 'DELETE',
      body: isFormData ? data : (data ? JSON.stringify(data) : undefined)
    });
  }
}

export const apiClient = new ApiClient();
