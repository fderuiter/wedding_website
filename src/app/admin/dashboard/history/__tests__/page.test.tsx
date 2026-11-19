import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';

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

jest.mock('@/hooks/admin/useAdminBroadcast', () => ({
  useAdminBroadcast: () => ({
    history: [
      {
        id: 'bc-1',
        channel: 'EMAIL',
        subject: 'Schedule Update',
        body: 'Shuttle departs at 4:30 PM',
        sentCount: 24,
        totalRecipients: 24,
        failedCount: 0,
        status: 'SENT',
        createdAt: '2026-06-02T15:00:00.000Z',
        recipients: [],
      },
    ],
    loadingHistory: false,
    retryBroadcast: jest.fn(),
    retrying: false,
    cancelScheduledBroadcast: jest.fn(),
    cancelling: false,
  }),
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
});
