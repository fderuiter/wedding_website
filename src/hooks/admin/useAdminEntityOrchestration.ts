import { apiClient } from '@/features/admin/apiClient';
import { useEntityOrchestration } from '../useEntityOrchestration';

export interface AdminHookOptions {
  enabled?: boolean;
}

export interface UseAdminEntityOrchestrationOptions {
  queryKey: (string | number)[];
  endpoint: string;
  entityName: string;
  options?: AdminHookOptions;
  enabled?: boolean;
}

export function useAdminEntityOrchestration<T extends { id: string }>({
  queryKey,
  endpoint,
  entityName,
  options,
  enabled,
}: UseAdminEntityOrchestrationOptions) {
  const resolvedEnabled = options !== undefined ? options.enabled : enabled;
  return useEntityOrchestration<T>({
    queryKey,
    endpoint,
    entityName,
    apiClient,
    enabled: resolvedEnabled,
  });
}
