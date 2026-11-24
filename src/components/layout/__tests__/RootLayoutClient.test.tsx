import { render, screen } from '@testing-library/react';
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
  return function MockNavbar() {
    return <header data-testid="navbar">Navbar</header>;
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
  baseUrl: 'https://wedding.example.com',
  modules: { gallery: true },
};

describe('RootLayoutClient Standalone Presentation Suppression', () => {
  beforeEach(() => {
    mockPathname = '/';
  });

  it('renders Navbar on standard routes like /', () => {
    mockPathname = '/';
    render(
      <RootLayoutClient config={mockConfig}>
        <div>Main content child</div>
      </RootLayoutClient>
    );

    expect(screen.getByTestId('navbar')).toBeInTheDocument();
  });

  it('suppresses Navbar and zeroes top padding on /photos/slideshow for standalone presentation', () => {
    mockPathname = '/photos/slideshow';
    render(
      <RootLayoutClient config={mockConfig}>
        <div>Slideshow route child</div>
      </RootLayoutClient>
    );

    expect(screen.queryByTestId('navbar')).not.toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(main).toHaveStyle({ paddingTop: '0px' });
  });

  it('suppresses Navbar on /heart', () => {
    mockPathname = '/heart';
    render(
      <RootLayoutClient config={mockConfig}>
        <div>Heart route child</div>
      </RootLayoutClient>
    );

    expect(screen.queryByTestId('navbar')).not.toBeInTheDocument();
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

  it('omits outer <main> wrapper on /guest/claim and /guest/collect where child pages provide #main-content', () => {
    for (const selfMainRoute of ['/guest/claim', '/guest/collect']) {
      mockPathname = selfMainRoute;
      const { unmount } = render(
        <RootLayoutClient config={mockConfig}>
          <main id="main-content">Self-managed main landmark</main>
        </RootLayoutClient>
      );

      expect(screen.getAllByRole('main')).toHaveLength(1);
      unmount();
    }
  });
});
