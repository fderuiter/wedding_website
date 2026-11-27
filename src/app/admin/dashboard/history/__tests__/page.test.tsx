import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { BroadcastHistoryItem } from '@/features/broadcast';

expect.extend(toHaveNoViolations);

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

jest.mock('@/components/ui/ToastProvider', () => ({
  useToast: () => ({
    confirm: jest.fn().mockResolvedValue(true),
    addToast: jest.fn(),
  }),
}));

const mockRetryBroadcast = jest.fn();
const mockCancelScheduledBroadcast = jest.fn();
const defaultBroadcastHistory: BroadcastHistoryItem[] = [
  {
    id: 'bc-1',
    channel: 'EMAIL' as const,
    subject: 'Schedule Update',
    body: 'Shuttle departs at 4:30 PM',
    sentCount: 2,
    viewedCount: 1,
    totalRecipients: 2,
    failedCount: 0,
    status: 'SENT' as const,
    createdAt: '2026-06-02T15:00:00.000Z',
    recipients: [
      {
        id: 'rec-viewed-1',
        guestName: 'Alice Viewed',
        destination: 'alice@example.com',
        status: 'VIEWED',
        sentAt: '2026-06-02T15:01:00.000Z',
      },
      {
        id: 'rec-sent-2',
        guestName: 'Bob Sent',
        destination: 'bob@example.com',
        status: 'SENT',
        sentAt: '2026-06-02T15:01:05.000Z',
      },
    ],
  },
];
const mockUseAdminBroadcast = jest.fn((_options?: { fetchHistory?: boolean }) => ({
  history: defaultBroadcastHistory,
  loadingHistory: false,
  retryBroadcast: mockRetryBroadcast,
  retrying: false,
  cancelScheduledBroadcast: mockCancelScheduledBroadcast,
  cancelling: false,
}));

jest.mock('@/hooks/admin/useAdminBroadcast', () => ({
  useAdminBroadcast: (options?: { fetchHistory?: boolean }) => mockUseAdminBroadcast(options),
}));

jest.mock('@/features/admin', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

import { apiClient } from '@/features/admin';
import HistoryTimelinePage from '../page';

describe('HistoryTimelinePage SegmentedTabs accessibility', () => {
  const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue([
      {
        id: 'ver-1',
        entityType: 'Schedule',
        author: 'Admin',
        createdAt: '2026-06-01T12:00:00.000Z',
        data: {},
      },
    ]);
  });

  it('exposes tablist, tab, aria-selected, aria-controls, roving tabIndex, tabpanel, and passes jest-axe', async () => {
    const { container } = render(<HistoryTimelinePage />);

    await waitFor(() => {
      expect(screen.getByText('System & Activity History')).toBeInTheDocument();
    });

    const tablist = screen.getByRole('tablist', { name: 'History views' });
    expect(tablist).toBeInTheDocument();

    const snapshotsTab = screen.getByRole('tab', { name: 'Content Snapshots' });
    const broadcastsTab = screen.getByRole('tab', { name: 'Broadcast Delivery Logs' });
    const tabpanel = screen.getByRole('tabpanel');

    expect(snapshotsTab).toHaveAttribute('id', 'history-tab-timeline');
    expect(snapshotsTab).toHaveAttribute('aria-selected', 'true');
    expect(snapshotsTab).toHaveAttribute('aria-controls', 'history-view-panel');
    expect(snapshotsTab).toHaveAttribute('tabIndex', '0');
    expect(snapshotsTab.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();

    expect(broadcastsTab).toHaveAttribute('id', 'history-tab-broadcasts');
    expect(broadcastsTab).toHaveAttribute('aria-selected', 'false');
    expect(broadcastsTab).toHaveAttribute('aria-controls', 'history-view-panel');
    expect(broadcastsTab).toHaveAttribute('tabIndex', '-1');

    expect(tabpanel).toHaveAttribute('id', 'history-view-panel');
    expect(tabpanel).toHaveAttribute('aria-labelledby', 'history-tab-timeline');
    expect(screen.getByText('Schedule')).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();

    // Navigate via ArrowRight key to Broadcast Delivery Logs tab
    snapshotsTab.focus();
    fireEvent.keyDown(snapshotsTab, { key: 'ArrowRight' });

    expect(broadcastsTab).toHaveFocus();
    expect(broadcastsTab).toHaveAttribute('aria-selected', 'true');
    expect(broadcastsTab).toHaveAttribute('tabIndex', '0');
    expect(snapshotsTab).toHaveAttribute('aria-selected', 'false');
    expect(snapshotsTab).toHaveAttribute('tabIndex', '-1');
    expect(tabpanel).toHaveAttribute('aria-labelledby', 'history-tab-broadcasts');
    expect(screen.getByText('Schedule Update')).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });

  it('opens directly on Broadcast Delivery Logs tab when ?tab=broadcasts is in the URL', async () => {
    window.history.pushState({}, '', '/admin/dashboard/history?tab=broadcasts');

    try {
      const { container } = render(<HistoryTimelinePage />);

      await waitFor(() => {
        expect(screen.getByText('System & Activity History')).toBeInTheDocument();
      });

      const broadcastsTab = screen.getByRole('tab', { name: 'Broadcast Delivery Logs' });
      const snapshotsTab = screen.getByRole('tab', { name: 'Content Snapshots' });

      expect(broadcastsTab).toHaveAttribute('aria-selected', 'true');
      expect(snapshotsTab).toHaveAttribute('aria-selected', 'false');
      expect(screen.getByText('Schedule Update')).toBeInTheDocument();
      expect(screen.getByText('(1 viewed)')).toBeInTheDocument();

      // Open Broadcast Details modal and verify VIEWED count, VIEWED badge, and per-recipient Resend
      fireEvent.click(screen.getByRole('button', { name: 'Details' }));
      expect(screen.getByText(/Viewed Count:/i).parentElement).toHaveTextContent('Viewed Count: 1');
      expect(screen.getByText('VIEWED')).toBeInTheDocument();

      mockRetryBroadcast.mockResolvedValueOnce({});
      const resendBobBtn = screen.getByRole('button', { name: 'Resend to Bob Sent' });
      fireEvent.click(resendBobBtn);

      await waitFor(() => {
        expect(mockRetryBroadcast).toHaveBeenCalledWith({
          broadcastId: 'bc-1',
          recipientIds: ['rec-sent-2'],
        });
      });

      expect(await axe(container)).toHaveNoViolations();
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('disables broadcast history fetch on timeline tab and enables it when switching to broadcasts tab', async () => {
    render(<HistoryTimelinePage />);

    await waitFor(() => {
      expect(screen.getByText('System & Activity History')).toBeInTheDocument();
    });

    expect(mockUseAdminBroadcast).toHaveBeenLastCalledWith({ fetchHistory: false });

    const broadcastsTab = screen.getByRole('tab', { name: 'Broadcast Delivery Logs' });
    fireEvent.click(broadcastsTab);

    expect(mockUseAdminBroadcast).toHaveBeenLastCalledWith({ fetchHistory: true });
  });

  it('renders Created/Updated and Deleted badges from scoped summary payloads and triggers version restore', async () => {
    const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
    mockPost.mockResolvedValueOnce({ success: true });
    mockGet.mockResolvedValueOnce({
      items: [
        {
          id: 'ver-summary-live',
          entityType: 'AppConfig',
          entityId: 'global',
          author: 'Admin',
          createdAt: '2026-06-05T10:00:00.000Z',
          data: {},
        },
        {
          id: 'ver-summary-deleted',
          entityType: 'RegistryItem',
          entityId: 'reg-deleted-1',
          author: 'Admin',
          createdAt: '2026-06-04T09:30:00.000Z',
          data: { deleted: true },
        },
      ],
      pagination: {
        total: 2,
        page: 1,
        limit: 50,
        totalPages: 1,
      },
    });

    const { container } = render(<HistoryTimelinePage />);

    await waitFor(() => {
      expect(screen.getByText('Created/Updated')).toBeInTheDocument();
      expect(screen.getByText('Deleted')).toBeInTheDocument();
    });

    expect(mockGet).toHaveBeenCalledWith('/api/admin/versions?page=1&limit=50');
    expect(await axe(container)).toHaveNoViolations();

    const restoreButtons = screen.getAllByRole('button', { name: 'Restore' });
    expect(restoreButtons).toHaveLength(2);

    mockGet.mockResolvedValueOnce({ items: [], pagination: { total: 0, page: 1, limit: 50, totalPages: 0 } });
    fireEvent.click(restoreButtons[1]);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/admin/versions/ver-summary-deleted/restore');
      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(screen.getByText('No history found.')).toBeInTheDocument();
    });
  });

  it('lazily fetches GET /api/admin/broadcast/[id] on Details click, shows loading state, renders recipients and errors, and refreshes after retry', async () => {
    window.history.pushState({}, '', '/admin/dashboard/history?tab=broadcasts');

    mockUseAdminBroadcast.mockImplementation(() => ({
      history: [
        {
          id: 'bc-lazy-1',
          channel: 'EMAIL' as const,
          subject: 'Reception Reminder',
          body: 'Snippet body',
          sentCount: 1,
          viewedCount: 1,
          totalRecipients: 2,
          failedCount: 1,
          status: 'PARTIALLY_SENT' as const,
          createdAt: '2026-06-02T15:00:00.000Z',
        },
      ],
      loadingHistory: false,
      retryBroadcast: mockRetryBroadcast,
      retrying: false,
      cancelScheduledBroadcast: mockCancelScheduledBroadcast,
      cancelling: false,
    }));

    let resolveDetail!: (_value: unknown) => void;
    const initialDetailPromise = new Promise((resolve) => {
      resolveDetail = resolve;
    });

    let detailFetchCount = 0;
    mockGet.mockImplementation((url: string) => {
      if (url.startsWith('/api/admin/versions')) {
        return Promise.resolve([
          {
            id: 'ver-1',
            entityType: 'Schedule',
            author: 'Admin',
            createdAt: '2026-06-01T12:00:00.000Z',
            data: {},
          },
        ]);
      }
      if (url === '/api/admin/broadcast/bc-lazy-1') {
        detailFetchCount += 1;
        if (detailFetchCount === 1) {
          return initialDetailPromise;
        }
        return Promise.resolve({
          id: 'bc-lazy-1',
          channel: 'EMAIL',
          subject: 'Reception Reminder',
          body: 'Full personalized message body after retry',
          sentCount: 2,
          totalRecipients: 2,
          failedCount: 0,
          status: 'SENT',
          createdAt: '2026-06-02T15:00:00.000Z',
          recipients: [
            {
              id: 'rec-1',
              guestName: 'Maya Lin',
              destination: 'maya@example.com',
              status: 'SENT',
              error: null,
            },
            {
              id: 'rec-2',
              guestName: 'Noah Patel',
              destination: 'noah@example.com',
              status: 'SENT',
              error: null,
            },
          ],
        });
      }
      return Promise.resolve([]);
    });

    try {
      const { container } = render(<HistoryTimelinePage />);

      await waitFor(() => {
        expect(screen.getByText('Reception Reminder')).toBeInTheDocument();
      });

      expect(screen.getByText('(1 viewed)')).toBeInTheDocument();
      expect(mockGet).not.toHaveBeenCalledWith('/api/admin/broadcast/bc-lazy-1');

      fireEvent.click(screen.getByRole('button', { name: 'Details' }));

      expect(screen.getByText('Loading recipient delivery statuses...')).toBeInTheDocument();
      expect(mockGet).toHaveBeenCalledWith('/api/admin/broadcast/bc-lazy-1');

      resolveDetail({
        id: 'bc-lazy-1',
        channel: 'EMAIL',
        subject: 'Reception Reminder',
        body: 'Full personalized message body',
        sentCount: 1,
        totalRecipients: 2,
        failedCount: 1,
        status: 'PARTIALLY_SENT',
        createdAt: '2026-06-02T15:00:00.000Z',
        recipients: [
          {
            id: 'rec-2',
            guestName: 'Noah Patel',
            destination: 'noah@example.com',
            status: 'FAILED',
            error: '550 Mailbox unavailable',
          },
          {
            id: 'rec-1',
            guestName: 'Maya Lin',
            destination: 'maya@example.com',
            status: 'SENT',
            error: null,
          },
        ],
      });

      await waitFor(() => {
        expect(screen.getByText('550 Mailbox unavailable')).toBeInTheDocument();
      });
      expect(screen.getByText('Full personalized message body')).toBeInTheDocument();
      expect(screen.getByText('Noah Patel')).toBeInTheDocument();
      expect(screen.getByText('Maya Lin')).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      mockRetryBroadcast.mockResolvedValueOnce({ id: 'bc-lazy-1', status: 'SENT' });
      fireEvent.click(screen.getByRole('button', { name: 'Retry Failed Dispatches' }));

      await waitFor(() => {
        expect(detailFetchCount).toBe(2);
        expect(screen.getByText('Full personalized message body after retry')).toBeInTheDocument();
      });
      expect(screen.queryByText('550 Mailbox unavailable')).not.toBeInTheDocument();
    } finally {
      mockUseAdminBroadcast.mockReset();
      mockUseAdminBroadcast.mockImplementation(() => ({
        history: defaultBroadcastHistory,
        loadingHistory: false,
        retryBroadcast: mockRetryBroadcast,
        retrying: false,
        cancelScheduledBroadcast: mockCancelScheduledBroadcast,
        cancelling: false,
      }));
      window.history.pushState({}, '', '/');
    }
  });
});
