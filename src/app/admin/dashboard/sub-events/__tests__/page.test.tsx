import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SubEventsMatrixPage from '../page';
import { useToast } from '@/components/ui/ToastProvider';

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
      if (url === '/api/admin/sub-events/access' && (!options || !options.method || options.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockMatrixData }),
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

    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
  });

  test('filters guests by selected party tag', async () => {
    render(<SubEventsMatrixPage />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    const tagSelect = screen.getByLabelText('Filter by Party Tag');
    fireEvent.change(tagSelect, { target: { value: 'Bridal Party' } });

    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
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

    const grantAllBtn = screen.getByTitle(/Grant Rehearsal Dinner access to all 2 filtered guests/i);
    fireEvent.click(grantAllBtn);

    expect(global.fetch).toHaveBeenCalledWith('/api/admin/sub-events/access/batch', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        invitationCodeIds: ['inv-1', 'inv-2'],
        subEventIds: ['se-rehearsal'],
        action: 'grant',
      }),
    }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'Access granted for column across 2 guests.',
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
});
