import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAdminFeatures } from '../useAdminFeatures';
// eslint-disable-next-line no-restricted-imports
import { apiClient } from '@/features/admin/apiClient';

jest.mock('@/features/admin/apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    put: jest.fn(),
  },
}));

describe('useAdminFeatures', () => {
  const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
  const mockPut = apiClient.put as jest.MockedFunction<typeof apiClient.put>;

  function createTestQueryClient() {
    return new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity },
      },
    });
  }

  function createWrapper(queryClient: QueryClient) {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes array and object-wrapped feature payloads and falls back to default sections when empty', async () => {
    const queryClient = createTestQueryClient();
    const customFeatures = [{ id: 'story', type: 'story', title: 'Custom Story', visible: true }];
    mockGet.mockResolvedValueOnce(customFeatures);

    const { result } = renderHook(() => useAdminFeatures(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.features).toEqual(customFeatures);
    });
    expect(mockGet).toHaveBeenCalledWith('/api/admin/features');

    mockGet.mockResolvedValueOnce({
      features: [{ id: 'venue', type: 'venue', title: 'Ceremony Lawn', visible: false }],
    });
    await act(async () => {
      await result.current.fetchAll();
    });
    await waitFor(() => {
      expect(result.current.features).toEqual([
        { id: 'venue', type: 'venue', title: 'Ceremony Lawn', visible: false },
      ]);
    });

    mockGet.mockResolvedValueOnce([]);
    await act(async () => {
      await result.current.fetchAll();
    });
    await waitFor(() => {
      expect(result.current.features).toHaveLength(6);
      expect(result.current.features[0]?.id).toBe('story');
    });

    queryClient.clear();
  });

  it('saves updated features optimistically and rolls back on mutation failure', async () => {
    const queryClient = createTestQueryClient();
    const initial = [{ id: 'story', type: 'story', title: 'Our Story', visible: true }];
    const updated = [{ id: 'story', type: 'story', title: 'Updated Story', visible: false }];
    mockGet.mockResolvedValue(initial);

    const { result } = renderHook(() => useAdminFeatures(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.features).toEqual(initial);
    });

    mockPut.mockRejectedValueOnce(new Error('Save failed'));
    await expect(
      act(async () => {
        await result.current.saveFeatures(updated);
      })
    ).rejects.toThrow('Save failed');

    await waitFor(() => {
      expect(result.current.features).toEqual(initial);
    });

    mockGet.mockResolvedValueOnce(updated);
    mockPut.mockResolvedValueOnce(updated);
    await act(async () => {
      await result.current.saveFeatures(updated);
    });

    expect(mockPut).toHaveBeenCalledWith('/api/admin/features', { features: updated });
    await waitFor(() => {
      expect(result.current.features).toEqual(updated);
    });

    queryClient.clear();
  });
});
