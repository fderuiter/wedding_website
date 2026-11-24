import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { DemoProvider } from '@/components/demo/DemoContext';
import { DemoToolbar } from '@/components/demo/DemoToolbar';
import { resetDemoState } from '@/lib/demo/demoStore';
import ProjectInfo from '../page';

expect.extend(toHaveNoViolations);

jest.mock('next/navigation', () => ({
  usePathname: () => '/project-info',
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
  }),
}));

// Mock IntersectionObserver for framer-motion's whileInView
beforeAll(() => {
  class MockIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (
    global as unknown as { IntersectionObserver: typeof MockIntersectionObserver }
  ).IntersectionObserver = MockIntersectionObserver;
});

function renderWithDemo(enabled: boolean, withToolbar = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <DemoProvider enabled={enabled}>
            {withToolbar && <DemoToolbar />}
            <main>
              <ProjectInfo />
            </main>
          </DemoProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('ProjectInfo Page', () => {
  const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;

  beforeEach(() => {
    window.localStorage.clear();
    resetDemoState();
    delete process.env.NEXT_PUBLIC_BASE_PATH;
  });

  afterEach(() => {
    if (originalBasePath === undefined) {
      delete process.env.NEXT_PUBLIC_BASE_PATH;
    } else {
      process.env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
    }
    document.documentElement.classList.remove('dark');
  });

  it('renders the main heading, shipped stack, supported hosting targets, and npm ci bootstrap', () => {
    const { container } = render(<ProjectInfo />);

    expect(
      screen.getByRole('heading', { level: 1, name: /about this project/i })
    ).toBeInTheDocument();

    expect(container.textContent).not.toContain('Fuse.js');
    expect(container.textContent).not.toContain('Netlify');
    expect(container.textContent).not.toContain('npm install');

    expect(screen.getByText(/TanStack Query & Zod/i)).toBeInTheDocument();
    expect(screen.getByText(/Docker \/ VPS/i)).toBeInTheDocument();
    expect(screen.getByText(/Railway & Render/i)).toBeInTheDocument();
    expect(screen.getByText('npm ci')).toBeInTheDocument();
    expect(screen.queryByTestId('project-info-showcase-links')).not.toBeInTheDocument();
  });

  it('renders all external links with accessible new tab warnings and links CONTRIBUTING.md to .github/CONTRIBUTING.md', () => {
    render(<ProjectInfo />);

    const externalLinks = [
      {
        name: /view on github \(opens in a new tab\)/i,
        href: 'https://github.com/fderuiter/wedding_website',
      },
      {
        name: /google cloud run \(opens in a new tab\)/i,
        href: 'https://cloud.google.com/run',
      },
      {
        name: /vercel \(opens in a new tab\)/i,
        href: 'https://vercel.com/',
      },
      {
        name: /readme \(opens in a new tab\)/i,
        href: 'https://github.com/fderuiter/wedding_website#readme',
      },
      {
        name: /contributing\.md \(opens in a new tab\)/i,
        href: 'https://github.com/fderuiter/wedding_website/blob/main/.github/CONTRIBUTING.md',
      },
      {
        name: /^github \(opens in a new tab\)$/i,
        href: 'https://github.com/fderuiter/wedding_website',
      },
    ];

    for (const { name, href } of externalLinks) {
      const link = screen.getByRole('link', { name });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('exposes subpath-safe showcase links in demo mode only and omits them in standalone mode', async () => {
    process.env.NEXT_PUBLIC_BASE_PATH = '/wedding_website/demo';

    const standalone = renderWithDemo(false);
    expect(screen.queryByTestId('project-info-showcase-links')).not.toBeInTheDocument();
    standalone.unmount();

    renderWithDemo(true);
    expect(await screen.findByTestId('project-info-showcase-links')).toBeInTheDocument();

    const docsLink = screen.getByTestId('project-info-link-docs');
    const apiLink = screen.getByTestId('project-info-link-api');
    const storybookLink = screen.getByTestId('project-info-link-storybook');

    expect(docsLink).toHaveAttribute('href', '/wedding_website/');
    expect(docsLink).toHaveAttribute('data-static-demo-bypass', 'true');
    expect(apiLink).toHaveAttribute('href', '/wedding_website/api/');
    expect(apiLink).toHaveAttribute('data-static-demo-bypass', 'true');
    expect(storybookLink).toHaveAttribute('href', '/wedding_website/storybook/');
    expect(storybookLink).toHaveAttribute('data-static-demo-bypass', 'true');
    expect(storybookLink).toHaveAttribute('target', '_blank');
    expect(storybookLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('has zero axe accessibility violations in light and dark modes', async () => {
    const { container } = renderWithDemo(true, true);
    await screen.findByRole('heading', { level: 1, name: /about this project/i });
    const lightResults = await axe(container);
    expect(lightResults).toHaveNoViolations();

    document.documentElement.classList.add('dark');
    const darkResults = await axe(container);
    expect(darkResults).toHaveNoViolations();
  });
});
