import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/features/admin';
import type { InvitationCodeDTO, MergeInvitationCodesResult } from '@/features/registry';
import type {
  AdminSingleGuestRsvpOverrideDTO,
  AdminBatchAttendanceOverrideDTO,
} from '@/features/sub-events';
import { INVITATION_MAX_CATALOG_LIMIT } from '@/utils/invitationPagination';
import { normalizePartyTags } from '@/utils/invitationValidation';
import {
  ADMIN_ONBOARDING_MILESTONES_QUERY_KEY,
  invalidateOnboardingMilestones,
} from '@/lib/adminCacheSync';
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

interface AdminSingleRsvpOverrideResponse {
  success?: boolean;
  invitationCode?: InvitationCodeDTO;
  rsvps?: unknown[];
  data?: {
    invitationCode?: InvitationCodeDTO;
    rsvps?: unknown[];
  };
}

interface AdminBatchAttendanceResponse {
  success?: boolean;
  updatedCount?: number;
  records?: InvitationCodeDTO[];
  data?: {
    updatedCount?: number;
    records?: InvitationCodeDTO[];
  };
}

const ADMIN_RSVP_SUMMARY_QUERY_KEY = ['admin-rsvp-summary'] as const;
const INVITATION_CODES_QUERY_KEY = ['admin-invitation-codes'] as const;
const INVITATION_CODES_ENDPOINT = '/api/admin/invitation-codes';
const INVITATION_CODES_CATALOG_ENDPOINT = `${INVITATION_CODES_ENDPOINT}/catalog?limit=${INVITATION_MAX_CATALOG_LIMIT}`;

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

const INVITATION_INVALIDATE_QUERY_KEYS = [
  ADMIN_RSVP_SUMMARY_QUERY_KEY,
  ADMIN_ONBOARDING_MILESTONES_QUERY_KEY,
] as const;

export function useAdminInvitationCodes(options?: AdminHookOptions) {
  const queryClient = useQueryClient();
  const orchestration = useAdminEntityOrchestration<InvitationCodeDTO>({
    queryKey: INVITATION_CODES_QUERY_KEY,
    endpoint: INVITATION_CODES_ENDPOINT,
    fetchEndpoint: INVITATION_CODES_CATALOG_ENDPOINT,
    invalidateQueryKeys: INVITATION_INVALIDATE_QUERY_KEYS,
    entityName: 'invitation code',
    options,
  });

  const invalidateRsvpSummary = () => {
    queryClient.invalidateQueries({ queryKey: ADMIN_RSVP_SUMMARY_QUERY_KEY });
  };

  const invalidateDependentAdminQueries = () => {
    queryClient.invalidateQueries({ queryKey: ADMIN_RSVP_SUMMARY_QUERY_KEY });
    invalidateOnboardingMilestones(queryClient);
  };

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
        invalidateDependentAdminQueries();
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
      invalidateDependentAdminQueries();
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

  const { mutateAsync: mutateMergeDuplicates } = useMutation({
    mutationFn: async ({
      primaryId,
      secondaryIds,
    }: {
      primaryId: string;
      secondaryIds: string[];
    }) =>
      apiClient.post<MergeInvitationCodesResult>(`${INVITATION_CODES_ENDPOINT}/merge`, {
        primaryId,
        secondaryIds,
      }),
    onSuccess: (response, { primaryId, secondaryIds }) => {
      const secondarySet = new Set(secondaryIds);
      const mergedRecord = response?.record;
      queryClient.setQueryData<InvitationCacheValue | undefined>(
        INVITATION_CODES_QUERY_KEY,
        (old) =>
          updateInvitationCache(old, (items) =>
            items
              .filter((item) => !secondarySet.has(item.id))
              .map((item) =>
                item.id === primaryId && mergedRecord ? { ...item, ...mergedRecord } : item
              )
          )
      );
      invalidateDependentAdminQueries();
    },
    meta: {
      showSuccessToast: false,
      showErrorToast: false,
    },
  });

  const { mutateAsync: mutateUpdateGuestRsvps } = useMutation({
    mutationFn: async (payload: AdminSingleGuestRsvpOverrideDTO) =>
      apiClient.put<AdminSingleRsvpOverrideResponse>(`${INVITATION_CODES_ENDPOINT}/rsvps`, payload),
    onSuccess: (response, variables) => {
      const updatedInvite = response?.invitationCode ?? response?.data?.invitationCode;
      if (updatedInvite) {
        queryClient.setQueryData<InvitationCacheValue | undefined>(
          INVITATION_CODES_QUERY_KEY,
          (old) =>
            updateInvitationCache(old, (items) =>
              items.map((item) =>
                item.id === variables.invitationCodeId ? { ...item, ...updatedInvite } : item
              )
            )
        );
      } else {
        queryClient.invalidateQueries({ queryKey: INVITATION_CODES_QUERY_KEY });
      }
      invalidateRsvpSummary();
    },
    meta: {
      showSuccessToast: false,
      showErrorToast: false,
    },
  });

  const { mutateAsync: mutateBatchUpdateAttendance } = useMutation({
    mutationFn: async (payload: AdminBatchAttendanceOverrideDTO) =>
      apiClient.put<AdminBatchAttendanceResponse>(`${INVITATION_CODES_ENDPOINT}/rsvps`, payload),
    onSuccess: (response) => {
      const updatedRecords = response?.records ?? response?.data?.records;
      if (Array.isArray(updatedRecords) && updatedRecords.length > 0) {
        const byId = new Map(updatedRecords.map((rec) => [rec.id, rec]));
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
      } else {
        queryClient.invalidateQueries({ queryKey: INVITATION_CODES_QUERY_KEY });
      }
      invalidateRsvpSummary();
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
    mergeDuplicates: (primaryId: string, secondaryIds: string[]) =>
      mutateMergeDuplicates({ primaryId, secondaryIds }),
    updateGuestRsvps: (payload: AdminSingleGuestRsvpOverrideDTO) =>
      mutateUpdateGuestRsvps(payload),
    batchUpdateAttendance: (
      invitationCodeIds: string[],
      status: AdminBatchAttendanceOverrideDTO['status'],
      subEventIds?: string[]
    ) => mutateBatchUpdateAttendance({ invitationCodeIds, status, subEventIds }),
  };
}

