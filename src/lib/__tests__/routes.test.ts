import { isProtectedRoute } from '../routes';

describe('routes', () => {
  it('should test media routes correctly', () => {
    expect(isProtectedRoute('/api/media', 'GET')).toBe(false);
    expect(isProtectedRoute('/api/media', 'POST')).toBe(true);
    expect(isProtectedRoute('/api/media/123', 'GET')).toBe(false);
    expect(isProtectedRoute('/api/media/123', 'PUT')).toBe(true);
    expect(isProtectedRoute('/api/media/123', 'DELETE')).toBe(true);
  });
});
