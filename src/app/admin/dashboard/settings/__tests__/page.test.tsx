import React from 'react';
import { render as tlRender, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import AdminSettingsPage from '../page';
import { checkAdminClient as mockCheckAdminClient } from '@/core/auth/auth.client';
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/ToastProvider';

expect.extend(toHaveNoViolations);

const render = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    mutationCache: new MutationCache({
      onSuccess: (_data, _variables, _context) => {
        // We can just rely on the test wrapper injecting toasts
      }
    })
  });
  return tlRender(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>
  );
};

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
  }),
}));

jest.mock('@/core/auth/auth.client');

jest.mock('@/components/admin/AdminPreviewLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockConfig = {
  id: 'global',
  brideName: 'Alice',
  groomName: 'Bob',
  weddingDate: '2026-06-20',
  baseUrl: 'https://example.com',
  venueName: 'Grand Hall',
  venueAddress: '123 Main St',
  venueCity: 'Springfield',
  venueState: 'IL',
  venueZip: '62701',
  latitude: 39.78,
  longitude: -89.65,
  storyText: 'Our love story',
  venueDescription: 'A beautiful venue',
  travelAdvice: 'Fly into STL',
  heroTitle: 'Welcome',
  heroSubtitle: 'Join us',
  seoTitle: 'Alice & Bob Wedding',
  seoDescription: 'Our wedding website',
  faviconUrl: '/assets/favicon.png',
  ogImageUrl: '/images/sunset-embrace.jpg',
  seoKeywords: "Alice and Bob's wedding, wedding website",
  features: [],
};

const mockFetch = jest.fn();

beforeEach(() => {
  (global.fetch as unknown) = mockFetch;
  (window.fetch as unknown) = mockFetch;
  (mockCheckAdminClient as jest.Mock).mockResolvedValue(true);
  mockFetch.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/admin/settings')) {
      if (url.includes('list=true')) {
        return Promise.resolve({ ok: true, json: async () => [mockConfig] });
      }
      return Promise.resolve({ ok: true, json: async () => mockConfig });
    }
    return Promise.reject(new Error(`Unhandled: ${url}`));
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('AdminSettingsPage - handleUpload', () => {
  const renderWithProviders = (ui: React.ReactElement) => {
    return render(ui);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as unknown) = mockFetch;
    (window.fetch as unknown) = mockFetch;
    (mockCheckAdminClient as jest.Mock).mockResolvedValue(true);
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.startsWith('/api/admin/settings')) {
        if (url.includes('list=true')) {
          return Promise.resolve({ ok: true, json: async () => [mockConfig] });
        }
        return Promise.resolve({ ok: true, json: async () => mockConfig });
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });
  });

  it('renders the favicon upload input', async () => {
    renderWithProviders(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    expect(screen.getByLabelText(/Favicon/i)).toBeInTheDocument();
  });

  it('renders the OG image upload input', async () => {
    renderWithProviders(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    expect(screen.getByLabelText(/Social Sharing Image/i)).toBeInTheDocument();
  });

  it('shows alert and does nothing when no file is selected', async () => {
    renderWithProviders(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    const faviconInput = screen.getByLabelText(/Favicon/i);
    // Trigger change with no files - files is empty
    await act(async () => {
      Object.defineProperty(faviconInput, 'files', { value: [], configurable: true });
      fireEvent.change(faviconInput);
    });

    // No upload fetch should be triggered (only the initial settings GET)
    const uploadCalls = mockFetch.mock.calls.filter(
      (call: any[]) => call[0] === '/api/admin/upload'
    );
    expect(uploadCalls).toHaveLength(0);
  });

  it('shows alert and aborts when file exceeds 5MB', async () => {
    renderWithProviders(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    const faviconInput = screen.getByLabelText(/Favicon/i);
    const bigFile = new File(['x'.repeat(100)], 'big.png', { type: 'image/png' });
    Object.defineProperty(bigFile, 'size', { value: 5 * 1024 * 1024 + 1, configurable: true });

    await act(async () => {
      Object.defineProperty(faviconInput, 'files', {
        value: [bigFile],
        configurable: true,
      });
      fireEvent.change(faviconInput);
    });

    await waitFor(() => {
      expect(screen.getByText('File size exceeds 5MB limit')).toBeInTheDocument();
    });

    const uploadCalls = mockFetch.mock.calls.filter(
      (call: any[]) => call[0] === '/api/admin/upload'
    );
    expect(uploadCalls).toHaveLength(0);
  });

  it('updates faviconUrl in config state and shows success message on successful upload', async () => {
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (typeof url === 'string' && url.startsWith('/api/admin/settings')) {
        if (url.includes('list=true')) {
          return Promise.resolve({ ok: true, json: async () => [mockConfig] });
        }
        return Promise.resolve({ ok: true, json: async () => mockConfig });
      }
      if (url === '/api/admin/upload' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ url: '/uploads/abc123.ico' }),
        });
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    renderWithProviders(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    const faviconInput = screen.getByLabelText(/Favicon/i);
    const file = new File(['fake-ico-data'], 'favicon.ico', { type: 'image/x-icon' });
    Object.defineProperty(file, 'size', { value: 512, configurable: true });

    await act(async () => {
      Object.defineProperty(faviconInput, 'files', {
        value: [file],
        configurable: true,
      });
      fireEvent.change(faviconInput);
    });

    await waitFor(() => {
      expect(screen.getByText('faviconUrl uploaded successfully.')).toBeInTheDocument();
    });
  });

  it('updates ogImageUrl in config state and shows success message on successful upload', async () => {
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (typeof url === 'string' && url.startsWith('/api/admin/settings')) {
        if (url.includes('list=true')) {
          return Promise.resolve({ ok: true, json: async () => [mockConfig] });
        }
        return Promise.resolve({ ok: true, json: async () => mockConfig });
      }
      if (url === '/api/admin/upload' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ url: '/uploads/xyz789.jpg' }),
        });
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    renderWithProviders(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    const ogInput = screen.getByLabelText(/Social Sharing Image/i);
    const file = new File(['fake-jpg-data'], 'og-image.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'size', { value: 1024, configurable: true });

    await act(async () => {
      Object.defineProperty(ogInput, 'files', {
        value: [file],
        configurable: true,
      });
      fireEvent.change(ogInput);
    });

    await waitFor(() => {
      expect(screen.getByText('ogImageUrl uploaded successfully.')).toBeInTheDocument();
    });
  });

  it('shows error message when upload API returns an error', async () => {
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (typeof url === 'string' && url.startsWith('/api/admin/settings')) {
        if (url.includes('list=true')) {
          return Promise.resolve({ ok: true, json: async () => [mockConfig] });
        }
        return Promise.resolve({ ok: true, json: async () => mockConfig });
      }
      if (url === '/api/admin/upload' && options?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: 'Invalid file format' }),
        });
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    renderWithProviders(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    const faviconInput = screen.getByLabelText(/Favicon/i);
    const file = new File(['data'], 'test.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 100, configurable: true });

    await act(async () => {
      Object.defineProperty(faviconInput, 'files', {
        value: [file],
        configurable: true,
      });
      fireEvent.change(faviconInput);
    });

    await waitFor(() => {
      expect(screen.getByText('Upload failed: Invalid file format')).toBeInTheDocument();
    });
  });

  it('shows error message when upload fetch throws a network error', async () => {
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (typeof url === 'string' && url.startsWith('/api/admin/settings')) {
        if (url.includes('list=true')) {
          return Promise.resolve({ ok: true, json: async () => [mockConfig] });
        }
        return Promise.resolve({ ok: true, json: async () => mockConfig });
      }
      if (url === '/api/admin/upload' && options?.method === 'POST') {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    renderWithProviders(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    const faviconInput = screen.getByLabelText(/Favicon/i);
    const file = new File(['data'], 'test.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 100, configurable: true });

    await act(async () => {
      Object.defineProperty(faviconInput, 'files', {
        value: [file],
        configurable: true,
      });
      fireEvent.change(faviconInput);
    });

    await waitFor(() => {
      expect(
        screen.getByText((content) => content.startsWith('Upload failed:'))
      ).toBeInTheDocument();
    });
  });

  it('sends the file as FormData to /api/admin/upload', async () => {
    let capturedFormData: FormData | null = null;
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (typeof url === 'string' && url.startsWith('/api/admin/settings')) {
        if (url.includes('list=true')) {
          return Promise.resolve({ ok: true, json: async () => [mockConfig] });
        }
        return Promise.resolve({ ok: true, json: async () => mockConfig });
      }
      if (url === '/api/admin/upload' && options?.method === 'POST') {
        capturedFormData = options.body as FormData;
        return Promise.resolve({
          ok: true,
          json: async () => ({ url: '/uploads/new.png' }),
        });
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    renderWithProviders(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    const faviconInput = screen.getByLabelText(/Favicon/i);
    const file = new File(['data'], 'test.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 100, configurable: true });

    await act(async () => {
      Object.defineProperty(faviconInput, 'files', {
        value: [file],
        configurable: true,
      });
      fireEvent.change(faviconInput);
    });

    await waitFor(() => {
      expect(capturedFormData).not.toBeNull();
    });

    expect(capturedFormData).toBeInstanceOf(FormData);
    expect((capturedFormData as unknown as FormData).get('file')).toBe(file);
  });
});

describe('AdminSettingsPage - SEO keywords field', () => {
  const renderWithProviders = (ui: React.ReactElement) => {
    return render(ui);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (mockCheckAdminClient as jest.Mock).mockResolvedValue(true);
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.startsWith('/api/admin/settings')) {
        if (url.includes('list=true')) {
          return Promise.resolve({ ok: true, json: async () => [mockConfig] });
        }
        return Promise.resolve({ ok: true, json: async () => mockConfig });
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });
  });

  it('renders the SEO keywords textarea', async () => {
    renderWithProviders(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    expect(screen.getByLabelText(/SEO Keywords/i)).toBeInTheDocument();
  });

  it('shows current seoKeywords value in the textarea', async () => {
    renderWithProviders(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    const textarea = screen.getByLabelText(/SEO Keywords/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Alice and Bob's wedding, wedding website");
  });

  it('updates seoKeywords value when user types', async () => {
    renderWithProviders(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    const textarea = screen.getByRole('textbox', { name: /SEO Keywords/i });
    fireEvent.input(textarea, { target: { value: 'new keyword one, new keyword two' } });

    expect(textarea).toHaveValue('new keyword one, new keyword two');
  });
});

describe('AdminSettingsPage - SearchableTimezoneSelect accessibility & keyboard navigation', () => {
  const renderWithProviders = (ui: React.ReactElement) => {
    return render(ui);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (mockCheckAdminClient as jest.Mock).mockResolvedValue(true);
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.startsWith('/api/admin/settings')) {
        if (url.includes('list=true')) {
          return Promise.resolve({ ok: true, json: async () => [mockConfig] });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...mockConfig, timezone: 'America/Chicago' }),
        });
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });
  });

  it('renders timezone input with standard ARIA combobox attributes', async () => {
    renderWithProviders(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Search and select timezone/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('aria-haspopup', 'listbox');
    expect(input).toHaveAttribute('aria-controls', 'timezone-listbox');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
  });

  it('opens dropdown listbox on focus and renders option roles', async () => {
    renderWithProviders(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Search and select timezone/i);
    fireEvent.focus(input);

    expect(input).toHaveAttribute('aria-expanded', 'true');
    const listbox = screen.getByRole('listbox');
    expect(listbox).toHaveAttribute('id', 'timezone-listbox');

    const options = within(listbox).getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);
    expect(options[0]).toHaveAttribute('id', 'timezone-option-0');
  });

  it('navigates through options with ArrowDown and ArrowUp, updating aria-selected and aria-activedescendant', async () => {
    renderWithProviders(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Search and select timezone/i);
    fireEvent.focus(input);
    // Clear search so all timezones or multiple timezones are filtered
    fireEvent.change(input, { target: { value: 'America/' } });

    const getTzOptions = () => within(screen.getByRole('listbox')).getAllByRole('option');

    // Press ArrowDown to highlight first option
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(getTzOptions()[0]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', 'timezone-option-0');

    // Press ArrowDown again to highlight second option
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(getTzOptions()[1]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', 'timezone-option-1');

    // Press ArrowUp to move back to first option
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(getTzOptions()[0]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', 'timezone-option-0');
  });

  it('jumps to first option with Home and last option with End', async () => {
    renderWithProviders(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Search and select timezone/i);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'America/' } });

    const listbox = screen.getByRole('listbox');
    const initialOptions = within(listbox).getAllByRole('option');
    const lastIndex = initialOptions.length - 1;

    // End key
    fireEvent.keyDown(input, { key: 'End' });
    expect(within(screen.getByRole('listbox')).getAllByRole('option')[lastIndex]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', `timezone-option-${lastIndex}`);

    // Home key
    fireEvent.keyDown(input, { key: 'Home' });
    expect(within(screen.getByRole('listbox')).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', 'timezone-option-0');
  });

  it('selects highlighted option on Enter key press', async () => {
    renderWithProviders(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Search and select timezone/i) as HTMLInputElement;
    fireEvent.focus(input);

    // Filter down to a specific timezone
    fireEvent.change(input, { target: { value: 'Europe/Paris' } });

    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options[0]).toHaveTextContent('Europe/Paris');

    // Press ArrowDown to highlight Europe/Paris and Enter to select
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input.value).toBe('Europe/Paris');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes dropdown without changing timezone on Escape key press', async () => {
    renderWithProviders(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Search and select timezone/i) as HTMLInputElement;
    fireEvent.focus(input);

    // Type partial search
    fireEvent.change(input, { target: { value: 'Asia/' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    // Press Escape
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input.value).toBe('America/Chicago');
  });

  it('handles arrow key navigation safely when search results are empty', async () => {
    renderWithProviders(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Search and select timezone/i);
    fireEvent.focus(input);

    // Search for nonexistent timezone
    fireEvent.change(input, { target: { value: 'NonExistent/Timezone_123' } });
    expect(screen.getByText('No matching standard IANA timezones found')).toBeInTheDocument();

    // Arrow keys should not throw error
    expect(() => {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      fireEvent.keyDown(input, { key: 'Home' });
      fireEvent.keyDown(input, { key: 'End' });
      fireEvent.keyDown(input, { key: 'Enter' });
    }).not.toThrow();
  });
});

describe('AdminSettingsPage ARIA Bindings and Accessibility', () => {
  it('exposes unique labels and non-duplicate IDs for profile switcher, split URL/file inputs, and JSON tokens error state', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.startsWith('/api/admin/settings')) {
        if (url.includes('list=true')) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              { ...mockConfig, multisiteEnabled: true },
              { ...mockConfig, id: 'secondary', siteSlug: 'secondary-site', multisiteEnabled: true },
            ],
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ ...mockConfig, multisiteEnabled: true }) });
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    const { container } = render(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    // Multisite profile switcher has explicit Label + Select binding
    const profileSelect = await screen.findByLabelText(/Active Branding Profile/i);
    expect(profileSelect).toHaveAttribute('id', 'brandingProfileSelect');

    // Paired URL and file inputs expose distinct labels
    expect(screen.getByLabelText('Brand Logo Image (Header Navigation)')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Upload Brand Logo File')).toHaveAttribute('type', 'file');
    expect(screen.getByLabelText('Hero Visual Background Image')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Upload Hero Background File')).toHaveAttribute('type', 'file');
    expect(screen.getByLabelText('Brand Watermark Graphic')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Upload Brand Watermark File')).toHaveAttribute('type', 'file');
    expect(screen.getByLabelText('Badge Graphic Image')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Upload Badge Graphic File')).toHaveAttribute('type', 'file');

    // Custom Theme Overrides guided rows expose explicit labels and propagate validation errors
    fireEvent.click(screen.getByRole('button', { name: /\+ Add Theme Override/i }));
    const overrideNameInput = screen.getByLabelText('Override Name');
    const overrideValueInput = screen.getByLabelText('Override Value');
    expect(overrideNameInput).toHaveAttribute('aria-invalid', 'false');

    fireEvent.change(overrideNameInput, { target: { value: 'invalid_token_without_dashes' } });
    fireEvent.change(overrideValueInput, { target: { value: '0.5rem' } });
    expect(overrideNameInput).toHaveAttribute('aria-invalid', 'true');
    const overrideErrorId = overrideNameInput.getAttribute('aria-describedby') || '';
    expect(overrideErrorId).toBeTruthy();
    expect(document.getElementById(overrideErrorId)).toHaveTextContent(/must start with --/i);
    expect(screen.getByRole('button', { name: /Remove theme override/i })).toBeInTheDocument();

    // SEO Keywords helper text omits legacy brideName and groomName variables
    expect(screen.getByText(/Insert placeholders like \{\{partner1Name\}\}/i)).toBeInTheDocument();
    expect(screen.queryByText(/brideName, groomName/i)).not.toBeInTheDocument();

    // Zero duplicate IDs in DOM
    const ids = Array.from(container.querySelectorAll('[id]')).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);

    const axeResults = await axe(container);
    expect(axeResults).toHaveNoViolations();
  });
});

describe('AdminSettingsPage RSVP Deadline & Access Control', () => {
  it('loads, edits, clears, and saves cutoff date, grace window, open toggle, and closing message', async () => {
    let savedPayload: any = null;
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (typeof url === 'string' && url.startsWith('/api/admin/settings')) {
        if (options?.method === 'PUT') {
          savedPayload = JSON.parse(String(options.body));
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ...mockConfig,
              ...savedPayload,
            }),
          });
        }
        const loaded = {
          ...mockConfig,
          timezone: 'America/Chicago',
          rsvpOpen: true,
          rsvpDeadlineDate: '2026-08-15',
          rsvpGracePeriodHours: 24,
          rsvpClosedMessage: 'Initial closed message',
        };
        if (url.includes('list=true')) {
          return Promise.resolve({ ok: true, json: async () => [loaded] });
        }
        return Promise.resolve({ ok: true, json: async () => loaded });
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    render(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    const openToggle = screen.getByLabelText(/Accept Online RSVPs/i) as HTMLInputElement;
    const deadlineInput = screen.getByLabelText(/Global RSVP Cutoff Date/i) as HTMLInputElement;
    const graceSelect = screen.getByLabelText(/Silent Grace Period/i) as HTMLSelectElement;
    const closedMsgTextarea = screen.getByLabelText(/RSVP Closed Message/i) as HTMLTextAreaElement;

    expect(openToggle.checked).toBe(true);
    expect(deadlineInput.value).toBe('2026-08-15');
    expect(graceSelect.value).toBe('24');
    expect(closedMsgTextarea.value).toBe('Initial closed message');

    // Clear cutoff date button clears the date input, then set a new date, 48h grace window, lock RSVPs, and update message
    fireEvent.click(screen.getByRole('button', { name: /Clear Cutoff Date/i }));
    expect(deadlineInput.value).toBe('');

    fireEvent.change(deadlineInput, { target: { name: 'rsvpDeadlineDate', value: '2026-09-01' } });
    fireEvent.change(graceSelect, { target: { value: '48' } });
    fireEvent.click(openToggle);
    fireEvent.change(closedMsgTextarea, {
      target: { name: 'rsvpClosedMessage', value: 'RSVPs closed — contact hosts@example.com' },
    });

    const form = deadlineInput.closest('form')!;
    await act(async () => {
      fireEvent.submit(form);
    });

    await waitFor(() => {
      expect(savedPayload).not.toBeNull();
    });

    expect(savedPayload.rsvpOpen).toBe(false);
    expect(savedPayload.rsvpDeadlineDate).toBe('2026-09-01');
    expect(savedPayload.rsvpGracePeriodHours).toBe(48);
    expect(savedPayload.rsvpClosedMessage).toBe('RSVPs closed — contact hosts@example.com');
  });

  it('renders a direct link to Broadcast Delivery Logs in Messaging & Broadcast Settings', async () => {
    render(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    const logsLink = screen.getByRole('link', { name: /Broadcast Delivery Logs/i });
    expect(logsLink).toHaveAttribute('href', '/admin/dashboard/history?tab=broadcasts');
  });
});

describe('AdminSettingsPage Unsaved Draft Guard & Secret Storage Safety', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    mockPush.mockClear();
  });

  it('guards dirty profile switches and Back to Dashboard via ToastProvider.confirm while allowing clean navigation immediately', async () => {
    const primaryProfile = { ...mockConfig, id: 'global', siteSlug: 'main', multisiteEnabled: true };
    const secondaryProfile = {
      ...mockConfig,
      id: 'secondary',
      siteSlug: 'secondary-site',
      heroTitle: 'Secondary Welcome',
      multisiteEnabled: true,
    };

    mockFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.startsWith('/api/admin/settings')) {
        if (url.includes('list=true')) {
          return Promise.resolve({ ok: true, json: async () => [primaryProfile, secondaryProfile] });
        }
        if (url.includes('siteId=secondary')) {
          return Promise.resolve({ ok: true, json: async () => secondaryProfile });
        }
        return Promise.resolve({ ok: true, json: async () => primaryProfile });
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    render(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    // Clean Back to Dashboard navigates immediately without alertdialog
    fireEvent.click(screen.getByRole('button', { name: /Back to Dashboard/i }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/admin/dashboard');
    });
    mockPush.mockClear();

    // Dirty edit on Hero Title
    const heroTitleInput = document.querySelector('input[name="heroTitle"]') as HTMLInputElement;
    fireEvent.change(heroTitleInput, { target: { name: 'heroTitle', value: 'Unsaved Hero Draft' } });

    // Dirty profile switch prompts first; Cancel keeps current profile & draft
    const profileSelect = await screen.findByLabelText(/Active Branding Profile/i);
    fireEvent.change(profileSelect, { target: { value: 'secondary' } });

    const profileDialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(profileDialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect((profileSelect as HTMLSelectElement).value).toBe('global');
    expect(heroTitleInput.value).toBe('Unsaved Hero Draft');

    // Dirty Broadcast Delivery Logs link click also prompts; Cancel stays on settings
    fireEvent.click(screen.getByRole('link', { name: /Broadcast Delivery Logs/i }));
    const logsDialog = await screen.findByRole('alertdialog');
    expect(mockPush).not.toHaveBeenCalled();
    fireEvent.click(within(logsDialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(mockPush).not.toHaveBeenCalled();

    // Dirty Back to Dashboard prompts; Cancel stays on settings, Confirm navigates
    fireEvent.click(screen.getByRole('button', { name: /Back to Dashboard/i }));
    const navDialog = await screen.findByRole('alertdialog');
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.click(within(navDialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Back to Dashboard/i }));
    const confirmNavDialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirmNavDialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/admin/dashboard');
    });
  });

  it('never writes secret credential inputs (smtpPass, resendApiKey, sendgridApiKey, twilioAuthToken) to browser storage', async () => {
    const sessionSetSpy = jest.spyOn(Storage.prototype, 'setItem');

    render(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    // 1. SMTP password
    fireEvent.change(screen.getByLabelText(/SMTP Password/i), {
      target: { name: 'smtpPass', value: 'super-secret-smtp-pass' },
    });

    // 2. Resend API key
    fireEvent.change(screen.getByLabelText(/Email Delivery Provider/i), {
      target: { name: 'emailProvider', value: 'resend' },
    });
    fireEvent.change(screen.getByLabelText(/Resend API Key/i), {
      target: { name: 'resendApiKey', value: 're_super_secret_key' },
    });

    // 3. SendGrid API key
    fireEvent.change(screen.getByLabelText(/Email Delivery Provider/i), {
      target: { name: 'emailProvider', value: 'sendgrid' },
    });
    fireEvent.change(screen.getByLabelText(/SendGrid API Key/i), {
      target: { name: 'sendgridApiKey', value: 'SG.super_secret_key' },
    });

    // 4. Twilio Auth Token
    fireEvent.change(screen.getByLabelText(/SMS Gateway Provider/i), {
      target: { name: 'smsProvider', value: 'twilio' },
    });
    fireEvent.change(screen.getByLabelText(/Auth Token/i), {
      target: { name: 'twilioAuthToken', value: 'twilio_super_secret_token' },
    });

    const serializedStorage = JSON.stringify({
      session: { ...window.sessionStorage },
      local: { ...window.localStorage },
      calls: sessionSetSpy.mock.calls,
    });

    expect(serializedStorage).not.toContain('super-secret-smtp-pass');
    expect(serializedStorage).not.toContain('re_super_secret_key');
    expect(serializedStorage).not.toContain('SG.super_secret_key');
    expect(serializedStorage).not.toContain('twilio_super_secret_token');
    expect(serializedStorage).not.toContain('smtpPass');
    expect(serializedStorage).not.toContain('resendApiKey');
    expect(serializedStorage).not.toContain('sendgridApiKey');
    expect(serializedStorage).not.toContain('twilioAuthToken');

    // Secret edits still trigger the in-memory dirty navigation prompt
    fireEvent.click(screen.getByRole('button', { name: /Back to Dashboard/i }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();

    sessionSetSpy.mockRestore();
  }, 15000);

  it('renders Registry Shipping & Payment Defaults inputs, passes axe, and submits shipping and default handle fields on save', async () => {
    let savedBody: Record<string, unknown> | null = null;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.startsWith('/api/admin/settings')) {
        if (init?.method === 'PUT') {
          savedBody = JSON.parse(String(init.body || '{}'));
          return Promise.resolve({
            ok: true,
            json: async () => ({ ...mockConfig, ...savedBody }),
          });
        }
        if (url.includes('list=true')) {
          return Promise.resolve({ ok: true, json: async () => [mockConfig] });
        }
        return Promise.resolve({ ok: true, json: async () => mockConfig });
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    const { container } = render(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Shipping Recipient Name/i), {
      target: { name: 'shippingRecipientName', value: 'Alice & Bob' },
    });
    fireEvent.change(screen.getByLabelText(/Delivery Phone Number/i), {
      target: { name: 'shippingPhone', value: '(555) 867-5309' },
    });
    fireEvent.change(screen.getByLabelText(/Shipping Street Address/i), {
      target: { name: 'shippingAddressLine1', value: '742 Evergreen Terrace' },
    });
    fireEvent.change(screen.getByLabelText(/Apartment, Suite, or Unit/i), {
      target: { name: 'shippingAddressLine2', value: 'Apt 2B' },
    });
    fireEvent.change(screen.getByLabelText(/Shipping City/i), {
      target: { name: 'shippingCity', value: 'Portland' },
    });
    fireEvent.change(screen.getByLabelText(/Shipping State \/ Province/i), {
      target: { name: 'shippingState', value: 'OR' },
    });
    fireEvent.change(screen.getByLabelText(/Shipping Postal \/ Zip Code/i), {
      target: { name: 'shippingZip', value: '97205' },
    });
    fireEvent.change(screen.getByLabelText(/Shipping Country/i), {
      target: { name: 'shippingCountry', value: 'United States' },
    });
    fireEvent.change(screen.getByLabelText(/Delivery Notes & Gate Instructions/i), {
      target: { name: 'shippingDeliveryNotes', value: 'Gate code #4242' },
    });
    fireEvent.change(screen.getByLabelText(/Default Payment Service/i), {
      target: { name: 'defaultPaymentHandleType', value: 'Venmo' },
    });
    fireEvent.change(screen.getByLabelText(/Default Payment Handle \/ Link/i), {
      target: { name: 'defaultPaymentHandle', value: '@alice-and-bob' },
    });

    const axeResults = await axe(container);
    expect(axeResults).toHaveNoViolations();

    fireEvent.click(screen.getByRole('button', { name: /Save Settings/i }));

    await waitFor(() => {
      expect(savedBody).not.toBeNull();
    });

    expect(savedBody).toEqual(
      expect.objectContaining({
        shippingRecipientName: 'Alice & Bob',
        shippingPhone: '(555) 867-5309',
        shippingAddressLine1: '742 Evergreen Terrace',
        shippingAddressLine2: 'Apt 2B',
        shippingCity: 'Portland',
        shippingState: 'OR',
        shippingZip: '97205',
        shippingCountry: 'United States',
        shippingDeliveryNotes: 'Gate code #4242',
        defaultPaymentHandleType: 'Venmo',
        defaultPaymentHandle: '@alice-and-bob',
      })
    );
  }, 15000);

  it('exposes smtpSecure toggle in SMTP Credentials and submits boolean smtpSecure on save', async () => {
    let savedBody: Record<string, unknown> | null = null;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.startsWith('/api/admin/settings')) {
        if (init?.method === 'PUT') {
          savedBody = JSON.parse(String(init.body || '{}'));
          return Promise.resolve({
            ok: true,
            json: async () => ({ ...mockConfig, ...savedBody }),
          });
        }
        if (url.includes('list=true')) {
          return Promise.resolve({ ok: true, json: async () => [mockConfig] });
        }
        return Promise.resolve({ ok: true, json: async () => ({ ...mockConfig, smtpSecure: false }) });
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    render(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    const smtpSecureCheckbox = screen.getByLabelText(/Use Implicit TLS \/ SSL \(Port 465\)/i) as HTMLInputElement;
    expect(smtpSecureCheckbox).toBeInTheDocument();
    expect(smtpSecureCheckbox.checked).toBe(false);

    fireEvent.click(smtpSecureCheckbox);
    expect(smtpSecureCheckbox.checked).toBe(true);

    fireEvent.change(screen.getByLabelText(/SMTP Host/i), {
      target: { name: 'smtpHost', value: 'smtp.secure-mail.example.com' },
    });
    fireEvent.change(screen.getByLabelText(/SMTP Port/i), {
      target: { name: 'smtpPort', value: '465' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Save Settings/i }));

    await waitFor(() => {
      expect(savedBody).not.toBeNull();
    });

    expect(savedBody).toEqual(
      expect.objectContaining({
        smtpHost: 'smtp.secure-mail.example.com',
        smtpPort: '465',
        smtpSecure: true,
      })
    );
  }, 15000);
});

