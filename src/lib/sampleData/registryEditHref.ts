export const REGISTRY_EDIT_FALLBACK_ID = 'fallback';

export function buildRegistryEditItemHref(
  id: string,
  useFallbackQuery = false
): string {
  const trimmed = id.trim();
  if (useFallbackQuery) {
    return `/registry/edit-item/${REGISTRY_EDIT_FALLBACK_ID}?id=${encodeURIComponent(trimmed)}`;
  }
  return `/registry/edit-item/${encodeURIComponent(trimmed)}`;
}
