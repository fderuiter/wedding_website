import { isProtectedRoute, normalizePath } from '../routes';

describe('routes', () => {
  describe('normalizePath', () => {
    it('should strip single and multiple trailing slashes', () => {
      expect(normalizePath('/api/registry/add-item')).toBe('/api/registry/add-item');
      expect(normalizePath('/api/registry/add-item/')).toBe('/api/registry/add-item');
      expect(normalizePath('/api/registry/add-item//')).toBe('/api/registry/add-item');
      expect(normalizePath('/')).toBe('/');
      expect(normalizePath('///')).toBe('/');
      expect(normalizePath('')).toBe('');
    });
  });

  describe('isProtectedRoute', () => {
    it('should test media routes correctly', () => {
      expect(isProtectedRoute('/api/media', 'GET')).toBe(false);
      expect(isProtectedRoute('/api/media', 'POST')).toBe(true);
      expect(isProtectedRoute('/api/media/123', 'GET')).toBe(false);
      expect(isProtectedRoute('/api/media/123', 'PUT')).toBe(true);
      expect(isProtectedRoute('/api/media/123', 'DELETE')).toBe(true);
    });

    it('should normalize evaluated request paths with trailing slashes prior to matching', () => {
      // /api/registry/add-item is exact: true, admin route.
      // /api/registry/add-item/ with trailing slash should be recognized as protected.
      expect(isProtectedRoute('/api/registry/add-item/', 'POST')).toBe(true);
      expect(isProtectedRoute('/api/registry/add-item//', 'POST')).toBe(true);
    });

    it('should correctly handle trailing slashes on prefix-based protected routes', () => {
      // /admin/dashboard is exact: false, admin route.
      expect(isProtectedRoute('/admin/dashboard/', 'GET')).toBe(true);
      expect(isProtectedRoute('/admin/dashboard//', 'GET')).toBe(true);
    });

    it('should maintain route selection specificity based on path complexity after normalization', () => {
      // /api/admin/login is exact: true, public route.
      // /api/admin is exact: false, admin route.
      // A request to /api/admin/login/ has complexity matching /api/admin/login (more specific)
      // and should therefore NOT be protected (since login is public).
      expect(isProtectedRoute('/api/admin/login/', 'POST')).toBe(false);
      expect(isProtectedRoute('/api/admin/login', 'POST')).toBe(false);

      // A request to any other path under /api/admin should match the prefix route and be protected
      expect(isProtectedRoute('/api/admin/other-action', 'POST')).toBe(true);
      expect(isProtectedRoute('/api/admin/other-action/', 'POST')).toBe(true);
    });

    it('should correctly handle the root path', () => {
      expect(isProtectedRoute('/', 'GET')).toBe(false);
      expect(isProtectedRoute('///', 'GET')).toBe(false);
    });
  });
});

