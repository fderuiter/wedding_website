'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/components/ui/ToastProvider';
import { PreviewRegistryItem } from '../components/RegistryPreviewTable';

type PreviewItemsUpdater =
  | PreviewRegistryItem[]
  | ((_prev: PreviewRegistryItem[]) => PreviewRegistryItem[]);

interface UseRegistryPreviewImportOptions<TDraft extends { items: PreviewRegistryItem[] }> {
  items: PreviewRegistryItem[];
  setDraft: React.Dispatch<React.SetStateAction<TDraft>>;
  onResetDraft: () => void;
  onSuccess?: () => void;
  includePaymentHandles: boolean;
  formatSuccessToast: (_validCount: number) => string;
}

interface UseRegistryPreviewImportReturn {
  isSubmitting: boolean;
  setItems: (_updater: PreviewItemsUpdater) => void;
  handleUpdateItem: (_id: string, _updated: Partial<PreviewRegistryItem>) => void;
  handleRemoveItem: (_id: string) => void;
  handleRemoveInvalid: () => void;
  handleImport: () => Promise<void>;
}

/**
 * Module-private hook managing preview item edits, validation filtering,
 * and batch submission to `/api/registry/items/batch`.
 */
export function useRegistryPreviewImport<TDraft extends { items: PreviewRegistryItem[] }>({
  items,
  setDraft,
  onResetDraft,
  onSuccess,
  includePaymentHandles,
  formatSuccessToast,
}: UseRegistryPreviewImportOptions<TDraft>): UseRegistryPreviewImportReturn {
  const router = useRouter();
  const { addToast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const setItems = (updater: PreviewItemsUpdater) => {
    setDraft((prev) => ({
      ...prev,
      items: typeof updater === 'function' ? updater(prev.items) : updater,
    }));
  };

  const handleUpdateItem = (id: string, updated: Partial<PreviewRegistryItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updated } : item))
    );
  };

  const handleRemoveItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleRemoveInvalid = () => {
    setItems((prev) => prev.filter((item) => item.isValid));
  };

  const handleImport = async () => {
    const validItems = items.filter((it) => it.isValid);
    if (validItems.length === 0) {
      addToast('No valid items to import.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        items: validItems.map((it) => ({
          name: it.name,
          price: it.price || 0,
          quantity: it.quantity || 1,
          category: it.category || 'Uncategorized',
          description: it.description || '',
          vendorUrl: it.vendorUrl || undefined,
          imageUrl: it.imageUrl || '/images/placeholder.png',
          imageAlt: it.imageAlt || undefined,
          isGroupGift: it.isGroupGift,
          isMostWanted: it.isMostWanted,
          ...(includePaymentHandles && it.isGroupGift && it.paymentHandleType
            ? { paymentHandleType: it.paymentHandleType }
            : {}),
          ...(includePaymentHandles && it.isGroupGift && it.paymentHandle
            ? { paymentHandle: it.paymentHandle }
            : {}),
        })),
      };

      await apiClient.post('/api/registry/items/batch', payload);

      onResetDraft();
      addToast(formatSuccessToast(validItems.length), 'success');
      if (onSuccess) {
        onSuccess();
      } else {
        router.push('/admin/dashboard/registry');
      }
    } catch (err: unknown) {
      const errorMessage =
        typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message?: unknown }).message || '')
          : '';
      addToast(`Failed to import items: ${errorMessage || 'Unknown error'}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    isSubmitting,
    setItems,
    handleUpdateItem,
    handleRemoveItem,
    handleRemoveInvalid,
    handleImport,
  };
}
