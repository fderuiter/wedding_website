class ApiError extends Error {
  public status: number;
  public data: any;

  constructor(status: number, message: string, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
    this.name = 'ApiError';
  }
}

export interface ApiClientConfig {
  onUnauthorized?: () => void;
}

export class ApiClient {
  private config: ApiClientConfig;

  constructor(config: ApiClientConfig = {}) {
    this.config = config;
  }

  private async handleResponse<T>(res: Response): Promise<T> {
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

    // Unwrap the standard response format if present
    if (data && typeof data === 'object' && 'success' in data && 'data' in data) {
      return data.data as T;
    }

    return data as T;
  }

  async request<T = any>(url: string, options: RequestInit = {}): Promise<T> {
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

    const res = await fetch(url, fetchOptions);

    return this.handleResponse<T>(res);
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

  delete<T = any>(url: string, options?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
    return this.request<T>(url, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
