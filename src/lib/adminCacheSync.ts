import type { QueryClient, QueryKey } from '@tanstack/react-query';

const ADMIN_CACHE_SYNC_EVENT = 'admin-cache-sync';

export type AdminCacheSyncScope = 'sample-data' | 'milestones' | 'seating' | 'settings';

interface AdminCacheSyncDetail {
  scopes: AdminCacheSyncScope[];
}

export const ADMIN_ONBOARDING_MILESTONES_QUERY_KEY = ['admin-onboarding-milestones'] as const;
export const ADMIN_SAMPLE_DATA_QUERY_KEY = ['admin-sample-data'] as const;
export const ADMIN_SEATING_QUERY_KEY = ['admin-seating'] as const;
export const ADMIN_SETTINGS_QUERY_KEY = ['admin-settings'] as const;

const SAMPLE_DATA_AFFECTED_QUERY_KEYS: readonly QueryKey[] = [
  ['admin-registry'],
  ['registry-items'],
  ['admin-registry-item'],
  ['admin-invitation-codes'],
  ['admin-rsvp-summary'],
  ['admin-wedding-party'],
  ['admin-attractions'],
  ['admin-content-nodes'],
  ['admin-sub-events'],
  ADMIN_SEATING_QUERY_KEY,
  ADMIN_ONBOARDING_MILESTONES_QUERY_KEY,
  ADMIN_SAMPLE_DATA_QUERY_KEY,
];

function dispatchAdminCacheSync(scopes: AdminCacheSyncScope[]): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }
  try {
    window.dispatchEvent(
      new CustomEvent<AdminCacheSyncDetail>(ADMIN_CACHE_SYNC_EVENT, {
        detail: { scopes },
      })
    );
  } catch {
    // Ignore event dispatch errors in restricted environments
  }
}

/**
 * Subscribe to cross-component admin cache invalidation notifications for a given scope.
 * Combines TanStack Query cache invalidation observation with DOM event fallback so
 * non-useQuery hooks/components (such as useSeatingState and OnboardingChecklist) stay synchronized.
 */
export function subscribeToAdminCacheSync(
  queryClient: QueryClient | undefined,
  targetScopes: readonly AdminCacheSyncScope[],
  targetQueryKeys: readonly QueryKey[],
  onInvalidate: () => void
): () => void {
  let scheduled = false;
  const trigger = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      onInvalidate();
    });
  };

  const unsubscribers: Array<() => void> = [];

  if (queryClient) {
    const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated') return;
      const actionType = (event as { action?: { type?: string } }).action?.type;
      if (actionType !== 'invalidate' && !event.query.state.isInvalidated) {
        return;
      }
      const eventKey = event.query.queryKey;
      const matchesKey = targetQueryKeys.some(
        (targetKey) =>
          Array.isArray(eventKey) &&
          targetKey.every((segment, index) => eventKey[index] === segment)
      );
      if (matchesKey) {
        trigger();
      }
    });
    unsubscribers.push(unsubscribeCache);
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const handleCustomEvent = (evt: Event) => {
      const detail = (evt as CustomEvent<AdminCacheSyncDetail>).detail;
      if (!detail || !Array.isArray(detail.scopes)) return;
      if (detail.scopes.some((scope) => targetScopes.includes(scope))) {
        trigger();
      }
    };
    window.addEventListener(ADMIN_CACHE_SYNC_EVENT, handleCustomEvent);
    unsubscribers.push(() => window.removeEventListener(ADMIN_CACHE_SYNC_EVENT, handleCustomEvent));
  }

  return () => {
    for (const unsub of unsubscribers) {
      unsub();
    }
  };
}

/**
 * Cancel in-flight reads and invalidate all admin and public caches affected by sample data
 * seeding or purging (registry, guests, seating, wedding party, attractions, FAQs, milestones).
 */
export async function invalidateSampleDataCaches(
  queryClient?: QueryClient
): Promise<void> {
  if (queryClient) {
    await Promise.all(
      SAMPLE_DATA_AFFECTED_QUERY_KEYS.map((queryKey) =>
        queryClient.cancelQueries({ queryKey })
      )
    );
    await Promise.all(
      SAMPLE_DATA_AFFECTED_QUERY_KEYS.map((queryKey) =>
        queryClient.invalidateQueries({ queryKey })
      )
    );
  }

  dispatchAdminCacheSync(['sample-data', 'milestones', 'seating']);
}

/**
 * Invalidate onboarding milestone checklist caches after admin entity or settings mutations.
 */
export function invalidateOnboardingMilestones(queryClient?: QueryClient): void {
  if (queryClient) {
    void queryClient.invalidateQueries({ queryKey: ADMIN_ONBOARDING_MILESTONES_QUERY_KEY });
  }
  dispatchAdminCacheSync(['milestones']);
}

/**
 * Invalidate seating and milestone caches after seating table or guest assignment changes.
 */
export function invalidateSeatingAndMilestoneCaches(queryClient?: QueryClient): void {
  if (queryClient) {
    void queryClient.invalidateQueries({ queryKey: ['admin-invitation-codes'] });
    void queryClient.invalidateQueries({ queryKey: ADMIN_SEATING_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: ADMIN_ONBOARDING_MILESTONES_QUERY_KEY });
  }
  dispatchAdminCacheSync(['milestones']);
}
