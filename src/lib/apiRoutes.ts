export const API_ROUTES = {
  // Registry
  getRegistryItems: '/api/registry/items',
  addRegistryItem: '/api/registry/add-item',
  getRegistryItem: (id: string) => `/api/registry/items/${id}`,
  contributeToRegistryItem: '/api/registry/contribute',
  scrapeUrl: '/api/registry/scrape',

  // Admin
  adminLogin: '/api/admin/login',
  adminLogout: '/api/admin/logout',
  adminMe: '/api/admin/me',
};
