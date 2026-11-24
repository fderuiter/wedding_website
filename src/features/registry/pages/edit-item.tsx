'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { RegistryItem } from '../types';
import RegistryItemForm from '../components/RegistryItemForm';
import { useAdminRegistry, useAdminRegistryItem } from '@/hooks/admin/useAdminRegistry';
import { AdminEditorContainer } from '@/components/admin/AdminEditorContainer';
import { AdminViewState } from '@/components/admin/AdminViewState';
import { useToast } from '@/components/ui/ToastProvider';
import {
  REGISTRY_EDIT_FALLBACK_ID,
  findSeededRegistryItemById,
} from '@/lib/sampleData/builder';

const subscribeLocationNoop = () => () => {};

function getClientLocationFallbackId(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  const searchId = new URLSearchParams(window.location.search).get('id')?.trim();
  if (searchId) {
    return searchId;
  }

  const match = window.location.pathname.match(/\/registry\/edit-item\/([^/?#]+)/);
  if (match?.[1]) {
    const decoded = decodeURIComponent(match[1]).trim();
    if (decoded && decoded !== REGISTRY_EDIT_FALLBACK_ID) {
      return decoded;
    }
  }

  return '';
}

function getServerLocationFallbackId(): string {
  return '';
}

function extractCachedRegistryItem(
  queryClient: ReturnType<typeof useQueryClient>,
  targetId: string
): RegistryItem | null {
  if (!targetId) {
    return null;
  }

  const directItem = queryClient.getQueryData<RegistryItem | null>([
    'admin-registry-item',
    targetId,
  ]);
  if (directItem && directItem.id === targetId) {
    return directItem;
  }

  const adminCatalog = queryClient.getQueryData<RegistryItem[]>(['admin-registry']);
  if (Array.isArray(adminCatalog)) {
    const matched = adminCatalog.find((entry) => entry.id === targetId);
    if (matched) {
      return matched;
    }
  }

  const publicQueries = queryClient.getQueriesData<unknown>({
    queryKey: ['registry-items'],
  });
  for (const [, data] of publicQueries) {
    if (Array.isArray(data)) {
      const matched = (data as RegistryItem[]).find((entry) => entry?.id === targetId);
      if (matched) return matched;
    } else if (
      data &&
      typeof data === 'object' &&
      'items' in data &&
      Array.isArray((data as { items?: unknown }).items)
    ) {
      const matched = ((data as { items: RegistryItem[] }).items).find(
        (entry) => entry?.id === targetId
      );
      if (matched) return matched;
    }
  }

  return null;
}

/**
 * @page EditRegistryItemPage
 * @description A page for administrators to edit an existing item in the wedding registry.
 */
export default function EditRegistryItemPage() {
  const router = useRouter();
  const params = useParams();
  const rawParamId = typeof params?.id === 'string' ? params.id.trim() : '';
  const clientFallbackId = useSyncExternalStore(
    subscribeLocationNoop,
    getClientLocationFallbackId,
    getServerLocationFallbackId
  );

  const isFallbackRoute = rawParamId === REGISTRY_EDIT_FALLBACK_ID;
  const itemId = isFallbackRoute ? clientFallbackId : rawParamId;

  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { update } = useAdminRegistry({ enabled: false });
  const {
    data: itemData,
    isLoading: itemLoading,
    error: itemError,
    refetch,
  } = useAdminRegistryItem(itemId || undefined);

  const resolvedItemData = useMemo<RegistryItem | null>(() => {
    if (itemData) {
      return itemData;
    }

    if (itemId && itemLoading) {
      return null;
    }

    if (itemId) {
      const cached = extractCachedRegistryItem(queryClient, itemId);
      if (cached) {
        return cached;
      }

      const seeded = findSeededRegistryItemById(itemId, {
        includeContributors: true,
      });
      if (seeded) {
        return seeded;
      }
    }

    if (isFallbackRoute && !itemId) {
      const adminCatalog = queryClient.getQueryData<RegistryItem[]>(['admin-registry']);
      if (Array.isArray(adminCatalog) && adminCatalog.length > 0) {
        return adminCatalog[0];
      }
      const defaultSeeded = findSeededRegistryItemById('1', {
        includeContributors: true,
      });
      if (defaultSeeded) {
        return defaultSeeded;
      }
    }

    return null;
  }, [isFallbackRoute, itemData, itemId, itemLoading, queryClient]);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const effectiveTargetId = itemId || resolvedItemData?.id || '';

  const handleEdit = async (values: Partial<RegistryItem>) => {
    if (!effectiveTargetId) {
      setSubmitError('Item ID is missing.');
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await update(effectiveTargetId, values);
      const invalidations = [
        queryClient.invalidateQueries({ queryKey: ['admin-registry-item', effectiveTargetId] }),
        queryClient.invalidateQueries({ queryKey: ['admin-registry'] }),
        queryClient.invalidateQueries({ queryKey: ['registry-items'] }),
      ];
      if (resolvedItemData?.id && resolvedItemData.id !== effectiveTargetId) {
        invalidations.push(
          queryClient.invalidateQueries({ queryKey: ['admin-registry-item', resolvedItemData.id] })
        );
      }
      await Promise.all(invalidations);
      addToast('Item updated successfully!', 'success');
      router.push('/admin/dashboard/registry');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update item');
      addToast('Failed to update item', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isWaitingForApi = Boolean(itemId) && itemLoading && !resolvedItemData;
  const loadError = resolvedItemData
    ? null
    : !effectiveTargetId
      ? 'Item ID is missing.'
      : itemError || (!itemLoading ? 'Item not found.' : null);

  return (
    <AdminViewState
      isLoading={isWaitingForApi}
      error={loadError}
      onRetry={effectiveTargetId ? refetch : undefined}
      errorTitle="Unable to Load Registry Item"
      loadingMessage="Loading item data..."
      headingLevel="h1"
    >
      {resolvedItemData && (
        <AdminEditorContainer title="Edit Registry Item" headingLevel="h1">
          {submitError && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
            >
              Error: {submitError}
            </div>
          )}
          <RegistryItemForm
            mode="edit"
            initialValues={resolvedItemData}
            onSubmit={handleEdit}
            onCancel={() => router.push('/admin/dashboard/registry')}
            isSubmitting={isSubmitting}
            submitLabel="Save Changes"
          />
        </AdminEditorContainer>
      )}
    </AdminViewState>
  );
}
