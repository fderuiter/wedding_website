import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import SiteManagerPage from '../site-manager/page';
import { useAdminFeatures } from '@/hooks/admin/useAdminFeatures';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

jest.mock('@/hooks/admin/useAdminFeatures');
jest.mock('@/components/ui/ToastProvider', () => ({
  useToast: () => ({
    addToast: jest.fn(),
  }),
}));

// Mock next/dynamic to render component directly
jest.mock('next/dynamic', () => () => {
  return function MockDynamicComponent() {
    return <div data-testid="drag-drop-container">DragDrop Container Ready</div>;
  };
});

describe('SiteManagerPage View State', () => {
  const mockFetchAll = jest.fn();
  const mockSaveFeatures = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders structural DragDropSkeleton during loading instead of bare text', () => {
    (useAdminFeatures as jest.Mock).mockReturnValue({
      features: [],
      loading: true,
      error: null,
      saveFeatures: mockSaveFeatures,
      fetchAll: mockFetchAll,
    });

    render(<SiteManagerPage />);

    // Should NOT contain bare text string
    expect(screen.queryByText('Loading Site Manager...')).not.toBeInTheDocument();

    // Should contain accessible loading status live region and skeleton
    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders accessible error state with retry and dashboard buttons on failure', async () => {
    (useAdminFeatures as jest.Mock).mockReturnValue({
      features: [],
      loading: false,
      error: 'Failed to fetch features',
      saveFeatures: mockSaveFeatures,
      fetchAll: mockFetchAll,
    });

    render(<SiteManagerPage />);

    // Should render alert container
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByText('Error: Failed to fetch features')).toBeInTheDocument();

    // Verify retry button calls fetchAll
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(retryBtn);
    });
    expect(mockFetchAll).toHaveBeenCalledTimes(1);

    // Verify dashboard navigation button
    const dashboardBtn = screen.getByRole('button', { name: /back to dashboard/i });
    expect(dashboardBtn).toBeInTheDocument();
    fireEvent.click(dashboardBtn);
    expect(mockPush).toHaveBeenCalledWith('/admin/dashboard');
  });

  it('renders content when loaded successfully', () => {
    (useAdminFeatures as jest.Mock).mockReturnValue({
      features: [{ id: 'story', type: 'story', title: 'Our Story', visible: true }],
      loading: false,
      error: null,
      saveFeatures: mockSaveFeatures,
      fetchAll: mockFetchAll,
    });

    render(<SiteManagerPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Visual Site Manager' })).toBeInTheDocument();
    expect(screen.getByTestId('drag-drop-container')).toBeInTheDocument();
  });
});
