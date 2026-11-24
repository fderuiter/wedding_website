import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import NotFound from '@/app/not-found';
import EmptyState from '@/components/EmptyState';
import { AdminEditorContainer } from '@/components/admin/AdminEditorContainer';
import GuestAddressPage from '@/app/guest/GuestPortalClient';
import { AddItemPage as AddRegistryItemPage } from '@/features/registry';
import { ToastProvider } from '@/components/ui/ToastProvider';

expect.extend(toHaveNoViolations);

jest.mock('next/link', () => {
  const MockLink = ({ children, href, className }: { children: ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  );
  MockLink.displayName = 'MockLink';
  return MockLink;
});

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/registry/add-item',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/hooks/admin/useAdminRegistry', () => ({
  useAdminRegistry: () => ({
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    items: [],
    isLoading: false,
    error: null,
  }),
}));

const mockGuestPortalState = {
  state: {
    form: {
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      zipCode: '',
      country: 'United States',
    },
    code: '',
    guestName: '',
    error: null,
    codeGuidance: null as string | null,
    status: 'idle' as const,
    sessionType: 'none' as 'none' | 'passcode' | 'invitation',
  },
  handleValidateCode: jest.fn(),
  handleSaveAddress: jest.fn(),
  handleSwitchHousehold: jest.fn(),
  handleRetry: jest.fn(),
  setField: jest.fn(),
  setCode: jest.fn(),
  isLoading: true,
  isValidating: false,
  isSaving: false,
  isAuthenticated: false,
};

jest.mock('@/hooks/useGuestAddressPortal', () => ({
  useGuestAddressPortal: () => mockGuestPortalState,
}));

const headingAxeOptions = {
  rules: {
    'page-has-heading-one': { enabled: true },
    'heading-order': { enabled: true },
  },
};

describe('Standardized Heading Hierarchy & Standalone Fallbacks', () => {
  it('renders a single descriptive h1 in NotFound with zero axe heading violations', async () => {
    const { container } = render(
      <main>
        <NotFound />
      </main>
    );

    const headings = screen.getAllByRole('heading');
    expect(headings).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: /404\s+Page Not Found/i })
    ).toBeInTheDocument();

    expect(await axe(container, headingAxeOptions)).toHaveNoViolations();
  });

  it('defaults EmptyState heading to h2 and supports h3 override under h2 timeline sections', async () => {
    const { container, rerender } = render(
      <main>
        <h1>Things to Do</h1>
        <EmptyState message="Try another category." />
      </main>
    );

    expect(screen.getByRole('heading', { level: 2, name: 'No items found' })).toBeInTheDocument();
    expect(await axe(container, headingAxeOptions)).toHaveNoViolations();

    rerender(
      <main>
        <h1>Our Wedding</h1>
        <h2>Wedding Schedule</h2>
        <EmptyState message="No events match filter." headingLevel="h3" />
      </main>
    );

    expect(screen.getByRole('heading', { level: 3, name: 'No items found' })).toBeInTheDocument();
    expect(await axe(container, headingAxeOptions)).toHaveNoViolations();
  });

  it('defaults AdminEditorContainer heading to h2 and supports h1 for standalone editors', () => {
    const { rerender } = render(
      <AdminEditorContainer title="Embedded Editor">
        <p>Form fields</p>
      </AdminEditorContainer>
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Embedded Editor' })).toBeInTheDocument();

    rerender(
      <AdminEditorContainer title="Standalone Editor" headingLevel="h1">
        <p>Form fields</p>
      </AdminEditorContainer>
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Standalone Editor' })).toBeInTheDocument();
  });

  it('renders h1 Add Registry Items above sequential h2 sections in AddRegistryItemPage across all tabs', async () => {
    const { container } = render(
      <ToastProvider>
        <main>
          <AddRegistryItemPage />
        </main>
      </ToastProvider>
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Add Registry Items' })
    ).toBeInTheDocument();
    expect(await axe(container, headingAxeOptions)).toHaveNoViolations();

    // Switch to Batch URLs tab (renders h2 "Paste Retailer Product URLs")
    fireEvent.click(screen.getByRole('tab', { name: 'Batch URLs' }));
    expect(
      screen.getByRole('heading', { level: 2, name: 'Paste Retailer Product URLs' })
    ).toBeInTheDocument();
    expect(await axe(container, headingAxeOptions)).toHaveNoViolations();

    // Switch to CSV Import tab (renders h2 "Import Registry CSV File")
    fireEvent.click(screen.getByRole('tab', { name: 'CSV Import' }));
    expect(
      screen.getByRole('heading', { level: 2, name: 'Import Registry CSV File' })
    ).toBeInTheDocument();
    expect(await axe(container, headingAxeOptions)).toHaveNoViolations();
  });

  it('exposes a descriptive sr-only h1 in GuestAddressPage while authentication is loading', async () => {
    mockGuestPortalState.isLoading = true;
    mockGuestPortalState.isAuthenticated = false;
    mockGuestPortalState.state.sessionType = 'none';

    const { container } = render(
      <ToastProvider>
        <main>
          <GuestAddressPage />
        </main>
      </ToastProvider>
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Guest RSVP & Address Portal' })
    ).toBeInTheDocument();
    expect(await axe(container, headingAxeOptions)).toHaveNoViolations();
  });

  it('maintains sequential h1 -> h2 -> h3 heading order in GuestAddressPage passcode visitor view', async () => {
    const previousFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        isGuest: false,
        rsvpOpen: true,
        data: [],
      }),
    });
    mockGuestPortalState.isLoading = false;
    mockGuestPortalState.isAuthenticated = false;
    mockGuestPortalState.state.sessionType = 'passcode';

    try {
      const { container } = render(
        <ToastProvider>
          <main>
            <GuestAddressPage />
          </main>
        </ToastProvider>
      );

      expect(
        screen.getByRole('heading', { level: 1, name: 'Guest RSVP & Address Portal' })
      ).toBeInTheDocument();
      expect(
        await screen.findByRole('heading', { level: 2, name: 'Public Wedding Schedule' })
      ).toBeInTheDocument();
      expect((await screen.findAllByRole('heading', { level: 3 })).length).toBeGreaterThan(0);
      expect(await axe(container, headingAxeOptions)).toHaveNoViolations();
    } finally {
      global.fetch = previousFetch;
      mockGuestPortalState.isLoading = true;
      mockGuestPortalState.state.sessionType = 'none';
    }
  });
});
