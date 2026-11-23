import { useState } from 'react';
import { renderHook, act } from '@testing-library/react';
import { useRegistryPreviewImport } from '../useRegistryPreviewImport';
import { PreviewRegistryItem } from '../../components/RegistryPreviewTable';
import { apiClient } from '@/lib/apiClient';

const mockPush = jest.fn();
const mockAddToast = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

jest.mock('@/components/ui/ToastProvider', () => ({
  useToast: () => ({
    addToast: mockAddToast,
  }),
}));

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    post: jest.fn(),
  },
}));

const mockApiClientPost = apiClient.post as jest.Mock;

function buildPreviewItem(overrides: Partial<PreviewRegistryItem> = {}): PreviewRegistryItem {
  return {
    id: 'row-1',
    name: 'Espresso Machine',
    price: 499.99,
    category: 'Kitchen',
    description: 'Dual boiler',
    vendorUrl: 'https://example.com/espresso',
    imageUrl: 'https://example.com/espresso.jpg',
    imageAlt: 'Espresso machine photo',
    quantity: 1,
    isGroupGift: true,
    isMostWanted: true,
    paymentHandleType: 'Venmo',
    paymentHandle: '@couple-venmo',
    isValid: true,
    errors: [],
    ...overrides,
  };
}

describe('useRegistryPreviewImport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function useTestHarness(options: {
    initialItems: PreviewRegistryItem[];
    includePaymentHandles: boolean;
    onResetDraft?: () => void;
    onSuccess?: () => void;
    formatSuccessToast?: (_count: number) => string;
  }) {
    const [draft, setDraft] = useState<{ items: PreviewRegistryItem[] }>({
      items: options.initialItems,
    });
    const hook = useRegistryPreviewImport({
      items: draft.items,
      setDraft,
      onResetDraft: options.onResetDraft ?? jest.fn(),
      onSuccess: options.onSuccess,
      includePaymentHandles: options.includePaymentHandles,
      formatSuccessToast:
        options.formatSuccessToast ?? ((count) => `Saved ${count} items!`),
    });
    return { items: draft.items, ...hook };
  }

  it('updates, removes, and filters invalid preview rows', () => {
    const validRow = buildPreviewItem({ id: 'valid-1', name: 'Valid Gift', isValid: true });
    const invalidRow = buildPreviewItem({
      id: 'invalid-1',
      name: '',
      isValid: false,
      errors: ['Name is required'],
    });

    const { result } = renderHook(() =>
      useTestHarness({
        initialItems: [validRow, invalidRow],
        includePaymentHandles: false,
      })
    );

    act(() => {
      result.current.handleUpdateItem('valid-1', { name: 'Updated Gift' });
    });
    expect(result.current.items[0].name).toBe('Updated Gift');

    act(() => {
      result.current.handleRemoveInvalid();
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].id).toBe('valid-1');

    act(() => {
      result.current.handleRemoveItem('valid-1');
    });
    expect(result.current.items).toHaveLength(0);
  });

  it('omits paymentHandleType and paymentHandle when includePaymentHandles is false', async () => {
    mockApiClientPost.mockResolvedValueOnce({ success: true, count: 1, items: [] });
    const onResetDraft = jest.fn();

    const { result } = renderHook(() =>
      useTestHarness({
        initialItems: [buildPreviewItem()],
        includePaymentHandles: false,
        onResetDraft,
        formatSuccessToast: (count) => `Successfully added ${count} items to your registry!`,
      })
    );

    await act(async () => {
      await result.current.handleImport();
    });

    expect(mockApiClientPost).toHaveBeenCalledWith('/api/registry/items/batch', {
      items: [
        {
          name: 'Espresso Machine',
          price: 499.99,
          quantity: 1,
          category: 'Kitchen',
          description: 'Dual boiler',
          vendorUrl: 'https://example.com/espresso',
          imageUrl: 'https://example.com/espresso.jpg',
          imageAlt: 'Espresso machine photo',
          isGroupGift: true,
          isMostWanted: true,
        },
      ],
    });
    expect(onResetDraft).toHaveBeenCalledTimes(1);
    expect(mockAddToast).toHaveBeenCalledWith(
      'Successfully added 1 items to your registry!',
      'success'
    );
    expect(mockPush).toHaveBeenCalledWith('/admin/dashboard/registry');
  });

  it('forwards paymentHandleType and paymentHandle for group gifts when includePaymentHandles is true', async () => {
    mockApiClientPost.mockResolvedValueOnce({ success: true, count: 1, items: [] });
    const onResetDraft = jest.fn();
    const onSuccess = jest.fn();

    const { result } = renderHook(() =>
      useTestHarness({
        initialItems: [buildPreviewItem()],
        includePaymentHandles: true,
        onResetDraft,
        onSuccess,
        formatSuccessToast: (count) => `Successfully imported ${count} items to your registry!`,
      })
    );

    await act(async () => {
      await result.current.handleImport();
    });

    expect(mockApiClientPost).toHaveBeenCalledWith('/api/registry/items/batch', {
      items: [
        expect.objectContaining({
          name: 'Espresso Machine',
          isGroupGift: true,
          paymentHandleType: 'Venmo',
          paymentHandle: '@couple-venmo',
        }),
      ],
    });
    expect(onResetDraft).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith(
      'Successfully imported 1 items to your registry!',
      'success'
    );
  });

  it('shows error toast when no valid items exist or when API submission fails', async () => {
    const { result: emptyResult } = renderHook(() =>
      useTestHarness({
        initialItems: [buildPreviewItem({ isValid: false })],
        includePaymentHandles: false,
      })
    );

    await act(async () => {
      await emptyResult.current.handleImport();
    });
    expect(mockAddToast).toHaveBeenCalledWith('No valid items to import.', 'error');
    expect(mockApiClientPost).not.toHaveBeenCalled();

    mockApiClientPost.mockRejectedValueOnce(new Error('Network unavailable'));
    const { result: failResult } = renderHook(() =>
      useTestHarness({
        initialItems: [buildPreviewItem()],
        includePaymentHandles: true,
      })
    );

    await act(async () => {
      await failResult.current.handleImport();
    });
    expect(mockAddToast).toHaveBeenCalledWith(
      'Failed to import items: Network unavailable',
      'error'
    );
  });
});
