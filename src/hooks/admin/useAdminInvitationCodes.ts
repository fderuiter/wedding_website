import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/features/admin';
import type { InvitationCodeDTO } from '@/features/registry';
import { normalizePartyTags } from '@/utils/invitationValidation';
import { useAdminEntityOrchestration, type AdminHookOptions } from './useAdminEntityOrchestration';

type TagUpdateAction = 'add' | 'remove' | 'replace';

interface PaginatedInvitationCache {
  items: InvitationCodeDTO[];
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
}

type InvitationCacheValue = InvitationCodeDTO[] | PaginatedInvitationCache;

interface BatchUpdateTagsResponse {
  success?: boolean;
  count?: number;
  updatedCount?: number;
  records?: InvitationCodeDTO[];
}

const INVITATION_CODES_QUERY_KEY = ['admin-invitation-codes'] as const;
const INVITATION_CODES_ENDPOINT = '/api/admin/invitation-codes';

function isPaginatedCache(value: unknown): value is PaginatedInvitationCache {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

function updateInvitationCache(
  old: InvitationCacheValue | undefined,
  updater: (_items: InvitationCodeDTO[]) => InvitationCodeDTO[]
): InvitationCacheValue | undefined {
  if (old === undefined) return old;
  if (Array.isArray(old)) {
    return updater(old);
  }
  if (isPaginatedCache(old)) {
    return {
      ...old,
      items: updater(old.items),
    };
  }
  return old;
}

function computeNextTags(
  existingTags: string[] | undefined,
  cleanTags: string[],
  action: TagUpdateAction
): string[] {
  const current = normalizePartyTags(existingTags, { dedupe: true });
  if (action === 'replace') {
    return [...cleanTags];
  }
  if (action === 'remove') {
    const removeSet = new Set(cleanTags);
    return current.filter((tag) => !removeSet.has(tag));
  }
  return Array.from(new Set([...current, ...cleanTags]));
}

export function useAdminInvitationCodes(options?: AdminHookOptions) {
  const queryClient = useQueryClient();
  const orchestration = useAdminEntityOrchestration<InvitationCodeDTO>({
    queryKey: INVITATION_CODES_QUERY_KEY,
    endpoint: INVITATION_CODES_ENDPOINT,
    entityName: 'invitation code',
    options,
  });

  const { mutateAsync: mutateBatchUpdateTags } = useMutation({
    mutationFn: async ({
      ids,
      tags,
      action = 'add',
    }: {
      ids: string[];
      tags: string[];
      action?: TagUpdateAction;
    }) =>
      apiClient.post<BatchUpdateTagsResponse>(`${INVITATION_CODES_ENDPOINT}/batch`, {
        ids,
        tags,
        action,
      }),
    onMutate: async ({ ids, tags, action = 'add' }) => {
      await queryClient.cancelQueries({ queryKey: INVITATION_CODES_QUERY_KEY });
      const previousData = queryClient.getQueryData<InvitationCacheValue>(
        INVITATION_CODES_QUERY_KEY
      );
      if (previousData !== undefined) {
        const idSet = new Set(ids);
        const cleanTags = normalizePartyTags(tags, { dedupe: true });
        queryClient.setQueryData<InvitationCacheValue | undefined>(
          INVITATION_CODES_QUERY_KEY,
          (old) =>
            updateInvitationCache(old, (items) =>
              items.map((item) =>
                idSet.has(item.id)
                  ? { ...item, partyTags: computeNextTags(item.partyTags, cleanTags, action) }
                  : item
              )
            )
        );
      }
      return { previousData };
    },
    onSuccess: (response, { ids, tags, action = 'add' }) => {
      const serverRecords = response?.records;
      if (Array.isArray(serverRecords) && serverRecords.length > 0) {
        const byId = new Map(serverRecords.map((rec) => [rec.id, rec]));
        queryClient.setQueryData<InvitationCacheValue | undefined>(
          INVITATION_CODES_QUERY_KEY,
          (old) =>
            updateInvitationCache(old, (items) =>
              items.map((item) => {
                const updated = byId.get(item.id);
                return updated ? { ...item, ...updated } : item;
              })
            )
        );
        return;
      }

      const idSet = new Set(ids);
      const cleanTags = normalizePartyTags(tags, { dedupe: true });
      queryClient.setQueryData<InvitationCacheValue | undefined>(
        INVITATION_CODES_QUERY_KEY,
        (old) =>
          updateInvitationCache(old, (items) =>
            items.map((item) =>
              idSet.has(item.id)
                ? { ...item, partyTags: computeNextTags(item.partyTags, cleanTags, action) }
                : item
            )
          )
      );
    },
    onError: (_err, _variables, context) => {
      if (context && context.previousData !== undefined) {
        queryClient.setQueryData(INVITATION_CODES_QUERY_KEY, context.previousData);
      }
    },
    meta: {
      showSuccessToast: false,
      showErrorToast: false,
    },
  });

  return {
    ...orchestration,
    batchUpdateTags: (
      ids: string[],
      tags: string[],
      action: TagUpdateAction = 'add'
    ) => mutateBatchUpdateTags({ ids, tags, action }),
  };
}

