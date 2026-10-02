import { FeatureId, isFeatureEnabled } from './modules';

/**
 * @internal
 */
type RouteRole = 'admin' | 'public';

/**
 * @internal
 */
interface AppRoute {
  path: string;
  label?: string;
  roles: RouteRole[];
  exact?: boolean;
  methods?: string[]; // e.g., ['PUT', 'DELETE']
  showInNav?: boolean;
  requiredModule?: FeatureId;
}

const APP_ROUTES: AppRoute[] = [
  // Navigation Links
  { path: '/', label: 'Home', roles: ['public', 'admin'], showInNav: true, exact: true },
  { path: '/registry', label: 'Registry', roles: ['public', 'admin'], showInNav: true, exact: true, requiredModule: 'registry' },
  { path: '/photos', label: 'Photos', roles: ['public', 'admin'], showInNav: true, requiredModule: 'gallery' },
  { path: '/wedding-party', label: 'Wedding Party', roles: ['public', 'admin'], showInNav: true, requiredModule: 'weddingParty' },
  { path: '/things-to-do', label: 'Things to Do', roles: ['public', 'admin'], showInNav: true, requiredModule: 'attractions' },
  { path: '/weather', label: 'Weather', roles: ['public', 'admin'], showInNav: true, requiredModule: 'weather' },
  { path: '/heart', label: 'Heart 3D', roles: ['public', 'admin'], showInNav: false, requiredModule: 'interactive3D' },
  { path: '/archive', label: 'Archive', roles: ['public', 'admin'], showInNav: true },
  
  // Admin Navigation
  { path: '/admin/dashboard', label: 'Dashboard', roles: ['admin'], showInNav: true, exact: false },
  
  // Protected UI Routes
  { path: '/registry/add-item', roles: ['admin'], exact: false, requiredModule: 'registry' },
  { path: '/registry/edit-item', roles: ['admin'], exact: false, requiredModule: 'registry' },

  // API Admin Routes (Unprotected)
  { path: '/api/admin/setup', roles: ['public', 'admin'], exact: true },
  { path: '/api/admin/login', roles: ['public', 'admin'], exact: true },
  { path: '/api/admin/logout', roles: ['public', 'admin'], exact: true },
  { path: '/api/admin/me', roles: ['public', 'admin'], exact: true },
  
  // UI Admin Route for login
  { path: '/admin/login', label: 'Admin', roles: ['public'], showInNav: true, exact: true },

  // API Feature Routes
  { path: '/api/registry/scrape', roles: ['admin'], exact: true, requiredModule: 'registry' },
  { path: '/api/registry/contribute', roles: ['public', 'admin'], exact: true, requiredModule: 'registry' },
  { path: '/api/registry/items', roles: ['admin'], methods: ['POST', 'PUT', 'DELETE'], exact: false, requiredModule: 'registry' },
  { path: '/api/registry', roles: ['public', 'admin'], exact: false, requiredModule: 'registry' },
  { path: '/api/weather', roles: ['public', 'admin'], exact: false, requiredModule: 'weather' },
  { path: '/api/media', roles: ['admin'], methods: ['POST', 'PUT', 'DELETE'], exact: false, requiredModule: 'gallery' },
  { path: '/api/admin', roles: ['admin'], exact: false }, // Catch-all for other /api/admin
];

// Utility functions
function normalizePath(p: string): string {
  if (!p) return '';
  const stripped = p.replace(/\/+$/, '');
  return stripped === '' ? '/' : stripped;
}

export function getNavLinks(role: RouteRole, moduleConfig?: unknown) {
  return APP_ROUTES.filter(route => {
    if (!route.showInNav || !route.roles.includes(role)) {
      return false;
    }
    if (route.requiredModule && !isFeatureEnabled(route.requiredModule, moduleConfig)) {
      return false;
    }
    return true;
  }).map(route => ({
    href: route.path,
    label: route.label!
  }));
}

export function getRequiredModuleForRoute(pathname: string): FeatureId | undefined {
  const normalizedPathname = normalizePath(pathname);

  const matches = APP_ROUTES.filter(route => {
    const normalizedRoutePath = normalizePath(route.path);
    return route.exact 
      ? normalizedPathname === normalizedRoutePath 
      : normalizedPathname.startsWith(normalizedRoutePath);
  });

  if (matches.length === 0) return undefined;

  matches.sort((a, b) => normalizePath(b.path).length - normalizePath(a.path).length);
  return matches[0].requiredModule;
}

export function isProtectedRoute(pathname: string, method: string = 'GET'): boolean {
  const normalizedPathname = normalizePath(pathname);

  // Find the most specific matching route
  const matches = APP_ROUTES.filter(route => {
    const normalizedRoutePath = normalizePath(route.path);
    // Exact match or prefix match
    const isPathMatch = route.exact 
      ? normalizedPathname === normalizedRoutePath 
      : normalizedPathname.startsWith(normalizedRoutePath);
      
    if (!isPathMatch) return false;
    
    // Method match
    if (route.methods && route.methods.length > 0) {
      return route.methods.includes(method);
    }
    
    return true;
  });

  if (matches.length === 0) return false;

  // Sort matches by path length descending to get the most specific match
  matches.sort((a, b) => {
    const lenA = normalizePath(a.path).length;
    const lenB = normalizePath(b.path).length;
    return lenB - lenA;
  });
  
  const bestMatch = matches[0];
  
  // A route is protected if 'admin' is in roles and 'public' is not
  return bestMatch.roles.includes('admin') && !bestMatch.roles.includes('public');
}
