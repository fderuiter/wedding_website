import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe } from 'jest-axe';
import AdminDashboardPage from '../page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
  }),
}));

const mockFetch = jest.fn();

beforeEach(() => {
  (global.fetch as unknown) = mockFetch as unknown as typeof fetch;
  (window.fetch as unknown) = mockFetch as unknown as typeof fetch;
  window.localStorage.clear();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('AdminDashboardPage (Decoupled Overview)', () => {
  it('renders the Admin Overview, OnboardingChecklist, and workflow cards without querying registry items', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/admin/settings') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            modules: { registry: true, gallery: true },
          }),
        });
      }
      if (url === '/api/admin/onboarding-milestones') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            completedCount: 2,
            pendingCount: 2,
            totalCount: 4,
            allComplete: false,
            milestones: [
              {
                id: 'wedding-details',
                title: 'Wedding Details',
                description: 'Verify partner names and your public website URL.',
                completed: true,
                href: '/admin/dashboard/settings',
                actionLabel: 'Edit Wedding Details',
              },
              {
                id: 'guest-list',
                title: 'Guest List',
                description: 'Import or add guest invitations so guests can RSVP.',
                completed: true,
                href: '/admin/dashboard/invitation-codes',
                actionLabel: 'Manage Guest List',
              },
              {
                id: 'registry',
                title: 'Gift Registry',
                description: 'Add gifts or cash funds to your wedding registry.',
                completed: false,
                href: '/registry/add-item',
                actionLabel: 'Add Registry Gifts',
              },
              {
                id: 'seating-layout',
                title: 'Seating Layout',
                description: 'Create reception tables and organize your seating chart.',
                completed: false,
                href: '/admin/dashboard/seating-chart',
                actionLabel: 'Create Seating Layout',
              },
            ],
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    const { container } = render(
      <main>
        <AdminDashboardPage />
      </main>
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Admin Overview' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view live site/i })).toHaveAttribute('href', '/');
    expect(await screen.findByTestId('onboarding-checklist')).toBeInTheDocument();

    expect(screen.getByTestId('overview-card-invitations')).toHaveAttribute(
      'href',
      '/admin/dashboard/invitation-codes'
    );
    expect(screen.getByTestId('overview-card-registry')).toHaveAttribute(
      'href',
      '/admin/dashboard/registry'
    );
    expect(screen.getByTestId('overview-card-seating')).toHaveAttribute(
      'href',
      '/admin/dashboard/seating-chart'
    );
    expect(screen.getByTestId('overview-card-content')).toHaveAttribute(
      'href',
      '/admin/dashboard/content'
    );
    expect(screen.getByTestId('overview-card-media')).toHaveAttribute(
      'href',
      '/admin/dashboard/media'
    );
    expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining('/api/registry/items'));

    const axeResults = await axe(container);
    expect(axeResults).toHaveNoViolations();
  });

  it('hides Gift Registry and Media Library workflow cards when their modules are disabled', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/admin/settings') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            modules: { registry: false, gallery: false },
          }),
        });
      }
      if (url === '/api/admin/onboarding-milestones') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            completedCount: 1,
            pendingCount: 2,
            totalCount: 3,
            allComplete: false,
            milestones: [
              {
                id: 'wedding-details',
                title: 'Wedding Details',
                description: 'Verify partner names and your public website URL.',
                completed: true,
                href: '/admin/dashboard/settings',
                actionLabel: 'Edit Wedding Details',
              },
              {
                id: 'guest-list',
                title: 'Guest List',
                description: 'Import or add guest invitations so guests can RSVP.',
                completed: false,
                href: '/admin/dashboard/invitation-codes',
                actionLabel: 'Add Guest List',
              },
              {
                id: 'seating-layout',
                title: 'Seating Layout',
                description: 'Create reception tables and organize your seating chart.',
                completed: false,
                href: '/admin/dashboard/seating-chart',
                actionLabel: 'Create Seating Layout',
              },
            ],
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    render(<AdminDashboardPage />);

    expect(await screen.findByText('1 of 3 milestones completed (2 pending)')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByTestId('overview-card-registry')).not.toBeInTheDocument();
      expect(screen.queryByTestId('overview-card-media')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('overview-card-invitations')).toBeInTheDocument();
    expect(screen.getByTestId('overview-card-seating')).toBeInTheDocument();
    expect(screen.getByTestId('overview-card-settings')).toBeInTheDocument();
  });
});
