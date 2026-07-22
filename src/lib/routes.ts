type RouteRole = 'admin' | 'public';

interface AppRoute {
  path: string;
  label?: string;
  roles: RouteRole[];
  exact?: boolean;
  methods?: string[]; // e.g., ['PUT', 'DELETE']
  showInNav?: boolean;
}

const APP_ROUTES: AppRoute[] = [
  // Navigation Links
  { path: '/', label: 'Home', roles: ['public', 'admin'], showInNav: true, exact: true },
  { path: '/photos', label: 'Photos', roles: ['public', 'admin'], showInNav: true },
  { path: '/wedding-party', label: 'Wedding Party', roles: ['public', 'admin'], showInNav: true },
  { path: '/things-to-do', label: 'Things to Do', roles: ['public', 'admin'], showInNav: true },
  { path: '/weather', label: 'Weather', roles: ['public', 'admin'], showInNav: true },
  { path: '/archive', label: 'Archive', roles: ['public', 'admin'], showInNav: true },
  
  // Admin Navigation
  { path: '/admin/dashboard', label: 'Dashboard', roles: ['admin'], showInNav: true, exact: false },
  
  // Protected UI Routes
  { path: '/registry/add-item', roles: ['admin'], exact: false },
  { path: '/registry/edit-item', roles: ['admin'], exact: false },

  // API Admin Routes (Unprotected)
  { path: '/api/admin/login', roles: ['public', 'admin'], exact: true },
  { path: '/api/admin/logout', roles: ['public', 'admin'], exact: true },
  { path: '/api/admin/me', roles: ['public', 'admin'], exact: true },
  
  // UI Admin Route for login
  { path: '/admin/login', label: 'Admin', roles: ['public'], showInNav: true, exact: true },

  // API Registry Routes (Protected)
  { path: '/api/registry/add-item', roles: ['admin'], exact: true },
  { path: '/api/registry/scrape', roles: ['admin'], exact: true },
  { path: '/api/registry/items', roles: ['admin'], methods: ['PUT', 'DELETE'], exact: false },
  { path: '/api/media', roles: ['admin'], methods: ['POST', 'PUT', 'DELETE'], exact: false },
  { path: '/api/admin', roles: ['admin'], exact: false }, // Catch-all for other /api/admin
];

// Utility functions
export function getNavLinks(role: RouteRole) {
  return APP_ROUTES.filter(route => 
    route.showInNav && route.roles.includes(role)
  ).map(route => ({
    href: route.path,
    label: route.label!
  }));
}

export function isProtectedRoute(pathname: string, method: string = 'GET'): boolean {
  // Find the most specific matching route
  const matches = APP_ROUTES.filter(route => {
    // Exact match or prefix match
    const isPathMatch = route.exact 
      ? pathname === route.path 
      : pathname.startsWith(route.path);
      
    if (!isPathMatch) return false;
    
    // Method match
    if (route.methods && route.methods.length > 0) {
      return route.methods.includes(method);
    }
    
    return true;
  });

  if (matches.length === 0) return false;

  // Sort matches by path length descending to get the most specific match
  matches.sort((a, b) => b.path.length - a.path.length);
  
  const bestMatch = matches[0];
  
  // A route is protected if 'admin' is in roles and 'public' is not
  return bestMatch.roles.includes('admin') && !bestMatch.roles.includes('public');
}
