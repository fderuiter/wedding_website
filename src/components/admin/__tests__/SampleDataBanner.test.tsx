import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SampleDataBanner, SeatingSampleDataBanner } from '../SampleDataBanner';
import { OnboardingChecklist } from '../OnboardingChecklist';
import { useSeatingState } from '@/features/seating';

expect.extend(toHaveNoViolations);

const mockRefresh = jest.fn();
const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: mockRefresh,
    push: mockPush,
  }),
}));

const mockAddToast = jest.fn();
const mockConfirm = jest.fn(() => Promise.resolve(true));

jest.mock('@/components/ui/ToastProvider', () => ({
  useToast: () => ({
    addToast: mockAddToast,
    confirm: mockConfirm,
  }),
}));

function SeatingObserverProbe() {
  const { tables, hiddenSampleTableCount } = useSeatingState();
  return (
    <div>
      <div data-testid="seating-table-count">{tables.length}</div>
      <div data-testid="seating-hidden-sample-count">{hiddenSampleTableCount}</div>
    </div>
  );
}

describe('SampleDataBanner', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
    window.localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('derives Purge Sample Data button accessible name from live visible text across idle and purging states and passes jest-axe', async () => {
    let resolveDelete!: (res: Response) => void;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          hasSampleData: true,
          counts: { registry: 4, guests: 6 },
        }),
      } as Response)
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveDelete = resolve;
          }),
      );

    const { container } = render(<SampleDataBanner />);

    const idleButton = await screen.findByRole('button', {
      name: 'Purge Sample Data',
    });
    expect(idleButton).toBeInTheDocument();
    expect(
      await axe(container, {
        rules: { 'label-content-name-mismatch': { enabled: true } },
      }),
    ).toHaveNoViolations();

    fireEvent.click(idleButton);

    const busyButton = await screen.findByRole('button', {
      name: 'Purging Sample Data...',
    });
    expect(busyButton).toBeDisabled();
    expect(
      await axe(container, {
        rules: { 'label-content-name-mismatch': { enabled: true } },
      }),
    ).toHaveNoViolations();

    resolveDelete({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'All sample data has been successfully purged.',
        'success',
      );
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it('invalidates all sample-affected QueryClient caches, refetches useSeatingState, and refreshes OnboardingChecklist on Purge Sample Data', async () => {
    let purged = false;
    let seatingFetchCalls = 0;
    let milestoneFetchCalls = 0;

    global.fetch = jest.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url = input.toString();
        const method = init?.method ?? 'GET';

        if (url === '/api/admin/sample-data' && method === 'GET') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              hasSampleData: !purged,
              counts: purged
                ? {}
                : {
                  registry: 3,
                  guests: 8,
                  seating: 2,
                  weddingParty: 4,
                  attractions: 2,
                  faqs: 3,
                },
            }),
          } as Response);
        }

        if (url === '/api/admin/sample-data' && method === 'DELETE') {
          purged = true;
          return Promise.resolve({
            ok: true,
            json: async () => ({ success: true }),
          } as Response);
        }

        if (url === '/api/admin/seating-tables') {
          seatingFetchCalls++;
          return Promise.resolve({
            ok: true,
            json: async () =>
              purged
                ? []
                : [
                  {
                    id: 'sample-table-1',
                    name: 'Sample Table 1',
                    capacity: 8,
                    x: 100,
                    y: 100,
                    width: 120,
                    height: 120,
                    rotation: 0,
                    shape: 'round',
                    isSample: true,
                    invitationCodes: [],
                  },
                ],
          } as Response);
        }

        if (url.startsWith('/api/admin/invitation-codes/catalog')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              items: [],
            }),
          } as Response);
        }

        if (url === '/api/admin/onboarding-milestones') {
          milestoneFetchCalls++;
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              completedCount: purged ? 1 : 0,
              pendingCount: purged ? 0 : 1,
              totalCount: 1,
              allComplete: purged,
              milestones: [
                {
                  id: 'wedding-details',
                  title: 'Wedding Details',
                  description:
                    'Verify partner names, wedding date, venue name, and your public website URL.',
                  completed: purged,
                  href: '/admin/dashboard/settings',
                  actionLabel: purged
                    ? 'Edit Wedding Details'
                    : 'Add Wedding Details',
                },
              ],
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          json: async () => ({}),
        } as Response);
      },
    ) as jest.Mock;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    // Seed cached entries across every sample-data-affected TanStack Query key
    const seededKeys = [
      ['admin-registry'],
      ['registry-items'],
      ['admin-invitation-codes'],
      ['admin-wedding-party'],
      ['admin-attractions'],
      ['admin-content-nodes'],
    ];
    for (const key of seededKeys) {
      queryClient.setQueryData(key, [{ id: 'sample-row', isSample: true }]);
    }

    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    render(
      <QueryClientProvider client={queryClient}>
        <SampleDataBanner />
        <OnboardingChecklist />
        <SeatingObserverProbe />
      </QueryClientProvider>,
    );

    const purgeBtn = await screen.findByRole('button', {
      name: 'Purge Sample Data',
    });
    await waitFor(() => {
      expect(screen.getByTestId('seating-table-count')).toHaveTextContent('0');
      expect(screen.getByTestId('seating-hidden-sample-count')).toHaveTextContent('1');
      expect(
        screen.getByText('0 of 1 milestones completed (1 pending)'),
      ).toBeInTheDocument();
    });

    fireEvent.click(purgeBtn);

    await waitFor(() => {
      expect(
        screen.queryByTestId('sample-data-banner'),
      ).not.toBeInTheDocument();
    });

    const invalidatedKeys = invalidateSpy.mock.calls.map(
      (call) => call[0]?.queryKey,
    );
    expect(invalidatedKeys).toEqual(
      expect.arrayContaining([
        ['admin-registry'],
        ['registry-items'],
        ['admin-invitation-codes'],
        ['admin-wedding-party'],
        ['admin-attractions'],
        ['admin-content-nodes'],
        ['admin-seating'],
        ['admin-onboarding-milestones'],
        ['admin-sample-data'],
      ]),
    );

    // Verify every seeded query cache entry was marked invalidated
    for (const key of seededKeys) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }

    // Verify both useSeatingState and OnboardingChecklist refetched immediately without page reload
    await waitFor(() => {
      expect(seatingFetchCalls).toBeGreaterThanOrEqual(2);
      expect(milestoneFetchCalls).toBeGreaterThanOrEqual(2);
      expect(screen.getByTestId('seating-table-count')).toHaveTextContent('0');
      expect(screen.getByTestId('seating-hidden-sample-count')).toHaveTextContent('0');
      expect(
        screen.getByText('1 of 1 milestones completed (0 pending)'),
      ).toBeInTheDocument();
    });
  });

  it('renders SeatingSampleDataBanner with hidden counts, purges via DELETE /api/admin/sample-data, and passes jest-axe', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);

    const { container } = render(
      <SeatingSampleDataBanner hiddenTableCount={2} hiddenGuestCount={6} />,
    );

    const banner = screen.getByTestId('seating-sample-data-banner');
    expect(banner).toHaveTextContent(
      'Sample records hidden: 2 sample tables and 6 sample guests are excluded from live seating, auto-assign, and caterer exports.',
    );
    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(screen.getByRole('button', { name: 'Purge Sample Data' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/sample-data',
        expect.objectContaining({ method: 'DELETE' }),
      );
      expect(mockAddToast).toHaveBeenCalledWith(
        'All sample data has been successfully purged.',
        'success',
      );
      expect(mockRefresh).toHaveBeenCalled();
      expect(screen.queryByTestId('seating-sample-data-banner')).not.toBeInTheDocument();
    });
  });
});
