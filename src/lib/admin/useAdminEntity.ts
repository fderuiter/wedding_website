import { useState, useEffect, useCallback } from 'react';
import { apiClient } from './apiClient';

/**
 * Manages admin CRUD, reordering, and visibility state for a collection of entities identified by `entityKey`.
 *
 * @param entityKey - Identifier used to build admin API endpoints for the entity collection
 * @returns An object with:
 *  - `data`: current array of entities
 *  - `loading`: whether an initial or ongoing fetch is in progress
 *  - `error`: last fetch error message or `null`
 *  - `fetchAll`: refreshes `data` from the server
 *  - `create`: creates a new entity and prepends it to `data`
 *  - `update`: updates an entity by `id` and replaces it in `data`
 *  - `remove`: deletes an entity by `id` and removes it from `data`
 *  - `reorder`: applies an optimistic reorder of `data` according to an array of `orderedIds` and persists the order; reverts on failure by refreshing `data`
 *  - `toggleVisibility`: updates an entity's `isVisible` flag and returns the updated entity
 */
export function useAdminEntity<T extends { id: string }>(entityKey: string) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const json = await apiClient.get<T[]>(`/api/admin/${entityKey}`);
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [entityKey]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const create = async (payload: any) => {
    const newItem = await apiClient.post<T>(`/api/admin/${entityKey}`, payload);
    setData(prev => [newItem, ...prev]);
    return newItem;
  };

  const update = async (id: string, payload: any) => {
    const updatedItem = await apiClient.put<T>(`/api/admin/${entityKey}/${id}`, payload);
    setData(prev => prev.map(item => item.id === id ? updatedItem : item));
    return updatedItem;
  };

  const remove = async (id: string) => {
    await apiClient.delete(`/api/admin/${entityKey}/${id}`);
    setData(prev => prev.filter(item => item.id !== id));
  };

  const reorder = async (orderedIds: string[]) => {
    // Optimistic UI update
    const sorted = [...data].sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));
    setData(sorted);
    
    try {
      await apiClient.put(`/api/admin/${entityKey}`, { action: 'reorder', orderedIds });
    } catch (err) {
      // Revert on failure
      fetchAll();
      throw err;
    }
  };

  const toggleVisibility = async (id: string, isVisible: boolean) => {
    return update(id, { isVisible });
  };

  return {
    data,
    loading,
    error,
    fetchAll,
    create,
    update,
    remove,
    reorder,
    toggleVisibility
  };
}
