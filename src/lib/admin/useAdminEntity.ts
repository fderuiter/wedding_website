import { useState, useEffect, useCallback } from 'react';

export function useAdminEntity<T extends { id: string }>(entityKey: string) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/${entityKey}`);
      if (!res.ok) throw new Error('Failed to fetch data');
      const json = await res.json();
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
    const res = await fetch(`/api/admin/${entityKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed to create');
    const newItem = await res.json();
    setData(prev => [newItem, ...prev]);
    return newItem;
  };

  const update = async (id: string, payload: any) => {
    const res = await fetch(`/api/admin/${entityKey}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed to update');
    const updatedItem = await res.json();
    setData(prev => prev.map(item => item.id === id ? updatedItem : item));
    return updatedItem;
  };

  const remove = async (id: string) => {
    const res = await fetch(`/api/admin/${entityKey}/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Failed to delete');
    setData(prev => prev.filter(item => item.id !== id));
  };

  const reorder = async (orderedIds: string[]) => {
    // Optimistic UI update
    const sorted = [...data].sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));
    setData(sorted);
    
    const res = await fetch(`/api/admin/${entityKey}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reorder', orderedIds })
    });
    if (!res.ok) {
      // Revert on failure
      fetchAll();
      throw new Error('Failed to reorder');
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
