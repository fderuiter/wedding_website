import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import RootLayoutClient from '../RootLayoutClient';

let mockPathname = '/';

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

jest.mock('../Navbar', () => {
  return function MockNavbar({
    isPreview,
    headerRef,
  }: {
    isPreview?: boolean;
    headerRef?: React.Ref<HTMLElement>;
  }) {
    return isPreview ? (
      <div ref={headerRef as React.Ref<HTMLDivElement>} data-testid="navbar-preview">
        Navbar Preview
      </div>
    ) : (
      <header ref={headerRef} aria-label="Site header" data-testid="navbar">
        Navbar
      </header>
    );
  };
});

jest.mock('@/components/ui/ToastProvider', () => ({
  useToast: () => ({
    addToast: jest.fn(),
  }),
}));

jest.mock('@/components/ui/GlobalRadialGlow', () => ({
  GlobalRadialGlow: () => <div data-testid="global-glow" />,
}));

const mockConfig: any = {
  id: 'global',
  partner1Name: 'Alice',
  partner2Name: 'Bob',
  venueState: 'IL',
  baseUrl: 'https://wedding.example.com',
  modules: { gallery: true, interactive3D: true },
};

describe('RootLayoutClient Standalone Presentation Suppression & Landmark Delegation', () => {
  beforeEach(() => {
    mockPathname = '/';
    window.history.replaceState({}, '', '/');
  });

  it('renders Navbar, focusable MainLandmark, and top-level SiteFooter outside main on /', () => {
    mockPathname = '/';
    render(
      <RootLayoutClient config={mockConfig}>
        <div>Main content child</div>
      </RootLayoutClient>
    );

    expect(screen.getByTestId('navbar')).toBeInTheDocument();
    const main = screen.getByRole('main', { name: 'Application Content' });
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toHaveAttribute('tabindex', '-1');

    const footer = screen.getByRole('contentinfo');
    expect(footer).toBeInTheDocument();
    expect(main.contains(footer)).toBe(false);
    expect(screen.getByRole('link', { name: /Admin Login/i })).toHaveAttribute('href', '/admin/login');
    expect(screen.getByRole('link', { name: /Play with the Heart/i })).toHaveAttribute('href', '/heart');
  });

  it('suppresses Navbar, delegates MainLandmark, and zeroes top padding on /photos/slideshow', () => {
    mockPathname = '/photos/slideshow';
    render(
      <RootLayoutClient config={mockConfig}>
        <div data-testid="slideshow-child">Slideshow route child</div>
      </RootLayoutClient>
    );

    expect(screen.queryByTestId('navbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    const wrapper = screen.getByTestId('slideshow-child').parentElement;
    expect(wrapper).toHaveStyle({ paddingTop: '0px' });
  });

  it('delegates MainLandmark on /admin/dashboard routes while keeping Navbar', () => {
    mockPathname = '/admin/dashboard/settings';
    render(
      <RootLayoutClient config={mockConfig}>
        <div data-testid="admin-child">Admin route child</div>
      </RootLayoutClient>
    );

    expect(screen.getByTestId('navbar')).toBeInTheDocument();
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    expect(screen.getByTestId('admin-child')).toBeInTheDocument();
  });

  it('suppresses duplicate main, banner, and contentinfo landmarks when ?preview=true is active', () => {
    mockPathname = '/';
    window.history.replaceState({}, '', '/?preview=true');

    render(
      <RootLayoutClient config={mockConfig}>
        <div>Preview homepage content</div>
      </RootLayoutClient>
    );

    expect(screen.getByTestId('navbar-preview')).toBeInTheDocument();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();

    const previewRegion = screen.getByRole('region', { name: 'Live Preview' });
    expect(previewRegion).toHaveAttribute('id', 'main-content');
    expect(previewRegion).toHaveAttribute('tabindex', '-1');
    expect(previewRegion).toHaveTextContent('Preview homepage content');
    expect(previewRegion).toHaveTextContent('We look forward to celebrating with you!');
  });

  it('suppresses Navbar on /heart while keeping focusable MainLandmark', () => {
    mockPathname = '/heart';
    render(
      <RootLayoutClient config={mockConfig}>
        <div>Heart route child</div>
      </RootLayoutClient>
    );

    expect(screen.queryByTestId('navbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('provides GuestHelpProvider so child route triggers open the shared modal with config contactEmail', () => {
    mockPathname = '/guest';
    const { GuestHelpTrigger } = jest.requireActual('@/components/guest/GuestHelpModal');
    const { fireEvent } = jest.requireActual('@testing-library/react');

    render(
      <RootLayoutClient config={{ ...mockConfig, contactEmail: 'couple@example.com' }}>
        <GuestHelpTrigger label="Need Help?" defaultCategory="passcode" />
      </RootLayoutClient>
    );

    fireEvent.click(screen.getByRole('button', { name: /Need Help\?/i }));
    expect(screen.getByRole('dialog', { name: /Guest Help & Support/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /couple@example\.com/i })).toBeInTheDocument();
  });

  it('provides a single focusable MainLandmark around Container child pages on /guest/claim and /guest/collect', () => {
    for (const guestRoute of ['/guest/claim', '/guest/collect']) {
      mockPathname = guestRoute;
      const { unmount } = render(
        <RootLayoutClient config={mockConfig}>
          <div>Guest container content</div>
        </RootLayoutClient>
      );

      const mains = screen.getAllByRole('main');
      expect(mains).toHaveLength(1);
      expect(mains[0]).toHaveAttribute('id', 'main-content');
      expect(mains[0]).toHaveAttribute('tabindex', '-1');
      unmount();
    }
  });

  it('retains MainLandmark on /photos/slideshow when gallery module is disabled so fallback content stays inside main', () => {
    mockPathname = '/photos/slideshow';
    render(
      <RootLayoutClient config={{ ...mockConfig, modules: { gallery: false, interactive3D: false } }}>
        <div>Gallery disabled fallback</div>
      </RootLayoutClient>
    );

    const main = screen.getByRole('main', { name: 'Application Content' });
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toHaveTextContent('Gallery disabled fallback');
  });

  it('applies same-origin DRAFT_UPDATE config messages to HomeFooterContent in preview mode and omits TBD venue state', () => {
    mockPathname = '/';
    window.history.replaceState({}, '', '/?preview=true');

    render(
      <RootLayoutClient
        config={{
          id: 'global',
          brideName: 'Clara',
          groomName: 'David',
          venueState: 'TBD',
          baseUrl: 'https://wedding.example.com',
          modules: { gallery: true, interactive3D: false },
        } as any}
      >
        <div>Preview body</div>
      </RootLayoutClient>
    );

    const previewRegion = screen.getByRole('region', { name: 'Live Preview' });
    expect(previewRegion).toHaveTextContent('Clara & David');
    expect(previewRegion).not.toHaveTextContent('Designed with');
    expect(screen.queryByRole('link', { name: /Play with the Heart/i })).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://evil.example.com',
          data: {
            type: 'DRAFT_UPDATE',
            draftType: 'config',
            draftData: { partner1Name: 'Ignored' },
          },
        })
      );
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          data: {
            type: 'DRAFT_UPDATE',
            draftType: 'config',
            draftData: {
              partner1Name: 'Evelyn',
              partner2Name: 'Frank',
              venueState: '   ',
            },
          },
        })
      );
    });

    expect(previewRegion).toHaveTextContent('Evelyn & Frank');
    expect(previewRegion).not.toHaveTextContent('Ignored');
    expect(previewRegion).not.toHaveTextContent('Designed with');
  });

  it('syncs measured Navbar height into --header-h and scopes inline isPreview renders locally', () => {
    let resizeCallbacks: ResizeObserverCallback[] = [];
    const originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = jest.fn().mockImplementation((cb: ResizeObserverCallback) => {
      resizeCallbacks.push(cb);
      return {
        observe: jest.fn(),
        unobserve: jest.fn(),
        disconnect: jest.fn(),
      };
    });

    try {
      mockPathname = '/';
      window.history.replaceState({}, '', '/');
      document.documentElement.removeAttribute('style');

      const { unmount } = render(
        <RootLayoutClient config={mockConfig}>
          <div>Host content</div>
        </RootLayoutClient>
      );

      const hostHeader = screen.getByTestId('navbar');
      Object.defineProperty(hostHeader, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 768,
          bottom: 225,
          width: 768,
          height: 225,
          toJSON: () => ({}),
        }),
      });

      act(() => {
        resizeCallbacks.forEach((cb) => cb([], {} as ResizeObserver));
      });

      expect(document.documentElement.style.getPropertyValue('--header-h')).toBe('225px');

      // Render an inline preview alongside the host layout and verify it keeps local --header-h without clobbering 225px
      const inlinePreview = render(
        <RootLayoutClient config={mockConfig} isPreview>
          <div>Inline preview content</div>
        </RootLayoutClient>
      );

      const previewHeader = screen.getByTestId('navbar-preview');
      Object.defineProperty(previewHeader, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 375,
          bottom: 65,
          width: 375,
          height: 65,
          toJSON: () => ({}),
        }),
      });

      act(() => {
        resizeCallbacks.forEach((cb) => cb([], {} as ResizeObserver));
      });

      const previewRegion = screen.getByRole('region', { name: 'Live Preview' });
      expect(previewRegion).toHaveAttribute('data-scroll-region', '');
      expect(previewRegion.style.getPropertyValue('--header-h')).toBe('65px');
      expect(document.documentElement.style.getPropertyValue('--header-h')).toBe('225px');

      inlinePreview.unmount();
      unmount();
      expect(document.documentElement.style.getPropertyValue('--header-h')).toBe('');
    } finally {
      resizeCallbacks = [];
      document.documentElement.removeAttribute('style');
      global.ResizeObserver = originalResizeObserver;
    }
  });
});
