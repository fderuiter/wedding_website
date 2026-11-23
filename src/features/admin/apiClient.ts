import { ApiClient } from '@/lib/apiClient';
import { withBasePath } from '@/lib/basePath';


export const apiClient = new ApiClient({
  onUnauthorized: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('isAdminLoggedIn');
      window.dispatchEvent(new Event('storage'));
      window.location.href = withBasePath('/admin/login');
    }
  }
});
