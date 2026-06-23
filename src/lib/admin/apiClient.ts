export class ApiError extends Error {
  public status: number;
  public data: any;

  constructor(status: number, message: string, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
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
    if (res.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('isAdminLoggedIn');
      window.dispatchEvent(new Event('storage'));
      window.location.href = '/admin/login';
    }
    const message = (data && data.error) ? data.error : (data && data.message) ? data.message : res.statusText || 'API Error';
    throw new ApiError(res.status || 500, message, data);
  }

  return data as T;
}

export const apiClient = {
  async request<T = any>(url: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers || {});
    
    if (options.body && !(options.body instanceof FormData)) {
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
    }

    const res = await fetch(url, {
      ...options,
      headers
    });

    return handleResponse<T>(res);
  },

  get<T = any>(url: string, options?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
    return this.request<T>(url, { ...options, method: 'GET' });
  },

  post<T = any>(url: string, data?: any, options?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
    const isFormData = data instanceof FormData;
    return this.request<T>(url, {
      ...options,
      method: 'POST',
      body: isFormData ? data : (data ? JSON.stringify(data) : undefined)
    });
  },

  put<T = any>(url: string, data?: any, options?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
    const isFormData = data instanceof FormData;
    return this.request<T>(url, {
      ...options,
      method: 'PUT',
      body: isFormData ? data : (data ? JSON.stringify(data) : undefined)
    });
  },

  delete<T = any>(url: string, options?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
    return this.request<T>(url, { ...options, method: 'DELETE' });
  }
};
