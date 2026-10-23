import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SetupWizard from '../SetupWizard';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock fetch for admin setup login and API calls
const mockMembers: any[] = [];
const mockAttractions: any[] = [];

const mockCreateMember = jest.fn(async (newMember: any) => {
  const member = { id: 'm1', name: newMember.name || 'Test Member', role: newMember.role || 'Groom', ...newMember };
  mockMembers.push(member);
  return member;
});

const mockRemoveMember = jest.fn(async (id: string) => {
  const idx = mockMembers.findIndex(m => m.id === id);
  if (idx !== -1) mockMembers.splice(idx, 1);
});

const mockCreateAttraction = jest.fn(async (newAttr: any) => {
  const attr = { id: 'a1', name: newAttr.name || 'Test Attraction', category: newAttr.category || 'food', ...newAttr };
  mockAttractions.push(attr);
  return attr;
});

const mockRemoveAttraction = jest.fn(async (id: string) => {
  const idx = mockAttractions.findIndex(a => a.id === id);
  if (idx !== -1) mockAttractions.splice(idx, 1);
});

jest.mock('@/hooks/admin/useAdminWeddingParty', () => ({
  useAdminWeddingParty: () => ({
    data: mockMembers,
    isLoading: false,
    error: null,
    create: mockCreateMember,
    update: jest.fn(),
    remove: mockRemoveMember,
    fetchAll: jest.fn(),
  }),
}));

jest.mock('@/hooks/admin/useAdminAttractions', () => ({
  useAdminAttractions: () => ({
    data: mockAttractions,
    isLoading: false,
    error: null,
    create: mockCreateAttraction,
    update: jest.fn(),
    remove: mockRemoveAttraction,
    fetchAll: jest.fn(),
  }),
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('SetupWizard In-Modal Content Overlays', () => {
  let windowOpenSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockMembers.length = 0;
    mockAttractions.length = 0;
    windowOpenSpy = jest.spyOn(window, 'open').mockImplementation(() => null);

    // Mock global fetch for setup login and config saving
    global.fetch = jest.fn((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/admin/setup')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);
    }) as jest.Mock;
  });

  afterEach(() => {
    windowOpenSpy.mockRestore();
  });

  const navigateToStep2Content = async () => {
    renderWithProviders(<SetupWizard />);

    // Step 0: Admin Login
    const passInput = screen.getByPlaceholderText('Admin Password');
    fireEvent.change(passInput, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // Step 1: Essentials Form
    await waitFor(() => expect(screen.getByText('Step 1: The Essentials')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Partner 1/i), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText(/Partner 2/i), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/Wedding Date/i), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText(/Site URL/i), { target: { value: 'https://alexandsam2026.com' } });
    fireEvent.change(screen.getByLabelText(/Venue Name/i), { target: { value: 'Grand Ballroom' } });
    fireEvent.change(screen.getByLabelText(/^City$/i), { target: { value: 'Chicago' } });
    fireEvent.change(screen.getByLabelText(/State/i), { target: { value: 'IL' } });

    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    // Step 3: Sample Data Selection
    await waitFor(() => expect(screen.getByText('Step 3: Sample Data Selection')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    // Step 4: Complete Setup
    await waitFor(() => expect(screen.getByText('Step 4: Complete Setup')).toBeInTheDocument());
  };

  test('opens wedding party modal directly in setup wizard without calling window.open', async () => {
    await navigateToStep2Content();

    const weddingPartyBtn = screen.getByRole('button', { name: /Manage Wedding Party/i });
    expect(weddingPartyBtn).toHaveTextContent('Manage Wedding Party (0 members)');

    fireEvent.click(weddingPartyBtn);

    // Verify window.open was NOT called
    expect(windowOpenSpy).not.toHaveBeenCalled();

    // Verify Modal opens inside page
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Manage Wedding Party')).toBeInTheDocument();
    expect(screen.getByText('0 members configured')).toBeInTheDocument();
  });

  test('creates wedding party member inside modal and updates setup wizard count', async () => {
    await navigateToStep2Content();

    const weddingPartyBtn = screen.getByRole('button', { name: /Manage Wedding Party/i });
    fireEvent.click(weddingPartyBtn);

    // Click "Add New Member" inside modal
    const addBtn = screen.getByRole('button', { name: 'Add New Member' });
    fireEvent.click(addBtn);

    // Fill out form
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'Jordan Smith' } });
    fireEvent.change(screen.getByLabelText(/Role/i), { target: { value: 'Best Person' } });

    // Submit form
    fireEvent.click(screen.getByRole('button', { name: 'Save Member' }));

    await waitFor(() => {
      expect(mockCreateMember).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Jordan Smith',
        role: 'Best Person',
      }));
    });

    // Close modal
    const doneBtn = screen.getByRole('button', { name: 'Done' });
    fireEvent.click(doneBtn);

    // Verify count updated on step 2 wizard button
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Manage Wedding Party/i })).toHaveTextContent('Manage Wedding Party (1 member)');
    });
  });

  test('opens attractions modal directly in setup wizard without calling window.open', async () => {
    await navigateToStep2Content();

    const attractionsBtn = screen.getByRole('button', { name: /Manage Attractions/i });
    expect(attractionsBtn).toHaveTextContent('Manage Attractions (0 items)');

    fireEvent.click(attractionsBtn);

    // Verify window.open was NOT called
    expect(windowOpenSpy).not.toHaveBeenCalled();

    // Verify Modal opens inside page
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Manage Local Attractions')).toBeInTheDocument();
    expect(screen.getByText('0 attractions configured')).toBeInTheDocument();
  });

  test('creates attraction inside modal and updates setup wizard count', async () => {
    await navigateToStep2Content();

    const attractionsBtn = screen.getByRole('button', { name: /Manage Attractions/i });
    fireEvent.click(attractionsBtn);

    // Click "Add New Attraction" inside modal
    const addBtn = screen.getByRole('button', { name: 'Add New Attraction' });
    fireEvent.click(addBtn);

    // Fill out form
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'Lincoln Park Zoo' } });

    // Submit form
    fireEvent.click(screen.getByRole('button', { name: 'Save Attraction' }));

    await waitFor(() => {
      expect(mockCreateAttraction).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Lincoln Park Zoo',
      }));
    });

    // Close modal
    const doneBtn = screen.getByRole('button', { name: 'Done' });
    fireEvent.click(doneBtn);

    // Verify count updated on step 2 wizard button
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Manage Attractions/i })).toHaveTextContent('Manage Attractions (1 item)');
    });
  });

  test('closing modal restores focus to the triggering button', async () => {
    await navigateToStep2Content();

    const weddingPartyBtn = screen.getByRole('button', { name: /Manage Wedding Party/i });
    weddingPartyBtn.focus();
    expect(document.activeElement).toBe(weddingPartyBtn);

    fireEvent.click(weddingPartyBtn);

    // Modal opens
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    // Close modal using Done button
    const doneBtn = screen.getByRole('button', { name: 'Done' });
    fireEvent.click(doneBtn);

    // Modal closes
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // Focus restored to the triggering button
    expect(document.activeElement).toBe(weddingPartyBtn);
  });

  test('persists draft step and inputs to sessionStorage and restores on remount', async () => {
    window.sessionStorage.clear();

    const { unmount } = renderWithProviders(<SetupWizard />);

    // Log in
    fireEvent.change(screen.getByPlaceholderText('Admin Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(screen.getByText('Step 1: The Essentials')).toBeInTheDocument());

    // Enter partner names
    fireEvent.change(screen.getByLabelText(/Partner 1/i), { target: { value: 'Taylor' } });
    fireEvent.change(screen.getByLabelText(/Partner 2/i), { target: { value: 'Jordan' } });

    // Verify draft stored in sessionStorage
    const saved = window.sessionStorage.getItem('setup_wizard_draft');
    expect(saved).not.toBeNull();
    expect(JSON.parse(saved!)).toMatchObject({
      partner1Name: 'Taylor',
      partner2Name: 'Jordan',
    });

    // Unmount and remount SetupWizard
    unmount();

    renderWithProviders(<SetupWizard />);

    // Log in again
    fireEvent.change(screen.getByPlaceholderText('Admin Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(screen.getByText('Step 1: The Essentials')).toBeInTheDocument());

    expect(screen.getByLabelText(/Partner 1/i)).toHaveValue('Taylor');
    expect(screen.getByLabelText(/Partner 2/i)).toHaveValue('Jordan');
  });
});
