import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import SubEventsMatrixPage from '../page';
import { useToast } from '@/components/ui/ToastProvider';

expect.extend(toHaveNoViolations);

jest.mock('@/components/ui/ToastProvider', () => ({
  useToast: jest.fn(),
}));

describe('SubEventsMatrixPage', () => {
  const mockAddToast = jest.fn();

  const mockMatrixData = {
    subEvents: [
      { id: 'se-rehearsal', title: 'Rehearsal Dinner', isPrivate: true, category: 'Dining' },
      { id: 'se-ceremony', title: 'Main Ceremony', isPrivate: false, category: 'Main' },
    ],
    invitationCodes: [
      {
        id: 'inv-1',
        code: 'BRIDAL01',
        guestName: 'Alice Smith',
        householdName: 'Smith Family',
        partyGroup: 'Bridal Party',
        partyTags: ['Bridal Party', 'VIP'],
        allowedSubEventIds: ['se-rehearsal'],
      },
      {
        id: 'inv-2',
        code: 'GUEST02',
        guestName: 'Bob Jones',
        householdName: 'Jones Household',
        partyGroup: 'Friends',
        partyTags: ['Friends'],
        allowedSubEventIds: [],
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useToast as jest.Mock).mockReturnValue({
      addToast: mockAddToast,
    });

    global.fetch = jest.fn().mockImplementation((url: string, options?: any) => {
      if (url.startsWith('/api/admin/sub-events/access') && (!options || !options.method || options.method === 'GET')) {
        const parsedUrl = new URL(url, 'http://localhost:3000');
        const search = parsedUrl.searchParams.get('search') || '';
        const partyTag = parsedUrl.searchParams.get('partyTag') || '';

        let filteredCodes = mockMatrixData.invitationCodes;
        if (search) {
          filteredCodes = filteredCodes.filter(c => c.guestName.toLowerCase().includes(search.toLowerCase()));
        }
        if (partyTag && partyTag !== 'all') {
          filteredCodes = filteredCodes.filter(c => c.partyTags?.includes(partyTag));
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: {
              subEvents: mockMatrixData.subEvents,
              invitationCodes: filteredCodes,
              pagination: { total: filteredCodes.length, page: 1, limit: 25, totalPages: 1 },
              filterOptions: { partyTags: ['Bridal Party', 'VIP', 'Friends'], partyGroups: ['Bridal Party', 'Friends'], householdNames: ['Smith Family', 'Jones Household'] },
            },
          }),
        });
      }
      if (url === '/api/admin/sub-events/access' && options?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      }
      if (url === '/api/admin/sub-events/access/batch' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { count: 2 } }),
        });
      }
      if (url === '/api/admin/sub-events' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { id: 'se-new', title: 'After Party' } }),
        });
      }
      return Promise.resolve({ ok: false });
    }) as any;
  });

  test('renders page heading, filters, and access matrix table', async () => {
    render(<SubEventsMatrixPage />);

    expect(screen.getByText(/Sub-Events Access Matrix/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      expect(screen.getByText('Bob Jones')).toBeInTheDocument();
      expect(screen.getByText('Rehearsal Dinner')).toBeInTheDocument();
      expect(screen.getByText('Main Ceremony')).toBeInTheDocument();
    });
  });

  test('filters guests when search query is typed', async () => {
    render(<SubEventsMatrixPage />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search guest, code, household/i);
    fireEvent.change(searchInput, { target: { value: 'Alice' } });

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
    });
  });

  test('filters guests by selected party tag', async () => {
    render(<SubEventsMatrixPage />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    const tagSelect = screen.getByLabelText('Filter by Party Tag');
    fireEvent.change(tagSelect, { target: { value: 'Bridal Party' } });

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
    });
  });

  test('toggles single sub-event cell access for a guest', async () => {
    render(<SubEventsMatrixPage />);

    await waitFor(() => {
      expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    });

    const bobCheckbox = screen.getByLabelText('Toggle access for Rehearsal Dinner on Bob Jones');
    expect(bobCheckbox).not.toBeChecked();

    fireEvent.click(bobCheckbox);

    expect(global.fetch).toHaveBeenCalledWith('/api/admin/sub-events/access', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({
        invitationCodeId: 'inv-2',
        allowedSubEventIds: ['se-rehearsal'],
      }),
    }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Sub-event access updated.', 'success');
    });
  });

  test('executes column bulk toggle grant to all guests', async () => {
    render(<SubEventsMatrixPage />);

    await waitFor(() => {
      expect(screen.getByText('Rehearsal Dinner')).toBeInTheDocument();
    });

    const grantAllBtn = screen.getByTitle(/Grant Rehearsal Dinner access to all 2 matching guests/i);
    fireEvent.click(grantAllBtn);

    expect(global.fetch).toHaveBeenCalledWith('/api/admin/sub-events/access/batch', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        subEventIds: ['se-rehearsal'],
        action: 'grant',
      }),
    }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'Access granted for column across matching guests.',
        'success'
      );
    });
  });

  test('opens create sub-event modal and submits new sub-event', async () => {
    render(<SubEventsMatrixPage />);

    const createBtn = screen.getByRole('button', { name: /\+ Create New Sub-Event/i });
    fireEvent.click(createBtn);

    expect(screen.getByRole('heading', { name: /Create New Sub-Event/i })).toBeInTheDocument();

    const titleInput = screen.getByPlaceholderText(/e\.g\. Rehearsal Dinner/i);
    fireEvent.change(titleInput, { target: { value: 'After Party' } });

    const submitBtn = screen.getByRole('button', { name: /Create Sub-Event/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/admin/sub-events', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"title":"After Party"'),
      }));
      expect(mockAddToast).toHaveBeenCalledWith('Sub-event created successfully!', 'success');
    });
  });

  test('validates startTime and endTime in sub-event modal before submitting', async () => {
    render(<SubEventsMatrixPage />);

    fireEvent.click(screen.getByRole('button', { name: /\+ Create New Sub-Event/i }));

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Rehearsal Dinner/i), {
      target: { value: 'Cocktail Hour' },
    });
    fireEvent.change(screen.getByLabelText('Start Time (Optional)'), {
      target: { value: '2026-09-19T18:00' },
    });
    fireEvent.change(screen.getByLabelText('End Time (Optional)'), {
      target: { value: '2026-09-19T16:30' },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('End time cannot precede start time.');

    fireEvent.click(screen.getByRole('button', { name: /Create Sub-Event/i }));
    expect(global.fetch).not.toHaveBeenCalledWith('/api/admin/sub-events', expect.anything());

    fireEvent.change(screen.getByLabelText('End Time (Optional)'), {
      target: { value: '2026-09-19T19:30' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Create Sub-Event/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/sub-events',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"startTime":'),
        })
      );
    });
  });

  test('edits a sub-event from matrix column header and updates header title and schedule', async () => {
    const baseFetch = global.fetch as jest.Mock;
    global.fetch = jest.fn().mockImplementation((url: string, options?: any) => {
      if (url === '/api/admin/sub-events/se-rehearsal' && options?.method === 'PUT') {
        const body = JSON.parse(options.body);
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: {
                id: 'se-rehearsal',
                ...body,
              },
            }),
        });
      }
      return baseFetch(url, options);
    }) as any;

    render(<SubEventsMatrixPage />);

    await waitFor(() => {
      expect(screen.getByText('Rehearsal Dinner')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit sub-event Rehearsal Dinner' }));

    expect(screen.getByRole('heading', { name: 'Edit Sub-Event' })).toBeInTheDocument();
    const titleInput = screen.getByLabelText('Title *');
    expect(titleInput).toHaveValue('Rehearsal Dinner');

    fireEvent.change(titleInput, { target: { value: 'Rehearsal Dinner & Toasts' } });
    fireEvent.change(screen.getByLabelText('Start Time (Optional)'), {
      target: { value: '2026-09-18T18:00' },
    });
    fireEvent.change(screen.getByLabelText('End Time (Optional)'), {
      target: { value: '2026-09-18T21:00' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/sub-events/se-rehearsal',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"title":"Rehearsal Dinner & Toasts"'),
        })
      );
      expect(mockAddToast).toHaveBeenCalledWith('Sub-event updated successfully.', 'success');
      expect(screen.getByText('Rehearsal Dinner & Toasts')).toBeInTheDocument();
      expect(screen.getByTestId('sub-event-schedule-se-rehearsal')).toBeInTheDocument();
    });
  });

  test('deletes a sub-event from matrix column header only after confirmation', async () => {
    const baseFetch = global.fetch as jest.Mock;
    global.fetch = jest.fn().mockImplementation((url: string, options?: any) => {
      if (url === '/api/admin/sub-events/se-rehearsal' && options?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { id: 'se-rehearsal' } }),
        });
      }
      return baseFetch(url, options);
    }) as any;

    render(<SubEventsMatrixPage />);

    await waitFor(() => {
      expect(screen.getByText('Rehearsal Dinner')).toBeInTheDocument();
    });

    // Click Delete in header -> opens confirmation alertdialog
    fireEvent.click(screen.getByRole('button', { name: 'Delete sub-event Rehearsal Dinner' }));
    const confirmDialog = screen.getByRole('alertdialog', { name: 'Delete Sub-Event' });
    expect(confirmDialog).toBeInTheDocument();

    // Cancel keeps column intact
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText('Rehearsal Dinner')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith('/api/admin/sub-events/se-rehearsal', expect.anything());

    // Open again and confirm deletion
    fireEvent.click(screen.getByRole('button', { name: 'Delete sub-event Rehearsal Dinner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Sub-Event' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/sub-events/se-rehearsal',
        expect.objectContaining({ method: 'DELETE' })
      );
      expect(mockAddToast).toHaveBeenCalledWith('Sub-event deleted successfully.', 'success');
      expect(screen.queryByText('Rehearsal Dinner')).not.toBeInTheDocument();
    });
  });

  test('exposes accessible scrollable region with tabIndex=0 even when table fits within viewport', async () => {
    const { container } = render(<SubEventsMatrixPage />);

    const region = await screen.findByRole('region', { name: 'Sub-events access matrix' });
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('tabindex', '0');

    Object.defineProperty(region, 'scrollWidth', {
      get: () => 800,
      configurable: true,
    });
    Object.defineProperty(region, 'clientWidth', {
      get: () => 800,
      configurable: true,
    });

    expect(screen.getByRole('region', { name: 'Sub-events access matrix' })).toHaveAttribute('tabindex', '0');

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  test('scrolls table container with keyboard keys when focused without interfering with nested checkboxes', async () => {
    render(<SubEventsMatrixPage />);

    const region = await screen.findByRole('region', { name: 'Sub-events access matrix' });
    const aliceAccessCheckbox = screen.getByLabelText('Toggle access for Rehearsal Dinner on Alice Smith');
    const bobAccessCheckbox = screen.getByLabelText('Toggle access for Rehearsal Dinner on Bob Jones');
    const selectAllCheckbox = screen.getByLabelText('Select all page guests');

    expect(aliceAccessCheckbox).toBeChecked();
    expect(bobAccessCheckbox).not.toBeChecked();
    expect(selectAllCheckbox).not.toBeChecked();

    let scrollLeft = 40;
    let scrollTop = 20;

    Object.defineProperty(region, 'scrollLeft', {
      get: () => scrollLeft,
      set: (val: number) => {
        scrollLeft = val;
      },
      configurable: true,
    });

    Object.defineProperty(region, 'scrollTop', {
      get: () => scrollTop,
      set: (val: number) => {
        scrollTop = val;
      },
      configurable: true,
    });

    Object.defineProperty(region, 'scrollWidth', {
      get: () => 640,
      configurable: true,
    });

    Object.defineProperty(region, 'scrollHeight', {
      get: () => 480,
      configurable: true,
    });

    region.focus();
    expect(region).toHaveFocus();

    fireEvent.keyDown(region, { key: 'ArrowRight' });
    expect(scrollLeft).toBe(80);

    fireEvent.keyDown(region, { key: 'ArrowLeft' });
    expect(scrollLeft).toBe(40);

    fireEvent.keyDown(region, { key: 'End' });
    expect(scrollLeft).toBe(640);

    fireEvent.keyDown(region, { key: 'Home' });
    expect(scrollLeft).toBe(0);

    fireEvent.keyDown(region, { key: 'ArrowDown' });
    expect(scrollTop).toBe(60);

    fireEvent.keyDown(region, { key: 'ArrowUp' });
    expect(scrollTop).toBe(20);

    // Ensure arrow/home/end scrolling did not mutate nested checkbox states or trigger access updates
    expect(aliceAccessCheckbox).toBeChecked();
    expect(bobAccessCheckbox).not.toBeChecked();
    expect(selectAllCheckbox).not.toBeChecked();
    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/admin/sub-events/access',
      expect.objectContaining({ method: 'PUT' })
    );

    // Nested checkboxes remain operable independently
    fireEvent.click(bobAccessCheckbox);
    expect(bobAccessCheckbox).toBeChecked();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/sub-events/access',
      expect.objectContaining({ method: 'PUT' })
    );
  });
});
