import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe } from 'jest-axe';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/ToastProvider';
import {
  OnboardingChecklist,
  ONBOARDING_CHECKLIST_COLLAPSED_KEY,
  type OnboardingMilestone,
} from '../OnboardingChecklist';
import AdminDashboardPage from '@/app/admin/dashboard/page';
import { checkAdminClient as mockCheckAdminClient } from '@/core/auth/auth.client';

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
}));

jest.mock('@/core/auth/auth.client');

function buildMilestones(overrides: Partial<Record<string, boolean>> = {}): OnboardingMilestone[] {
  const state = {
    'wedding-details': true,
    'guest-list': false,
    registry: false,
    'seating-layout': false,
    ...overrides,
  };

  return [
    {
      id: 'wedding-details',
      title: 'Wedding Details',
      description: 'Verify partner names and your public website URL.',
      completed: Boolean(state['wedding-details']),
      href: '/admin/dashboard/settings',
      actionLabel: state['wedding-details'] ? 'Edit Wedding Details' : 'Configure Wedding Details',
    },
    {
      id: 'guest-list',
      title: 'Guest List',
      description: 'Import or add guest invitations so guests can RSVP.',
      completed: Boolean(state['guest-list']),
      href: '/admin/dashboard/invitation-codes',
      actionLabel: state['guest-list'] ? 'Manage Guest List' : 'Add Guest List',
    },
    {
      id: 'registry',
      title: 'Gift Registry',
      description: 'Add gifts or cash funds to your wedding registry.',
      completed: Boolean(state.registry),
      href: '/registry/add-item',
      actionLabel: state.registry ? 'Add More Gifts' : 'Add Registry Gifts',
    },
    {
      id: 'seating-layout',
      title: 'Seating Layout',
      description: 'Create reception tables and organize your seating chart.',
      completed: Boolean(state['seating-layout']),
      href: '/admin/dashboard/seating-chart',
      actionLabel: state['seating-layout'] ? 'Edit Seating Layout' : 'Create Seating Layout',
    },
  ];
}

function buildApiResponse(overrides: Partial<Record<string, boolean>> = {}) {
  const milestones = buildMilestones(overrides);
  const completedCount = milestones.filter((m) => m.completed).length;
  const totalCount = milestones.length;
  return {
    success: true,
    completedCount,
    pendingCount: totalCount - completedCount,
    totalCount,
    allComplete: completedCount === totalCount,
    milestones,
  };
}

describe('OnboardingChecklist', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    (global.fetch as unknown) = mockFetch as unknown as typeof fetch;
    (window.fetch as unknown) = mockFetch as unknown as typeof fetch;
    (mockCheckAdminClient as jest.Mock).mockResolvedValue(true);
  });

  it('displays four core milestones and accurate progress summary (Criteria 1 & Req 7)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => buildApiResponse({ 'wedding-details': true, 'guest-list': true }),
    });

    render(<OnboardingChecklist />);

    expect(await screen.findByRole('heading', { name: 'Setup Checklist' })).toBeInTheDocument();
    expect(screen.getByText('Wedding Details')).toBeInTheDocument();
    expect(screen.getByText('Guest List')).toBeInTheDocument();
    expect(screen.getByText('Gift Registry')).toBeInTheDocument();
    expect(screen.getByText('Seating Layout')).toBeInTheDocument();

    expect(screen.getByText('2 of 4 milestones completed (2 pending)')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();

    const progressbar = screen.getByRole('progressbar', { name: 'Setup milestone completion progress' });
    expect(progressbar).toHaveAttribute('aria-valuenow', '2');
    expect(progressbar).toHaveAttribute('aria-valuemax', '4');
    expect(progressbar).toHaveAttribute('aria-valuetext', '2 of 4 milestones completed, 2 pending');

    expect(screen.queryByTestId('onboarding-all-complete-badge')).not.toBeInTheDocument();
  });

  it('navigates directly to each milestone management page on button click (Criterion 3 & Req 8)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => buildApiResponse({ 'wedding-details': true }),
    });

    render(<OnboardingChecklist />);
    await screen.findByRole('heading', { name: 'Setup Checklist' });

    fireEvent.click(screen.getByRole('button', { name: 'Edit Wedding Details' }));
    expect(mockPush).toHaveBeenCalledWith('/admin/dashboard/settings');

    fireEvent.click(screen.getByRole('button', { name: 'Add Guest List' }));
    expect(mockPush).toHaveBeenCalledWith('/admin/dashboard/invitation-codes');

    fireEvent.click(screen.getByRole('button', { name: 'Add Registry Gifts' }));
    expect(mockPush).toHaveBeenCalledWith('/registry/add-item');

    fireEvent.click(screen.getByRole('button', { name: 'Create Seating Layout' }));
    expect(mockPush).toHaveBeenCalledWith('/admin/dashboard/seating-chart');
  });

  it('collapses task list while preserving progress bar and persists preference in localStorage (Criterion 4 & Reqs 9-10)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => buildApiResponse({ 'wedding-details': true }),
    });

    const { unmount } = render(<OnboardingChecklist />);
    await screen.findByTestId('onboarding-checklist-items');

    const collapseBtn = screen.getByRole('button', { name: /Collapse Checklist/i });
    expect(collapseBtn).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(collapseBtn);

    expect(screen.queryByTestId('onboarding-checklist-items')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Setup milestone completion progress' })).toBeInTheDocument();
    expect(screen.getByText('1 of 4 milestones completed (3 pending)')).toBeInTheDocument();
    expect(window.localStorage.getItem(ONBOARDING_CHECKLIST_COLLAPSED_KEY)).toBe('true');

    // Simulate reload / remount
    unmount();
    render(<OnboardingChecklist />);

    const expandBtn = await screen.findByRole('button', { name: /Expand Checklist/i });
    expect(expandBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('onboarding-checklist-items')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Setup milestone completion progress' })).toBeInTheDocument();

    // Expand again
    fireEvent.click(expandBtn);
    expect(await screen.findByTestId('onboarding-checklist-items')).toBeInTheDocument();
    expect(window.localStorage.getItem(ONBOARDING_CHECKLIST_COLLAPSED_KEY)).toBe('false');
  });

  it('displays the all-complete badge when all four milestones are satisfied (Criterion 5)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () =>
        buildApiResponse({
          'wedding-details': true,
          'guest-list': true,
          registry: true,
          'seating-layout': true,
        }),
    });

    render(<OnboardingChecklist />);

    const badge = await screen.findByTestId('onboarding-all-complete-badge');
    expect(badge).toHaveTextContent('All Milestones Complete');
    expect(screen.getByText('4 of 4 milestones completed (0 pending)')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('handles restricted localStorage exceptions without crashing', async () => {
    const getItemSpy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => buildApiResponse({ 'wedding-details': true }),
    });

    render(<OnboardingChecklist />);
    const collapseBtn = await screen.findByRole('button', { name: /Collapse Checklist/i });
    fireEvent.click(collapseBtn);
    expect(screen.queryByTestId('onboarding-checklist-items')).not.toBeInTheDocument();

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  it('passes jest-axe accessibility checks in expanded, collapsed, and all-complete states', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => buildApiResponse({ 'wedding-details': true, registry: true }),
    });

    const { container, unmount } = render(<OnboardingChecklist />);
    await screen.findByTestId('onboarding-checklist-items');
    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(screen.getByRole('button', { name: /Collapse Checklist/i }));
    expect(await axe(container)).toHaveNoViolations();
    unmount();

    window.localStorage.clear();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () =>
        buildApiResponse({
          'wedding-details': true,
          'guest-list': true,
          registry: true,
          'seating-layout': true,
        }),
    });
    const allDoneRender = render(<OnboardingChecklist />);
    await screen.findByTestId('onboarding-all-complete-badge');
    expect(await axe(allDoneRender.container)).toHaveNoViolations();
  });

  it('renders above the registry table on AdminDashboardPage and updates upon revisit (Criterion 2 & Req 6)', async () => {
    let guestListDone = false;

    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith('/api/registry/items')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 'item-1',
              name: 'Espresso Machine',
              description: 'Kitchen gift',
              category: 'Kitchen',
              price: 250,
              image: '/img.jpg',
              vendorUrl: null,
              quantity: 1,
              isGroupGift: false,
              purchased: false,
              amountContributed: 0,
              contributors: [],
            },
          ],
        });
      }
      if (url === '/api/admin/onboarding-milestones') {
        return Promise.resolve({
          ok: true,
          json: async () =>
            buildApiResponse({
              'wedding-details': true,
              'guest-list': guestListDone,
              registry: true,
              'seating-layout': false,
            }),
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    const renderPage = () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      return render(
        <ToastProvider>
          <QueryClientProvider client={queryClient}>
            <AdminDashboardPage />
          </QueryClientProvider>
        </ToastProvider>
      );
    };

    const firstVisit = renderPage();
    const checklist = await screen.findByTestId('onboarding-checklist');
    const registryTable = screen.getByRole('table');

    // Verify checklist appears BEFORE the registry table in DOM order
    expect(
      checklist.compareDocumentPosition(registryTable) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    expect(screen.getByText('2 of 4 milestones completed (2 pending)')).toBeInTheDocument();
    firstVisit.unmount();

    // Simulate completing guest list in its view and revisiting the dashboard
    guestListDone = true;
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('3 of 4 milestones completed (1 pending)')).toBeInTheDocument();
    });
  });
});
