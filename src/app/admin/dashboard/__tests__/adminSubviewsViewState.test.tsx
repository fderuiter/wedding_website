import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

jest.mock('@/components/admin/AdminPreviewLayout', () => {
  return function MockAdminPreviewLayout({ children }: { children: React.ReactNode }) {
    return <div data-testid="admin-preview-layout">{children}</div>;
  };
});

jest.mock('@/components/ui/ToastProvider', () => ({
  useToast: () => ({
    confirm: jest.fn().mockResolvedValue(true),
    addToast: jest.fn(),
  }),
}));

jest.mock('@/hooks/admin/useAdminAttractions');
jest.mock('@/hooks/admin/useAdminContent');
jest.mock('@/hooks/admin/useAdminWeddingParty');
jest.mock('@/hooks/admin/useAdminBroadcast');

jest.mock('@/features/admin', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('@/features/admin/apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

import { useAdminAttractions } from '@/hooks/admin/useAdminAttractions';
import { useAdminContent } from '@/hooks/admin/useAdminContent';
import { useAdminWeddingParty } from '@/hooks/admin/useAdminWeddingParty';
import { useAdminBroadcast } from '@/hooks/admin/useAdminBroadcast';
import { apiClient as adminApiClient } from '@/features/admin';
import { apiClient as mediaApiClient } from '@/lib/apiClient';

import AttractionsDashboardPage from '../attractions/page';
import ContentDashboardPage from '../content/page';
import WeddingPartyDashboardPage from '../wedding-party/page';
import HistoryTimelinePage from '../history/page';
import MediaDashboardPage from '../media/page';

describe('AdminViewState Integration across Admin Subviews', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (useAdminBroadcast as jest.Mock).mockReturnValue({
      history: [],
      loadingHistory: false,
      retryBroadcast: jest.fn(),
      retrying: false,
      cancelScheduledBroadcast: jest.fn(),
      cancelling: false,
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('AttractionsDashboardPage', () => {
    it('renders polite live region announcement and skeleton placeholders while loading', () => {
      (useAdminAttractions as jest.Mock).mockReturnValue({
        data: [],
        isLoading: true,
        error: null,
        fetchAll: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        remove: jest.fn(),
      });

      render(<AttractionsDashboardPage />);

      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-live', 'polite');
      expect(screen.getByText('Loading attractions...')).toBeInTheDocument();
      expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('renders AdminViewState error card with working Retry and Back to Dashboard actions on failure', async () => {
      const mockFetchAll = jest.fn().mockResolvedValue(undefined);
      (useAdminAttractions as jest.Mock).mockReturnValue({
        data: [],
        isLoading: false,
        error: new Error('Failed to load attractions'),
        fetchAll: mockFetchAll,
        create: jest.fn(),
        update: jest.fn(),
        remove: jest.fn(),
      });

      render(<AttractionsDashboardPage />);

      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('aria-live', 'assertive');
      expect(screen.getByText('Error: Failed to load attractions')).toBeInTheDocument();

      const retryBtn = screen.getByRole('button', { name: /retry/i });
      await act(async () => {
        fireEvent.click(retryBtn);
      });
      expect(mockFetchAll).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: /back to dashboard/i }));
      expect(mockPush).toHaveBeenCalledWith('/admin/dashboard');
    });

    it('catches unhandled rendering exceptions via AdminViewState ErrorBoundary', () => {
      const mockFetchAll = jest.fn();
      (useAdminAttractions as jest.Mock).mockReturnValue({
        // Corrupted record missing id triggers runtime exception on attraction.id.startsWith
        data: [{ id: null, name: 'Corrupted Attraction', isVisible: true }],
        isLoading: false,
        error: null,
        fetchAll: mockFetchAll,
        create: jest.fn(),
        update: jest.fn(),
        remove: jest.fn(),
      });

      render(<AttractionsDashboardPage />);

      expect(screen.getByRole('alert')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /back to dashboard/i }));
      expect(mockPush).toHaveBeenCalledWith('/admin/dashboard');
    });
  });

  describe('ContentDashboardPage', () => {
    it('renders polite live region announcement and skeleton placeholders while loading', () => {
      (useAdminContent as jest.Mock).mockReturnValue({
        data: [],
        isLoading: true,
        error: null,
        fetchAll: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        remove: jest.fn(),
      });

      render(<ContentDashboardPage />);

      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-live', 'polite');
      expect(screen.getByText('Loading content...')).toBeInTheDocument();
      expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('renders AdminViewState error card with working Retry and Back to Dashboard actions on failure', async () => {
      const mockFetchAll = jest.fn().mockResolvedValue(undefined);
      (useAdminContent as jest.Mock).mockReturnValue({
        data: [],
        isLoading: false,
        error: new Error('Content query failed'),
        fetchAll: mockFetchAll,
        create: jest.fn(),
        update: jest.fn(),
        remove: jest.fn(),
      });

      render(<ContentDashboardPage />);

      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('aria-live', 'assertive');
      expect(screen.getByText('Error: Content query failed')).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /retry/i }));
      });
      expect(mockFetchAll).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: /back to dashboard/i }));
      expect(mockPush).toHaveBeenCalledWith('/admin/dashboard');
    });

    it('catches unhandled rendering exceptions on corrupted content nodes via ErrorBoundary', () => {
      (useAdminContent as jest.Mock).mockReturnValue({
        // Corrupted node missing tags array triggers runtime exception on node.tags.join
        data: [{ id: 'corrupt-1', type: 'FAQ', tags: null, data: {} }],
        isLoading: false,
        error: null,
        fetchAll: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        remove: jest.fn(),
      });

      render(<ContentDashboardPage />);

      expect(screen.getByRole('alert')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /back to dashboard/i }));
      expect(mockPush).toHaveBeenCalledWith('/admin/dashboard');
    });
  });

  describe('WeddingPartyDashboardPage', () => {
    it('renders polite live region announcement and skeleton placeholders while loading', () => {
      (useAdminWeddingParty as jest.Mock).mockReturnValue({
        data: [],
        isLoading: true,
        error: null,
        fetchAll: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        remove: jest.fn(),
        reorder: jest.fn(),
      });

      render(<WeddingPartyDashboardPage />);

      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-live', 'polite');
      expect(screen.getByText('Loading wedding party...')).toBeInTheDocument();
      expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('renders AdminViewState error card with working Retry and Back to Dashboard actions on failure', async () => {
      const mockFetchAll = jest.fn().mockResolvedValue(undefined);
      (useAdminWeddingParty as jest.Mock).mockReturnValue({
        data: [],
        isLoading: false,
        error: new Error('Wedding party query failed'),
        fetchAll: mockFetchAll,
        create: jest.fn(),
        update: jest.fn(),
        remove: jest.fn(),
        reorder: jest.fn(),
      });

      render(<WeddingPartyDashboardPage />);

      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('aria-live', 'assertive');
      expect(screen.getByText('Error: Wedding party query failed')).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /retry/i }));
      });
      expect(mockFetchAll).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: /back to dashboard/i }));
      expect(mockPush).toHaveBeenCalledWith('/admin/dashboard');
    });

    it('catches unhandled rendering exceptions via ErrorBoundary', () => {
      (useAdminWeddingParty as jest.Mock).mockReturnValue({
        data: [{ id: null, name: 'Corrupted Member', order: 0 }],
        isLoading: false,
        error: null,
        fetchAll: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        remove: jest.fn(),
        reorder: jest.fn(),
      });

      render(<WeddingPartyDashboardPage />);

      expect(screen.getByRole('alert')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /back to dashboard/i }));
      expect(mockPush).toHaveBeenCalledWith('/admin/dashboard');
    });
  });

  describe('HistoryTimelinePage', () => {
    const mockAdminGet = adminApiClient.get as jest.MockedFunction<typeof adminApiClient.get>;

    it('renders polite live region announcement and skeleton placeholders while loading', () => {
      mockAdminGet.mockReturnValue(new Promise(() => {}));

      render(<HistoryTimelinePage />);

      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-live', 'polite');
      expect(screen.getByText('Loading history...')).toBeInTheDocument();
      expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('renders AdminViewState error card on version query failure and recovers on Retry', async () => {
      mockAdminGet.mockRejectedValueOnce(new Error('Versions endpoint unreachable'));

      render(<HistoryTimelinePage />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
      expect(screen.getByText('Error: Versions endpoint unreachable')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /back to dashboard/i }));
      expect(mockPush).toHaveBeenCalledWith('/admin/dashboard');

      mockAdminGet.mockResolvedValueOnce([
        {
          id: 'ver-1',
          entityType: 'Attraction',
          author: 'Admin',
          createdAt: '2026-06-01T12:00:00.000Z',
          data: {},
        },
      ]);

      fireEvent.click(screen.getByRole('button', { name: /retry/i }));

      await waitFor(() => {
        expect(screen.getByText('System & Activity History')).toBeInTheDocument();
        expect(screen.getByText('Attraction')).toBeInTheDocument();
      });
      expect(mockAdminGet).toHaveBeenCalledTimes(2);
    });
  });

  describe('MediaDashboardPage ErrorBoundary', () => {
    const mockMediaGet = mediaApiClient.get as jest.MockedFunction<typeof mediaApiClient.get>;

    it('catches unhandled rendering exceptions in media view via ErrorBoundary', async () => {
      // Returning a null element inside media array triggers runtime error during m.id access
      mockMediaGet.mockResolvedValueOnce([null]);

      render(<MediaDashboardPage />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /back to dashboard/i }));
      expect(mockPush).toHaveBeenCalledWith('/admin/dashboard');
    });
  });
});
