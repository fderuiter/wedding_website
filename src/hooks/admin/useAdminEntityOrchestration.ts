import type { QueryKey } from '@tanstack/react-query';
import { apiClient } from '@/features/admin';
import { useEntityOrchestration } from '../useEntityOrchestration';

export interface AdminHookOptions {
  enabled?: boolean;
}

export interface UseAdminEntityOrchestrationOptions {
  queryKey: QueryKey;
  endpoint: string;
  fetchEndpoint?: string;
  invalidateQueryKeys?: readonly QueryKey[];
  entityName: string;
  options?: AdminHookOptions;
  enabled?: boolean;
}

export function useAdminEntityOrchestration<T extends { id: string }>({
  queryKey,
  endpoint,
  fetchEndpoint,
  invalidateQueryKeys,
  entityName,
  options,
  enabled,
}: UseAdminEntityOrchestrationOptions) {
  const resolvedEnabled = options !== undefined ? options.enabled : enabled;
  return useEntityOrchestration<T>({
    queryKey,
    endpoint,
    fetchEndpoint,
    invalidateQueryKeys,
    entityName,
    apiClient,
    enabled: resolvedEnabled,
  });
}
