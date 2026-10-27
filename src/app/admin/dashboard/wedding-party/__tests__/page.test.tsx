import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WeddingPartyDashboardPage from '../page';
import { useAdminWeddingParty } from '@/hooks/admin/useAdminWeddingParty';

jest.mock('@/hooks/admin/useAdminWeddingParty');
jest.mock('@/components/admin/AdminPreviewLayout', () => {
  return function MockAdminPreviewLayout({ children }: { children: React.ReactNode }) {
    return <div data-testid="admin-preview-layout">{children}</div>;
  };
});
jest.mock('@/hooks/useFocusSuccessor', () => ({
  useFocusSuccessor: () => ({
    containerRef: { current: null },
    captureFocusTarget: jest.fn(),
  }),
}));
jest.mock('@/components/ui/ToastProvider', () => ({
  useToast: () => ({
    confirm: jest.fn().mockResolvedValue(true),
    addToast: jest.fn(),
  }),
}));

const mockUseAdminWeddingParty = useAdminWeddingParty as jest.MockedFunction<typeof useAdminWeddingParty>;

describe('WeddingPartyDashboardPage Reordering', () => {
  const mockReorder = jest.fn();
  const mockFetchAll = jest.fn();
  const mockCreate = jest.fn();
  const mockUpdate = jest.fn();
  const mockRemove = jest.fn();

  const mockMembers = [
    {
      id: 'member-1',
      name: 'Alice',
      role: 'Maid of Honor',
      bio: 'Alice bio',
      order: 0,
      link: '',
      isSample: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'member-2',
      name: 'Bob',
      role: 'Best Man',
      bio: 'Bob bio',
      order: 1,
      link: '',
      isSample: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockReorder.mockResolvedValue(undefined);
    mockUseAdminWeddingParty.mockReturnValue({
      data: mockMembers as any,
      isLoading: false,
      isError: false,
      error: null,
      fetchAll: mockFetchAll,
      create: mockCreate,
      update: mockUpdate,
      remove: mockRemove,
      reorder: mockReorder,
      toggleVisibility: jest.fn(),
      optimisticItems: [],
    } as any);
  });

  it('renders Move Up and Move Down buttons and handles reordering', async () => {
    render(<WeddingPartyDashboardPage />);

    const moveDownButtons = screen.getAllByRole('button', { name: /move alice down/i });
    expect(moveDownButtons[0]).not.toBeDisabled();

    fireEvent.click(moveDownButtons[0]);

    await waitFor(() => {
      expect(mockReorder).toHaveBeenCalledWith(['member-2', 'member-1']);
    });
  });

  it('disables Move Up on the first member and Move Down on the last member', () => {
    render(<WeddingPartyDashboardPage />);

    const aliceMoveUp = screen.getByRole('button', { name: /move alice up/i });
    expect(aliceMoveUp).toBeDisabled();

    const bobMoveDown = screen.getByRole('button', { name: /move bob down/i });
    expect(bobMoveDown).toBeDisabled();
  });
});
