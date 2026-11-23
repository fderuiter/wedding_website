import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
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

  test('debounces rapid 7-character search typing to send 1 matrix request after 250ms pause', async () => {
    jest.useFakeTimers();
    try {
      render(<SubEventsMatrixPage />);

      await waitFor(() => {
        expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      });

      const countAccessGets = () =>
        (global.fetch as jest.Mock).mock.calls.filter(
          ([url, opts]) =>
            typeof url === 'string' &&
            url.startsWith('/api/admin/sub-events/access?') &&
            (!opts || !opts.method || opts.method === 'GET')
        ).length;

      expect(countAccessGets()).toBe(1);

      const searchInput = screen.getByPlaceholderText(/Search guest, code, household/i);
      const strokes = ['B', 'Br', 'Bri', 'Brid', 'Brida', 'Bridal', 'Bridal0'];

      for (const stroke of strokes) {
        fireEvent.change(searchInput, { target: { value: stroke } });
        expect(searchInput).toHaveValue(stroke);
        act(() => {
          jest.advanceTimersByTime(100);
        });
      }

      // Still within 250ms of the final keystroke -> zero additional requests sent during typing
      expect(countAccessGets()).toBe(1);

      // Advance past the remaining 150ms of the 250ms debounce window
      act(() => {
        jest.advanceTimersByTime(160);
      });

      await waitFor(() => {
        expect(countAccessGets()).toBe(2);
      });

      const accessGetCalls = (global.fetch as jest.Mock).mock.calls.filter(
        ([url, opts]) =>
          typeof url === 'string' &&
          url.startsWith('/api/admin/sub-events/access?') &&
          (!opts || !opts.method || opts.method === 'GET')
      );
      expect(accessGetCalls[1][0]).toContain('search=Bridal0');
      expect(accessGetCalls[1][0]).toContain('page=1');
    } finally {
      jest.useRealTimers();
    }
  });

  test('Clear Filters immediately resets search and filter selections and fetches page one without waiting for debounce', async () => {
    jest.useFakeTimers();
    try {
      render(<SubEventsMatrixPage />);

      await waitFor(() => {
        expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      });

      const getAccessUrls = () =>
        (global.fetch as jest.Mock).mock.calls
          .filter(
            ([url, opts]) =>
              typeof url === 'string' &&
              url.startsWith('/api/admin/sub-events/access?') &&
              (!opts || !opts.method || opts.method === 'GET')
          )
          .map(([url]) => url as string);

      // Select a tag filter and type a search query, let debounce settle
      fireEvent.change(screen.getByLabelText('Filter by Party Tag'), {
        target: { value: 'Bridal Party' },
      });
      const searchInput = screen.getByPlaceholderText(/Search guest, code, household/i);
      fireEvent.change(searchInput, { target: { value: 'Alice' } });
      act(() => {
        jest.advanceTimersByTime(250);
      });

      await waitFor(() => {
        const urls = getAccessUrls();
        expect(urls[urls.length - 1]).toContain('search=Alice');
        expect(urls[urls.length - 1]).toContain('partyTag=Bridal+Party');
      });

      const countBeforeClear = getAccessUrls().length;

      // Click Clear Filters -> must reset immediately and fetch page 1 without advancing timers!
      fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));

      expect(searchInput).toHaveValue('');
      expect(screen.getByLabelText('Filter by Party Tag')).toHaveValue('all');

      await waitFor(() => {
        expect(getAccessUrls().length).toBe(countBeforeClear + 1);
      });

      const clearedUrl = getAccessUrls()[getAccessUrls().length - 1];
      expect(clearedUrl).toContain('page=1');
      expect(clearedUrl).not.toContain('search=');
      expect(clearedUrl).not.toContain('partyTag=');

      // Also verify Clear Filters fetches page 1 immediately when clicked while a search debounce is still pending
      fireEvent.change(searchInput, { target: { value: 'Bob' } });
      const countWhilePending = getAccessUrls().length;
      fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));

      expect(searchInput).toHaveValue('');
      await waitFor(() => {
        expect(getAccessUrls().length).toBe(countWhilePending + 1);
      });
      expect(getAccessUrls()[getAccessUrls().length - 1]).toContain('page=1');
      expect(getAccessUrls()[getAccessUrls().length - 1]).not.toContain('search=');
    } finally {
      jest.useRealTimers();
    }
  });

  test('bulk column actions apply the current search input value even if the debounce timer is still pending', async () => {
    jest.useFakeTimers();
    try {
      render(<SubEventsMatrixPage />);

      await waitFor(() => {
        expect(screen.getByText('Rehearsal Dinner')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/Search guest, code, household/i);
      fireEvent.change(searchInput, { target: { value: 'Alice' } });

      // Only 50ms elapsed (< 250ms debounce still pending!) -> click column Grant All immediately
      act(() => {
        jest.advanceTimersByTime(50);
      });
      const grantAllBtn = screen.getByTitle(/Grant Rehearsal Dinner access to all 2 matching guests/i);
      fireEvent.click(grantAllBtn);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/sub-events/access/batch',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            subEventIds: ['se-rehearsal'],
            action: 'grant',
            search: 'Alice',
          }),
        })
      );

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith(
          'Access granted for column across matching guests.',
          'success'
        );
        expect(screen.getByText('Alice Smith')).toBeInTheDocument();
        expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
      });
    } finally {
      jest.useRealTimers();
    }
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

  test('Create Sub-Event modal renders via Dialog with accessible title, traps Tab focus, passes jest-axe, and dismisses via Escape and backdrop click', async () => {
    const { container } = render(<SubEventsMatrixPage />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    const createBtn = screen.getByRole('button', { name: /\+ Create New Sub-Event/i });
    createBtn.focus();
    fireEvent.click(createBtn);

    const dialog = screen.getByRole('dialog', { name: 'Create New Sub-Event' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveAttribute('id', labelledBy);

    const titleInput = within(dialog).getByLabelText('Title *');
    const submitBtn = within(dialog).getByRole('button', { name: 'Create Sub-Event' });
    expect(titleInput).toHaveFocus();

    submitBtn.focus();
    fireEvent.keyDown(submitBtn, { key: 'Tab' });
    expect(titleInput).toHaveFocus();
    fireEvent.keyDown(titleInput, { key: 'Tab', shiftKey: true });
    expect(submitBtn).toHaveFocus();

    const axeResults = await axe(container);
    expect(axeResults).toHaveNoViolations();

    // Escape closes modal and restores focus to trigger button
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Create New Sub-Event' })).not.toBeInTheDocument();
    });
    expect(createBtn).toHaveFocus();

    // Backdrop click closes modal without creating a sub-event
    fireEvent.click(createBtn);
    const reopened = screen.getByRole('dialog', { name: 'Create New Sub-Event' });
    fireEvent.click(reopened.parentElement?.parentElement as HTMLElement);
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Create New Sub-Event' })).not.toBeInTheDocument();
    });
    expect(global.fetch).not.toHaveBeenCalledWith('/api/admin/sub-events', expect.anything());
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

  test('renders live Attending, Declined, Pending, and meal option badges per event column header from rsvp-summary', async () => {
    const baseFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation((url: string, options?: any) => {
      if (url === '/api/admin/sub-events/rsvp-summary') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: {
                global: {
                  totalInvitations: 2,
                  attendingHouseholds: 1,
                  declinedHouseholds: 1,
                  pendingHouseholds: 0,
                  attendingHeadcount: 3,
                  attendingPlusOnes: 2,
                  declinedHeadcount: 1,
                  pendingHeadcount: 0,
                  dietary: {
                    totalWithRestrictions: 0,
                    glutenFree: 0,
                    vegetarian: 0,
                    vegan: 0,
                    dairyFree: 0,
                    nutFree: 0,
                    halal: 0,
                    kosher: 0,
                    other: 0,
                    kids: 0,
                  },
                  mealTotals: [
                    {
                      optionId: 'm-beef',
                      label: 'Short Rib',
                      count: 2,
                      subEventId: 'se-rehearsal',
                      subEventTitle: 'Rehearsal Dinner',
                      dietaryTags: [],
                    },
                  ],
                  questionBreakdowns: [],
                },
                subEvents: [
                  {
                    subEventId: 'se-rehearsal',
                    title: 'Rehearsal Dinner',
                    isPrivate: true,
                    invitedCount: 1,
                    attendingCount: 1,
                    attendingHeadcount: 2,
                    attendingPlusOnes: 1,
                    declinedCount: 0,
                    pendingCount: 0,
                    kidsCount: 0,
                    mealCounts: [
                      { optionId: 'm-beef', label: 'Short Rib', dietaryTags: [], count: 2 },
                    ],
                    dietaryCounts: {},
                    questionBreakdowns: [],
                  },
                  {
                    subEventId: 'se-ceremony',
                    title: 'Main Ceremony',
                    isPrivate: false,
                    invitedCount: 2,
                    attendingCount: 1,
                    attendingHeadcount: 3,
                    attendingPlusOnes: 2,
                    declinedCount: 1,
                    pendingCount: 0,
                    kidsCount: 0,
                    mealCounts: [],
                    dietaryCounts: {},
                    questionBreakdowns: [],
                  },
                ],
              },
            }),
        });
      }
      return (baseFetch as any)(url, options);
    }) as any;

    const { container } = render(<SubEventsMatrixPage />);

    const rehearsalBadges = await screen.findByTestId('sub-event-rsvp-badges-se-rehearsal');
    expect(rehearsalBadges).toHaveTextContent('Attending: 2');
    expect(rehearsalBadges).toHaveTextContent('Declined: 0');
    expect(rehearsalBadges).toHaveTextContent('Pending: 0');
    expect(rehearsalBadges).toHaveTextContent('Short Rib: 2');

    const ceremonyBadges = screen.getByTestId('sub-event-rsvp-badges-se-ceremony');
    expect(ceremonyBadges).toHaveTextContent('Attending: 3');
    expect(ceremonyBadges).toHaveTextContent('Declined: 1');
    expect(ceremonyBadges).toHaveTextContent('Pending: 0');

    const axeResults = await axe(container);
    expect(axeResults).toHaveNoViolations();
  });

  test('keeps Edit and Delete column headers mounted when 0 invitation codes match and passes existingSubEvents to modal', async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/admin/sub-events/access')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: {
                subEvents: mockMatrixData.subEvents,
                invitationCodes: [],
                pagination: { total: 0, page: 1, limit: 25, totalPages: 1 },
                filterOptions: { partyTags: [], partyGroups: [], householdNames: [] },
              },
            }),
        });
      }
      return Promise.resolve({ ok: false });
    }) as any;

    render(<SubEventsMatrixPage />);

    await waitFor(() => {
      expect(
        screen.getByText('No invitation codes match your filter criteria.')
      ).toBeInTheDocument();
    });

    // Sub-event column headers with Edit and Delete controls remain mounted even with 0 guest rows
    expect(
      screen.getByRole('button', { name: 'Edit sub-event Rehearsal Dinner' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Delete sub-event Rehearsal Dinner' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Edit sub-event Main Ceremony' })
    ).toBeInTheDocument();

    // Opening "+ Create New Sub-Event" renders Existing Sub-Events switcher inside modal
    fireEvent.click(screen.getByRole('button', { name: /\+ Create New Sub-Event/i }));
    const dialog = screen.getByRole('dialog', { name: 'Create New Sub-Event' });
    expect(within(dialog).getByText(/Existing Sub-Events/i)).toBeInTheDocument();
  });

  test('renders per-guest eventRsvps status, companions, meals, answers, and dietary notes inside matrix cells', async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/admin/sub-events/access')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: {
                subEvents: mockMatrixData.subEvents,
                invitationCodes: [
                  {
                    ...mockMatrixData.invitationCodes[0],
                    eventRsvps: {
                      'se-rehearsal': {
                        status: 'attending',
                        plusOneCount: 1,
                        plusOneNames: ['Jordan Smith'],
                        dietaryNotes: 'No peanuts',
                        meals: [
                          {
                            attendee: 'Alice Smith',
                            optionId: 'm-salmon',
                            label: 'Herb Salmon',
                            dietaryTags: ['gluten-free'],
                          },
                          {
                            attendee: 'Jordan Smith',
                            optionId: 'm-kids',
                            label: 'Kids Pasta',
                            dietaryTags: ['kids'],
                          },
                        ],
                        answers: [{ prompt: 'Need shuttle?', answer: 'Yes' }],
                      },
                    },
                  },
                ],
                pagination: { total: 1, page: 1, limit: 25, totalPages: 1 },
                filterOptions: { partyTags: [], partyGroups: [], householdNames: [] },
              },
            }),
        });
      }
      return Promise.resolve({ ok: false });
    }) as any;

    render(<SubEventsMatrixPage />);

    const cellRsvp = await screen.findByTestId('matrix-cell-rsvp-inv-1-se-rehearsal');
    expect(cellRsvp).toHaveTextContent('Attending (+1)');
    expect(cellRsvp).toHaveTextContent('+1: Jordan Smith');
    expect(cellRsvp).toHaveTextContent('Alice Smith: Herb Salmon (gluten-free)');
    expect(cellRsvp).toHaveTextContent('Jordan Smith: Kids Pasta (kids)');
    expect(cellRsvp).toHaveTextContent('Need shuttle?: Yes');
    expect(cellRsvp).toHaveTextContent('Dietary: No peanuts');
  });
});
