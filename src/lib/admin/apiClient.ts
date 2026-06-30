import { ApiClient, ApiError } from '../apiClient';

export { ApiError };

export const apiClient = new ApiClient({
  onUnauthorized: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('isAdminLoggedIn');
      window.dispatchEvent(new Event('storage'));
      window.location.href = '/admin/login';
    }
  }
});
