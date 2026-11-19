/**
 * Shared registry catalog pagination and progressive rendering bounds.
 * Kept stateless and dependency-free so API schemas, repositories, and client hooks
 * share a single source of truth without cross-layer bundle leakage.
 */
export const REGISTRY_DEFAULT_PAGE_LIMIT = 20;
export const REGISTRY_MAX_CATALOG_LIMIT = 500;
export const REGISTRY_INITIAL_VISIBLE_ITEMS = 12;
export const REGISTRY_LOAD_MORE_INCREMENT = 8;
