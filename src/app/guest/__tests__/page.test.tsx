import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import GuestAddressPage from '../page';

expect.extend(toHaveNoViolations);

const mockAddToast = jest.fn();
jest.mock('@/components/ui/ToastProvider', () => ({
  useToast: () => ({
    addToast: mockAddToast,
  }),
  useOptionalToast: () => ({
    addToast: mockAddToast,
    toasts: [],
  }),
}));

const globalFetch = jest.fn();
global.fetch = globalFetch;

describe('GuestAddressPage (/guest)', () => {
  beforeEach(() => {
    global.fetch = globalFetch;
    globalFetch.mockReset();
    mockAddToast.mockReset();
    window.history.pushState({}, '', '/guest');
  });

  it('renders invitation code entry form when unauthenticated without code param', async () => {
    // Unauthenticated GET /api/guest/address
    globalFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ success: false, error: 'Unauthorized' }),
    });

    render(<GuestAddressPage />);

    expect(await screen.findByLabelText('Invitation Code')).toBeInTheDocument();
    expect(screen.getByText('Guest RSVP & Address Portal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Access Guest Portal/i })).toBeInTheDocument();
  });

  it('pre-authenticates session when code query parameter is provided in URL', async () => {
    // Set URL with code query param via pushState
    window.history.pushState({}, '', '/guest?code=AUTOPREAUTH26');

    // 1st fetch: /api/registry/validate-code?code=AUTOPREAUTH26
    globalFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        valid: true,
        guestName: 'Marianne Dashwood',
        code: 'AUTOPREAUTH26',
      }),
    });

    // 2nd fetch: /api/guest/address
    globalFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          guestName: 'Marianne Dashwood',
          code: 'AUTOPREAUTH26',
          addressLine1: 'Barton Cottage',
          addressLine2: '',
          city: 'Devon',
          state: 'England',
          zipCode: 'EX1',
          country: 'UK',
        },
      }),
    });

    render(<GuestAddressPage />);

    await waitFor(() => {
      const calledUrls = globalFetch.mock.calls.map((call) => {
        const arg = call[0];
        return typeof arg === 'string' ? arg : arg?.url || '';
      });
      expect(calledUrls.some((url) => url.includes('/api/registry/validate-code?code=AUTOPREAUTH26'))).toBe(true);
      expect(mockAddToast).toHaveBeenCalledWith('Welcome Marianne Dashwood!', 'success');
    });

    expect(await screen.findByText('Mailing Address')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Barton Cottage')).toBeInTheDocument();
  });

  it('manually validates code form and authenticates guest session', async () => {
    // Initial fetch unauthenticated
    globalFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ success: false, error: 'Unauthorized' }),
    });

    render(<GuestAddressPage />);

    const codeInput = await screen.findByLabelText('Invitation Code');
    fireEvent.change(codeInput, { target: { value: 'MANUALCODE26' } });

    // validate-code call
    globalFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        valid: true,
        guestName: 'Elinor Dashwood',
        code: 'MANUALCODE26',
      }),
    });

    // subsequent fetchAddress call
    globalFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          guestName: 'Elinor Dashwood',
          code: 'MANUALCODE26',
          addressLine1: 'Norland Park',
          city: 'Sussex',
          state: '',
          zipCode: '',
          country: 'UK',
        },
      }),
    });

    const submitBtn = screen.getByRole('button', { name: /Access Guest Portal/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Welcome Elinor Dashwood!', 'success');
    });

    expect(await screen.findByText('Mailing Address')).toBeInTheDocument();
  });

  it('cancels pending validation when user submits a new code before the previous one completes', async () => {
    const signals: { slow: AbortSignal | null; fast: AbortSignal | null } = {
      slow: null,
      fast: null,
    };

    globalFetch.mockImplementation(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      const signal = (init?.signal || input?.signal) as AbortSignal;

      if (url.includes('/api/guest/address') && !signals.fast) {
        // Initial session check: unauthenticated
        return {
          ok: false,
          status: 401,
          json: async () => ({ success: false, error: 'Unauthorized' }),
        };
      }
      if (url.includes('validate-code?code=SLOWCODE')) {
        signals.slow = signal;
        return new Promise(() => {});
      }
      if (url.includes('validate-code?code=FASTCODE')) {
        signals.fast = signal;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            valid: true,
            guestName: 'Jane Fairfax',
            code: 'FASTCODE',
          }),
        };
      }
      if (url.includes('/api/guest/address') && signals.fast) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              guestName: 'Jane Fairfax',
              code: 'FASTCODE',
              addressLine1: 'Highbury House',
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    render(<GuestAddressPage />);

    // Wait for unauthenticated code form to show
    const input = await screen.findByLabelText('Invitation Code');
    const form = input.closest('form')!;

    // Submit SLOWCODE
    fireEvent.change(input, { target: { value: 'SLOWCODE' } });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(signals.slow).not.toBeNull();
    });
    expect(signals.slow?.aborted).toBe(false);

    // User submits FASTCODE before SLOWCODE completes
    fireEvent.change(input, { target: { value: 'FASTCODE' } });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(signals.fast).not.toBeNull();
    });

    // SLOWCODE request was aborted!
    expect(signals.slow?.aborted).toBe(true);
    expect(signals.fast?.aborted).toBe(false);

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Welcome Jane Fairfax!', 'success');
    });
    expect(await screen.findByText('Mailing Address')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Highbury House')).toBeInTheDocument();
  });

  it('preserves form inputs and keeps form mounted when network fails during address save', async () => {
    // 1. Initial load authenticated
    globalFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          guestName: 'Marianne Dashwood',
          code: 'AUTOPREAUTH26',
          addressLine1: 'Barton Cottage',
          city: 'Devon',
        },
      }),
    });

    render(<GuestAddressPage />);

    expect(await screen.findByText('Mailing Address')).toBeInTheDocument();
    const addressInput = screen.getByLabelText('Address Line 1');
    expect(addressInput).toHaveValue('Barton Cottage');

    // 2. User edits address
    fireEvent.change(addressInput, { target: { value: 'Cleveland Estate' } });
    expect(addressInput).toHaveValue('Cleveland Estate');

    // 3. Save fails due to transient 500 error
    globalFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({
        success: false,
        error: 'Database timeout',
      }),
    });

    const saveBtn = screen.getByRole('button', { name: /Save Mailing Address/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Database timeout', 'error');
    });

    // Form must remain mounted and user inputs must NOT be wiped!
    expect(screen.getByText('Mailing Address')).toBeInTheDocument();
    expect(screen.getByLabelText('Address Line 1')).toHaveValue('Cleveland Estate');

    // 4. Save fails due to network drop (TypeError)
    globalFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Failed to fetch', 'error');
    });

    // Form still mounted and inputs intact
    expect(screen.getByText('Mailing Address')).toBeInTheDocument();
    expect(screen.getByLabelText('Address Line 1')).toHaveValue('Cleveland Estate');

    // 5. Subsequent retry succeeds
    globalFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          addressLine1: 'Cleveland Estate',
          city: 'Devon',
        },
      }),
    });

    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'Your mailing address has been updated successfully!',
        'success'
      );
    });

    expect(screen.getByLabelText('Address Line 1')).toHaveValue('Cleveland Estate');
  });

  it('unseats session and returns to code prompt when save receives 401 Unauthorized', async () => {
    // 1. Initial load authenticated
    globalFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          guestName: 'Marianne Dashwood',
          code: 'AUTOPREAUTH26',
          addressLine1: 'Barton Cottage',
        },
      }),
    });

    render(<GuestAddressPage />);

    expect(await screen.findByText('Mailing Address')).toBeInTheDocument();

    // 2. Save fails with 401
    globalFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({
        success: false,
        error: 'Unauthorized',
      }),
    });

    const saveBtn = screen.getByRole('button', { name: /Save Mailing Address/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'Session expired. Please enter your invitation code.',
        'error'
      );
    });

    // Session is reset, returns to invitation code entry form
    expect(await screen.findByText('Guest RSVP & Address Portal')).toBeInTheDocument();
    expect(screen.getByLabelText('Invitation Code')).toBeInTheDocument();
  });

  it('renders both personalized RSVP controls (public + authorized private SubEvents) and mailing address form when visiting /guest?code=<valid_code>', async () => {
    window.history.pushState({}, '', '/guest?code=UNIFIED26');

    globalFetch.mockImplementation(async (input: any) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('/api/registry/validate-code?code=UNIFIED26')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            valid: true,
            guestName: 'Elizabeth Bennet',
            code: 'UNIFIED26',
          }),
        };
      }
      if (url.includes('/api/guest/address')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              guestName: 'Elizabeth Bennet',
              code: 'UNIFIED26',
              addressLine1: 'Longbourn House',
              city: 'Meryton',
            },
          }),
        };
      }
      if (url.includes('/api/schedule')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            isGuest: true,
            guestName: 'Elizabeth Bennet',
            plusOneAllocations: 1,
            data: [
              {
                id: 'se-pub',
                title: 'Wedding Ceremony',
                startTime: '2026-06-20T15:00:00.000Z',
                category: 'Ceremony',
                isPrivate: false,
                isReadOnly: false,
                userRsvp: null,
              },
              {
                id: 'se-priv',
                title: 'Private Rehearsal Dinner',
                startTime: '2026-06-19T18:00:00.000Z',
                category: 'Rehearsal',
                isPrivate: true,
                isReadOnly: false,
                userRsvp: { status: 'attending', plusOneCount: 1, dietaryNotes: '' },
              },
            ],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ success: true, data: [] }) };
    });

    render(<GuestAddressPage />);

    const primaryRsvpSection = await screen.findByTestId('guest-rsvp-primary-section');
    const secondaryAddressSection = screen.getByTestId('guest-address-secondary-section');

    // Verify RSVP section comes before secondary Mailing Address section in DOM order
    expect(
      primaryRsvpSection.compareDocumentPosition(secondaryAddressSection) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    expect(await screen.findByText('Wedding Ceremony')).toBeInTheDocument();
    expect(screen.getByText('Private Rehearsal Dinner')).toBeInTheDocument();
    expect(screen.getByTestId('rsvp-card-se-pub')).toBeInTheDocument();
    expect(screen.getByTestId('rsvp-card-se-priv')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Longbourn House')).toBeInTheDocument();
  });

  it('displays an accessible error alert (role="alert") and recovers via Retry when initial session verification fails with 5xx or network error', async () => {
    // 1. Initial GET /api/guest/address fails with 503
    globalFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({
        success: false,
        error: 'Gateway unavailable during session check.',
      }),
    });

    render(<GuestAddressPage />);

    const alertBanner = await screen.findByRole('alert');
    expect(alertBanner).toHaveTextContent('Gateway unavailable during session check.');

    const retryBtn = screen.getByRole('button', { name: /^Retry$/i });
    expect(retryBtn).toBeInTheDocument();

    // 2. Connection restored: GET /api/guest/address returns 200 authenticated
    globalFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          guestName: 'Fitzwilliam Darcy',
          code: 'DARCY26',
          addressLine1: 'Pemberley',
        },
      }),
    });

    fireEvent.click(retryBtn);

    expect(await screen.findByText('Mailing Address')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Pemberley')).toBeInTheDocument();
  });

  it('opens passcode recovery help modal from inline Need Help? trigger near Invitation Code input', async () => {
    globalFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ success: false, error: 'Unauthorized' }),
    });

    render(<GuestAddressPage />);

    const helpTrigger = await screen.findByRole('button', { name: /Need Help\?/i });
    helpTrigger.focus();
    fireEvent.click(helpTrigger);

    const dialog = screen.getByRole('dialog', { name: /Guest Help & Support/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText(/Physical envelopes & paper mailers/i)).toBeInTheDocument();
    expect(screen.getByText(/Digital announcements & emails/i)).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(helpTrigger);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('renders the formatted deadline and venue timezone banner above the schedule while RSVPs remain open', async () => {
    globalFetch.mockImplementation(async (input: any) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('/api/guest/address')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              guestName: 'Emma Woodhouse',
              code: 'HARTFIELD26',
              addressLine1: 'Hartfield Estate',
            },
          }),
        };
      }
      if (url.includes('/api/schedule')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            isGuest: true,
            guestName: 'Emma Woodhouse',
            plusOneAllocations: 1,
            rsvpOpen: true,
            rsvpDeadlineDate: '2026-08-15',
            rsvpFormattedDeadline: 'August 15, 2026',
            timezone: 'America/Chicago',
            rsvpClosedMessage: 'Online RSVPs are closed.',
            data: [
              {
                id: 'se-1',
                title: 'Ceremony',
                startTime: '2026-09-19T16:00:00.000Z',
                category: 'Ceremony',
                isPrivate: false,
                isReadOnly: false,
                userRsvp: { status: 'attending', plusOneCount: 1, dietaryNotes: '' },
              },
            ],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    render(<GuestAddressPage />);

    const deadlineBanner = await screen.findByTestId('guest-rsvp-deadline-banner');
    expect(deadlineBanner).toHaveTextContent('August 15, 2026');
    expect(deadlineBanner).toHaveTextContent('America/Chicago');
    expect(screen.getByTestId('rsvp-card-se-1')).toBeInTheDocument();
  });

  it('renders the closed banner above the read-only schedule while keeping the mailing address form editable after RSVPs close', async () => {
    let addressPatchSaved = false;
    globalFetch.mockImplementation(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('/api/guest/address') && init?.method === 'PUT') {
        addressPatchSaved = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              guestName: 'Emma Woodhouse',
              code: 'HARTFIELD26',
              addressLine1: 'Donwell Abbey',
            },
          }),
        };
      }
      if (url.includes('/api/guest/address')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              guestName: 'Emma Woodhouse',
              code: 'HARTFIELD26',
              addressLine1: 'Hartfield Estate',
            },
          }),
        };
      }
      if (url.includes('/api/schedule')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            isGuest: true,
            guestName: 'Emma Woodhouse',
            plusOneAllocations: 1,
            rsvpOpen: false,
            rsvpDeadlineDate: '2026-08-15',
            rsvpFormattedDeadline: 'August 15, 2026',
            timezone: 'America/Chicago',
            rsvpClosedMessage: 'Online RSVPs have closed. Please email couple@example.com for meal changes.',
            data: [
              {
                id: 'se-1',
                title: 'Reception Dinner',
                startTime: '2026-09-19T18:00:00.000Z',
                category: 'Reception',
                isPrivate: false,
                isReadOnly: false,
                userRsvp: { status: 'attending', plusOneCount: 1, dietaryNotes: 'Nut allergy' },
              },
            ],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    render(<GuestAddressPage />);

    const closedBanner = await screen.findByTestId('guest-rsvp-closed-banner');
    expect(closedBanner).toHaveTextContent(
      'Online RSVPs have closed. Please email couple@example.com for meal changes.'
    );

    // Saved RSVP is displayed in read-only mode with no Save RSVP button
    const readOnlyCard = await screen.findByTestId('rsvp-readonly-se-1');
    expect(readOnlyCard).toHaveTextContent('Attending');
    expect(readOnlyCard).toHaveTextContent('1');
    expect(readOnlyCard).toHaveTextContent('Nut allergy');
    expect(screen.queryByRole('button', { name: /Save RSVP/i })).not.toBeInTheDocument();

    // Mailing address form remains editable and submittable
    const addressInput = screen.getByLabelText('Address Line 1') as HTMLInputElement;
    expect(addressInput).not.toBeDisabled();
    fireEvent.change(addressInput, { target: { value: 'Donwell Abbey' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Mailing Address/i }));

    await waitFor(() => {
      expect(addressPatchSaved).toBe(true);
    });
  });

  it('binds #guest-invitation-code to aria-invalid="true" and aria-describedby on failed validation and passes jest-axe', async () => {
    globalFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ success: false, error: 'Unauthorized' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ success: false, error: 'Invitation code not found.' }),
      });

    const { container } = render(<GuestAddressPage />);

    const codeInput = (await screen.findByLabelText('Invitation Code')) as HTMLInputElement;
    expect(codeInput).toHaveAttribute('id', 'guest-invitation-code');
    expect(codeInput).toHaveAttribute('aria-invalid', 'false');

    fireEvent.change(codeInput, { target: { value: 'NOTVALID' } });
    fireEvent.click(screen.getByRole('button', { name: /Access Guest Portal/i }));

    const alertMsg = await screen.findByRole('alert');
    expect(alertMsg).toHaveTextContent('Invitation code not found.');
    expect(codeInput).toHaveAttribute('aria-invalid', 'true');
    expect(codeInput).toHaveAttribute('aria-describedby', alertMsg.id);
    expect(mockAddToast).not.toHaveBeenCalled();

    expect(await axe(container)).toHaveNoViolations();
  });

  it('exposes standard W3C postal autoComplete tokens on all six mailing address inputs and passes jest-axe', async () => {
    globalFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          guestName: 'Elinor Dashwood',
          code: 'NORLAND26',
          addressLine1: '123 Main Street',
          addressLine2: 'Apt 4B',
          city: 'San Francisco',
          state: 'CA',
          zipCode: '94102',
          country: 'United States',
        },
      }),
    });

    const { container } = render(<GuestAddressPage />);

    expect(await screen.findByText('Mailing Address')).toBeInTheDocument();

    expect(screen.getByLabelText('Address Line 1')).toHaveAttribute('autocomplete', 'address-line1');
    expect(screen.getByLabelText('Address Line 2 (Optional)')).toHaveAttribute('autocomplete', 'address-line2');
    expect(screen.getByLabelText('City')).toHaveAttribute('autocomplete', 'address-level2');
    expect(screen.getByLabelText('State / Province / Region')).toHaveAttribute('autocomplete', 'address-level1');
    expect(screen.getByLabelText('ZIP / Postal Code')).toHaveAttribute('autocomplete', 'postal-code');
    expect(screen.getByLabelText('Country')).toHaveAttribute('autocomplete', 'country-name');

    expect(await axe(container)).toHaveNoViolations();
  });
});
