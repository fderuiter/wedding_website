import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SeatingChartAdminPage from '@/app/admin/dashboard/seating-chart/page';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { SeatingTableDTO } from '../../schemas';
import { InvitationCodeDTO } from '@/features/registry';

const initialTables: SeatingTableDTO[] = [
  {
    id: 'table-1',
    name: 'Table 1',
    shape: 'round',
    capacity: 4,
    x: 40,
    y: 40,
    width: 120,
    height: 120,
    rotation: 0,
    isSample: false,
    invitationCodes: [
      {
        id: 'guest-1',
        code: 'INV-1',
        guestName: 'Guest One',
        tableId: 'table-1',
        seatNumber: 1,
      } as InvitationCodeDTO,
    ],
  },
  {
    id: 'table-2',
    name: 'Table 2',
    shape: 'square',
    capacity: 4,
    x: 220,
    y: 40,
    width: 120,
    height: 120,
    rotation: 0,
    isSample: false,
    invitationCodes: [],
  },
];

const initialGuests: InvitationCodeDTO[] = [
  {
    id: 'guest-1',
    code: 'INV-1',
    guestName: 'Guest One',
    tableId: 'table-1',
    seatNumber: 1,
  } as InvitationCodeDTO,
  {
    id: 'guest-2',
    code: 'INV-2',
    guestName: 'Guest Two',
    tableId: null,
    seatNumber: null,
  } as InvitationCodeDTO,
  {
    id: 'guest-3',
    code: 'INV-3',
    guestName: 'Guest Three',
    tableId: null,
    seatNumber: null,
  } as InvitationCodeDTO,
];

describe('Optimistic Seating Chart State Updates', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock = jest.fn((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();

      // Initial mount GET requests
      if (urlStr.endsWith('/api/admin/seating-tables') && (!init || !init.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(JSON.parse(JSON.stringify(initialTables))),
        } as Response);
      }
      if (urlStr.includes('/api/admin/invitation-codes/catalog') && (!init || !init.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ items: JSON.parse(JSON.stringify(initialGuests)), total: initialGuests.length, page: 1, limit: 1000, totalPages: 1 }),
        } as Response);
      }

      // Seat assignment POST
      if (urlStr.endsWith('/api/admin/seating/assign') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        const { invitationCodeId, tableId, seatNumber } = body;
        const guest = initialGuests.find((g) => g.id === invitationCodeId);
        const updatedGuest = {
          ...guest,
          id: invitationCodeId,
          tableId: tableId || null,
          seatNumber: tableId ? (seatNumber ?? null) : null,
        };
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(updatedGuest),
        } as Response);
      }

      // Seating table POST (create)
      if (urlStr.endsWith('/api/admin/seating-tables') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        const createdTable: SeatingTableDTO = {
          id: 'table-new',
          name: body.name || 'New Table',
          shape: body.shape || 'round',
          capacity: body.capacity || 8,
          x: body.x || 40,
          y: body.y || 40,
          width: body.width || 120,
          height: body.height || 120,
          rotation: body.rotation || 0,
          isSample: false,
          invitationCodes: [],
        };
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(createdTable),
        } as Response);
      }

      // Seating table PUT (edit)
      if (urlStr.includes('/api/admin/seating-tables/') && init?.method === 'PUT') {
        const tableId = urlStr.split('/').pop();
        const body = JSON.parse(init.body as string);
        const existing = initialTables.find((t) => t.id === tableId) || { id: tableId };
        const updatedTable = {
          ...existing,
          ...body,
        };
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(updatedTable),
        } as Response);
      }

      // Seating table DELETE
      if (urlStr.includes('/api/admin/seating-tables/') && init?.method === 'DELETE') {
        const tableId = urlStr.split('/').pop();
        const deletedTable = initialTables.find((t) => t.id === tableId) || { id: tableId };
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(deletedTable),
        } as Response);
      }

      return Promise.reject(new Error(`Unhandled fetch mock for: ${urlStr}`));
    }) as jest.Mock;

    global.fetch = fetchMock;
  });

  it('assigns guest to table without making any post-mutation GET requests', async () => {
    render(<SeatingChartAdminPage />);

    await waitFor(() => {
      expect(screen.getAllByText('Guest Two').length).toBeGreaterThan(0);
    });

    // Reset fetch mock calls count after initial mount GETs
    fetchMock.mockClear();

    // Trigger quick assign for Guest Two to Table 1
    const assignButtons = screen.getAllByRole('button', { name: /Assign Guest Two/i });
    fireEvent.click(assignButtons[0]);

    // Confirm Assignment
    const confirmButton = screen.getByRole('button', { name: /Confirm Assignment/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      // Guest Two should no longer be in the unassigned list badge
      expect(screen.getByText('1 unassigned')).toBeInTheDocument();
    });

    // Verify fetch was called with POST to assign, but ZERO GET requests were made
    const getRequests = fetchMock.mock.calls.filter((call) => {
      const init = call[1];
      return !init || !init.method || init.method === 'GET';
    });
    expect(getRequests.length).toBe(0);

    const postRequests = fetchMock.mock.calls.filter((call) => {
      const init = call[1];
      return init && init.method === 'POST' && call[0].toString().endsWith('/api/admin/seating/assign');
    });
    expect(postRequests.length).toBe(1);
  });

  it('unassigns guest directly without issuing GET requests', async () => {
    render(<SeatingChartAdminPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Table 1/i })).toBeInTheDocument();
    });

    // Click Table 1 on floorplan canvas to select it
    fireEvent.click(screen.getByRole('button', { name: /Table 1/i }));

    // Wait for selected table inspector bar to show Guest One with unassign button
    await waitFor(() => {
      expect(screen.getByTitle('Unassign guest')).toBeInTheDocument();
    });

    const unassignBtn = screen.getByRole('button', { name: 'Unassign Guest One' });
    expect(unassignBtn).toHaveAttribute('type', 'button');
    expect(unassignBtn).toHaveAttribute('title', 'Unassign guest');
    expect(unassignBtn.className).toContain('min-w-6');
    expect(unassignBtn.className).toContain('min-h-6');

    fetchMock.mockClear();

    // Click unassign (x) button
    fireEvent.click(unassignBtn);

    await waitFor(() => {
      // Unassigned guest count should increase to 3
      expect(screen.getByText('3 unassigned')).toBeInTheDocument();
    });

    // Verify zero GET requests
    const getRequests = fetchMock.mock.calls.filter((call) => {
      const init = call[1];
      return !init || !init.method || init.method === 'GET';
    });
    expect(getRequests.length).toBe(0);
  });

  it('handles seat swap side effect when assigning to an occupied seat', async () => {
    render(<SeatingChartAdminPage />);

    await waitFor(() => {
      expect(screen.getAllByText('Table 1').length).toBeGreaterThan(0);
    });

    fetchMock.mockClear();

    // Simulate drop guest-2 onto seat 1 of Table 1 (which is currently occupied by Guest One)
    const seat1 = screen.getByTitle(/Seat 1: Guest One/i);
    const dropEvent = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      dataTransfer: {
        getData: jest.fn().mockReturnValue('guest-2'),
      },
    };

    fireEvent.drop(seat1, dropEvent);

    await waitFor(() => {
      // Guest Two should now occupy Seat 1 (initial G)
      expect(screen.getByTitle(/Seat 1: Guest Two/i)).toBeInTheDocument();
    });

    // Verify ZERO GET requests were performed
    const getRequests = fetchMock.mock.calls.filter((call) => {
      const init = call[1];
      return !init || !init.method || init.method === 'GET';
    });
    expect(getRequests.length).toBe(0);
  });

  it('creates new table directly in local state without GET requests', async () => {
    render(<SeatingChartAdminPage />);

    await waitFor(() => {
      expect(screen.getByText('Add Table')).toBeInTheDocument();
    });

    fetchMock.mockClear();

    // Open create table modal
    fireEvent.click(screen.getByText('Add Table'));

    // Fill table name
    const nameInput = screen.getByLabelText('Table Name');
    fireEvent.change(nameInput, { target: { value: 'VIP Table' } });

    // Submit form
    fireEvent.click(screen.getByRole('button', { name: 'Create Table' }));

    await waitFor(() => {
      expect(screen.getAllByText('VIP Table').length).toBeGreaterThan(0);
    });

    // Verify zero GET requests
    const getRequests = fetchMock.mock.calls.filter((call) => {
      const init = call[1];
      return !init || !init.method || init.method === 'GET';
    });
    expect(getRequests.length).toBe(0);
  });

  it('deletes table, removes from state and unassigns affected guests without GET requests', async () => {
    render(<SeatingChartAdminPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Table 1/i })).toBeInTheDocument();
    });

    // Select Table 1
    fireEvent.click(screen.getByRole('button', { name: /Table 1/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete Table' })).toBeInTheDocument();
    });

    fetchMock.mockClear();

    // Click Delete Table on occupied Table 1 and confirm via alertdialog
    fireEvent.click(screen.getByRole('button', { name: 'Delete Table' }));
    const confirmDialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      // Table 1 should be gone from canvas and printable view
      expect(screen.queryByRole('button', { name: /Table 1/i })).not.toBeInTheDocument();
      // Guest One was assigned to Table 1, now should be unassigned (2 -> 3)
      expect(screen.getByText('3 unassigned')).toBeInTheDocument();
    });

    // Verify zero GET requests
    const getRequests = fetchMock.mock.calls.filter((call) => {
      const init = call[1];
      return !init || !init.method || init.method === 'GET';
    });
    expect(getRequests.length).toBe(0);
  });

  it('reverts local state to pre-mutation snapshot when seat assignment request fails', async () => {
    // Override fetch mock for seat assignment to fail
    fetchMock.mockImplementation((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.endsWith('/api/admin/seating-tables')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(JSON.parse(JSON.stringify(initialTables))),
        } as Response);
      }
      if (urlStr.includes('/api/admin/invitation-codes/catalog')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(JSON.parse(JSON.stringify(initialGuests))),
        } as Response);
      }
      if (urlStr.endsWith('/api/admin/seating/assign')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Server error' }),
        } as Response);
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    window.alert = jest.fn();

    render(
      <ToastProvider>
        <SeatingChartAdminPage />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Guest Two').length).toBeGreaterThan(0);
    });

    // Initial unassigned count = 2
    expect(screen.getByText('2 unassigned')).toBeInTheDocument();

    // Trigger quick assign for Guest Two
    const assignButtons = screen.getAllByRole('button', { name: /Assign Guest Two/i });
    fireEvent.click(assignButtons[0]);

    const confirmButton = screen.getByRole('button', { name: /Confirm Assignment/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to assign guest seat');
    });
    expect(window.alert).not.toHaveBeenCalled();

    // Verify local state was reverted back to pre-mutation snapshot (2 unassigned)
    expect(screen.getByText('2 unassigned')).toBeInTheDocument();
    expect(screen.getAllByText('Guest Two').length).toBeGreaterThan(0);
  });

  it('synchronously updates floorplan canvas and unassigned panel on auto-assign response without GET requests', async () => {
    // Add auto-assign endpoint mock
    fetchMock.mockImplementation((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.endsWith('/api/admin/seating-tables')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(JSON.parse(JSON.stringify(initialTables))),
        } as Response);
      }
      if (urlStr.includes('/api/admin/invitation-codes/catalog')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(JSON.parse(JSON.stringify(initialGuests))),
        } as Response);
      }
      if (urlStr.endsWith('/api/admin/seating/auto-assign') && init?.method === 'POST') {
        const autoAssignResult = {
          assignedCount: 2,
          unassignedCount: 0,
          assignedGuests: [
            { id: 'guest-2', guestName: 'Guest Two', tableId: 'table-2', seatNumber: 1 },
            { id: 'guest-3', guestName: 'Guest Three', tableId: 'table-2', seatNumber: 2 },
          ],
        };
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: autoAssignResult }),
        } as Response);
      }
      return Promise.reject(new Error(`Unhandled mock: ${urlStr}`));
    });

    render(<SeatingChartAdminPage />);

    await waitFor(() => {
      expect(screen.getByText('2 unassigned')).toBeInTheDocument();
    });

    fetchMock.mockClear();

    // Click Auto-Assign All button
    const autoAssignBtn = screen.getByRole('button', { name: /auto-assign all/i });
    fireEvent.click(autoAssignBtn);

    // Floorplan canvas immediately reflects newly seated guests on Table 2
    await waitFor(() => {
      expect(screen.getByTitle(/Seat 1: Guest Two/i)).toBeInTheDocument();
      expect(screen.getByTitle(/Seat 2: Guest Three/i)).toBeInTheDocument();
      expect(screen.getByText('0 unassigned')).toBeInTheDocument();
    });

    // Verify zero GET requests were made post auto-assign
    const getRequests = fetchMock.mock.calls.filter((call) => {
      const init = call[1];
      return !init || !init.method || init.method === 'GET';
    });
    expect(getRequests.length).toBe(0);
  });

  it('preserves concurrent auto-assigned allocations when a subsequent manual assignment fails', async () => {
    fetchMock.mockImplementation((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.endsWith('/api/admin/seating-tables')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(JSON.parse(JSON.stringify(initialTables))),
        } as Response);
      }
      if (urlStr.includes('/api/admin/invitation-codes/catalog')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(JSON.parse(JSON.stringify(initialGuests))),
        } as Response);
      }
      if (urlStr.endsWith('/api/admin/seating/auto-assign') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              assignedCount: 2,
              unassignedCount: 0,
              assignedGuests: [
                { id: 'guest-2', guestName: 'Guest Two', tableId: 'table-2', seatNumber: 1 },
                { id: 'guest-3', guestName: 'Guest Three', tableId: 'table-2', seatNumber: 2 },
              ],
            }),
        } as Response);
      }
      if (urlStr.endsWith('/api/admin/seating/assign') && init?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Database timeout' }),
        } as Response);
      }
      return Promise.reject(new Error(`Unhandled mock: ${urlStr}`));
    });

    window.alert = jest.fn();

    render(
      <ToastProvider>
        <SeatingChartAdminPage />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('2 unassigned')).toBeInTheDocument();
    });

    // 1. Run auto-assign
    const autoAssignBtn = screen.getByRole('button', { name: /auto-assign all/i });
    fireEvent.click(autoAssignBtn);

    await waitFor(() => {
      expect(screen.getByTitle(/Seat 1: Guest Two/i)).toBeInTheDocument();
      expect(screen.getByTitle(/Seat 2: Guest Three/i)).toBeInTheDocument();
    });

    // 2. Select Table 1 and unassign Guest One
    fireEvent.click(screen.getByRole('button', { name: /Table 1/i }));
    await waitFor(() => {
      expect(screen.getByTitle('Unassign guest')).toBeInTheDocument();
    });

    // Attempt to assign Guest One to Table 1 Seat 3 (will fail with 500)
    fireEvent.click(screen.getByTitle('Unassign guest'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to assign guest seat');
    });
    expect(window.alert).not.toHaveBeenCalled();

    // Guest One reverts to previous state (remains on Table 1)
    expect(screen.getByTitle(/Seat 1: Guest One/i)).toBeInTheDocument();

    // CRITICAL: Auto-assigned Guest Two and Guest Three on Table 2 are STILL INTACT!
    expect(screen.getByTitle(/Seat 1: Guest Two/i)).toBeInTheDocument();
    expect(screen.getByTitle(/Seat 2: Guest Three/i)).toBeInTheDocument();
  });

  it('commits a 120-frame table drag and 15-frame rotation drag with 1 PUT each on pointer release', async () => {
    render(
      <ToastProvider>
        <SeatingChartAdminPage />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Table 1, shape/i })).toBeInTheDocument();
    });

    const canvasElement = screen.getByRole('region', {
      name: /Interactive 2D Reception Floorplan Canvas/i,
    });
    jest.spyOn(canvasElement, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 650,
      width: 800,
      height: 650,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fetchMock.mockClear();

    const table1Element = screen.getByRole('button', { name: /^Table 1, shape/i });
    // Table 1 starts at (40, 40)
    fireEvent.mouseDown(table1Element, { button: 0, clientX: 60, clientY: 60 });

    for (let i = 1; i <= 120; i++) {
      fireEvent.mouseMove(canvasElement, { clientX: 60 + i * 2, clientY: 60 + i });
    }

    // Zero PUT requests sent during 120 pointer move frames
    expect(fetchMock).not.toHaveBeenCalled();
    expect(table1Element.style.left).toBe('280px');
    expect(table1Element.style.top).toBe('160px');

    fireEvent.mouseUp(canvasElement);

    await waitFor(() => {
      const putCalls = fetchMock.mock.calls.filter(
        (call) => call[1]?.method === 'PUT' && call[0].toString().endsWith('/api/admin/seating-tables/table-1')
      );
      expect(putCalls).toHaveLength(1);
      expect(JSON.parse(putCalls[0][1].body as string)).toEqual({ x: 280, y: 160 });
    });

    fetchMock.mockClear();

    // Now rotate Table 1 across 15 frames around new center (280+60=340, 160+60=220)
    const handleBtn = screen.getByRole('button', { name: /Rotate handle for Table 1/i });
    fireEvent.mouseDown(handleBtn, { button: 0, clientX: 340, clientY: 150 });

    for (let i = 1; i <= 15; i++) {
      const angleRad = ((i * 12) - 90) * (Math.PI / 180);
      fireEvent.mouseMove(canvasElement, {
        clientX: 340 + Math.cos(angleRad) * 60,
        clientY: 220 + Math.sin(angleRad) * 60,
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(table1Element.style.transform).toBe('rotate(180deg)');

    fireEvent.mouseUp(canvasElement);

    await waitFor(() => {
      const putCalls = fetchMock.mock.calls.filter(
        (call) => call[1]?.method === 'PUT' && call[0].toString().endsWith('/api/admin/seating-tables/table-1')
      );
      expect(putCalls).toHaveLength(1);
      expect(JSON.parse(putCalls[0][1].body as string)).toEqual({ rotation: 180 });
    });
  });

  it('reverts table placement to pre-gesture coordinates and shows error toast when PUT fails on release', async () => {
    fetchMock.mockImplementation((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.endsWith('/api/admin/seating-tables') && (!init || !init.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(JSON.parse(JSON.stringify(initialTables))),
        } as Response);
      }
      if (urlStr.includes('/api/admin/invitation-codes/catalog') && (!init || !init.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(JSON.parse(JSON.stringify(initialGuests))),
        } as Response);
      }
      if (urlStr.includes('/api/admin/seating-tables/') && init?.method === 'PUT') {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Database unavailable' }),
        } as Response);
      }
      return Promise.reject(new Error(`Unhandled mock: ${urlStr}`));
    });

    render(
      <ToastProvider>
        <SeatingChartAdminPage />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Table 1, shape/i })).toBeInTheDocument();
    });

    const canvasElement = screen.getByRole('region', {
      name: /Interactive 2D Reception Floorplan Canvas/i,
    });
    jest.spyOn(canvasElement, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 650,
      width: 800,
      height: 650,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    const table1Element = screen.getByRole('button', { name: /^Table 1, shape/i });
    fireEvent.mouseDown(table1Element, { button: 0, clientX: 50, clientY: 50 });
    fireEvent.mouseMove(canvasElement, { clientX: 310, clientY: 260 });
    expect(table1Element.style.left).toBe('300px');
    expect(table1Element.style.top).toBe('250px');

    fireEvent.mouseUp(canvasElement);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to update table position');
    });

    // Reverted to pre-drag coordinates (40, 40)
    expect(table1Element.style.left).toBe('40px');
    expect(table1Element.style.top).toBe('40px');
  });
});
