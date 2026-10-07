import React from 'react';
import { render as tlRender, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminSettingsPage from '../page';
import { checkAdminClient as mockCheckAdminClient } from '@/core/auth/auth.client';
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/ToastProvider';

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
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => mockConfig,
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('AdminSettingsPage - handleUpload', () => {
  const renderWithProviders = (ui: React.ReactElement) => {
    return render(ui);
  };

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
      if (url === '/api/admin/settings') {
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
      if (url === '/api/admin/settings') {
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
      if (url === '/api/admin/settings') {
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
      if (url === '/api/admin/settings') {
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
      if (url === '/api/admin/settings') {
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
    expect((capturedFormData as FormData).get('file')).toBe(file);
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
      if (url === '/api/admin/settings') {
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
      if (url === '/api/admin/settings') {
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

    const input = screen.getByRole('combobox');
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

    const input = screen.getByRole('combobox');
    fireEvent.focus(input);

    expect(input).toHaveAttribute('aria-expanded', 'true');
    const listbox = screen.getByRole('listbox');
    expect(listbox).toHaveAttribute('id', 'timezone-listbox');

    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);
    expect(options[0]).toHaveAttribute('id', 'timezone-option-0');
  });

  it('navigates through options with ArrowDown and ArrowUp, updating aria-selected and aria-activedescendant', async () => {
    renderWithProviders(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    // Clear search so all timezones or multiple timezones are filtered
    fireEvent.change(input, { target: { value: 'America/' } });

    // Press ArrowDown to highlight first option
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', 'timezone-option-0');

    // Press ArrowDown again to highlight second option
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', 'timezone-option-1');

    // Press ArrowUp to move back to first option
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', 'timezone-option-0');
  });

  it('jumps to first option with Home and last option with End', async () => {
    renderWithProviders(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'America/' } });

    const initialOptions = screen.getAllByRole('option');
    const lastIndex = initialOptions.length - 1;

    // End key
    fireEvent.keyDown(input, { key: 'End' });
    expect(screen.getAllByRole('option')[lastIndex]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', `timezone-option-${lastIndex}`);

    // Home key
    fireEvent.keyDown(input, { key: 'Home' });
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', 'timezone-option-0');
  });

  it('selects highlighted option on Enter key press', async () => {
    renderWithProviders(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
    });

    const input = screen.getByRole('combobox') as HTMLInputElement;
    fireEvent.focus(input);

    // Filter down to a specific timezone
    fireEvent.change(input, { target: { value: 'Europe/Paris' } });

    const options = screen.getAllByRole('option');
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

    const input = screen.getByRole('combobox') as HTMLInputElement;
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

    const input = screen.getByRole('combobox');
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

