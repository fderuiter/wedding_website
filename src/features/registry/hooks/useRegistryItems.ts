'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RegistryItem } from '@/features/registry/types';
import { API_ROUTES } from '@/lib/apiRoutes';

export function useRegistryItems() {
  const queryClient = useQueryClient();

  const {
    data: items = [],
    isLoading,
    error,
  } = useQuery<RegistryItem[], Error>({
    queryKey: ['registry-items'],
    queryFn: async () => {
      const res = await fetch(API_ROUTES.getRegistryItems);
      if (!res.ok) throw new Error('Failed to fetch registry items');
      return res.json();
    },
  });

  const contributeMutation = useMutation({
    mutationFn: async ({ itemId, purchaserName, amount }: { itemId: string; purchaserName: string; amount: number }) => {
      const res = await fetch(API_ROUTES.contributeToRegistryItem, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, purchaserName, amount }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Contribution failed');
      }
      return res.json();
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ['registry-items'] });
      const previousItems = queryClient.getQueryData<RegistryItem[]>(['registry-items']);
      if (previousItems) {
        queryClient.setQueryData<RegistryItem[]>(['registry-items'], prev => prev?.map(item => {
          if (item.id !== variables.itemId) return item;
          if (item.isGroupGift) {
            const newAmount = item.amountContributed + variables.amount;
            return {
              ...item,
              amountContributed: Math.min(item.price, newAmount),
              contributors: [...item.contributors, { name: variables.purchaserName, amount: variables.amount, date: new Date().toISOString() }],
              purchased: newAmount >= item.price,
            };
          } else {
            return {
              ...item,
              purchased: true,
              purchaserName: variables.purchaserName,
            };
          }
        }) || []);
      }
      return { previousItems };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousItems) {
        queryClient.setQueryData(['registry-items'], context.previousItems);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['registry-items'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const res = await fetch(API_ROUTES.getRegistryItem(itemId), { method: 'DELETE' });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to delete item');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registry-items'] });
    },
  });

  return {
    items,
    isLoading,
    error,
    contribute: contributeMutation,
    deleteItem: deleteMutation,
  };
}
