/**
 * Shared invitation catalog pagination constants.
 * Mirrors src/utils/registryPagination.ts while keeping /api/admin/[entity]
 * capped at default 50 / max 100 rows.
 */
export const INVITATION_DEFAULT_PAGE_SIZE = 50;
export const INVITATION_MAX_CATALOG_LIMIT = 1000;

export function clampInvitationPageSize(
  rawLimit: number | string | null | undefined,
  maxLimit: number = INVITATION_MAX_CATALOG_LIMIT
): number {
  if (rawLimit === null || rawLimit === undefined || rawLimit === '') {
    return Math.min(INVITATION_DEFAULT_PAGE_SIZE, maxLimit);
  }
  const parsed = typeof rawLimit === 'number' ? rawLimit : parseInt(rawLimit, 10);
  if (isNaN(parsed) || parsed < 1) {
    return Math.min(INVITATION_DEFAULT_PAGE_SIZE, maxLimit);
  }
  return Math.min(parsed, maxLimit);
}
