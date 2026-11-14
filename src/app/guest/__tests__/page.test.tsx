import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import GuestAddressPage from '../page';

const mockAddToast = jest.fn();
jest.mock('@/components/ui/ToastProvider', () => ({
  useToast: () => ({
    addToast: mockAddToast,
  }),
}));

const globalFetch = jest.fn();
global.fetch = globalFetch;

describe('GuestAddressPage (/guest)', () => {
  beforeEach(() => {
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

    expect(await screen.findByText('Guest Mailing Address Portal')).toBeInTheDocument();
    expect(screen.getByLabelText('Invitation Code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Access Address Portal/i })).toBeInTheDocument();
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

    const submitBtn = screen.getByRole('button', { name: /Access Address Portal/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Welcome Elinor Dashwood!', 'success');
    });

    expect(await screen.findByText('Mailing Address')).toBeInTheDocument();
  });

  it('cancels pending validation when user submits a new code before the previous one completes', async () => {
    let slowSignal: AbortSignal | null = null;
    let fastSignal: AbortSignal | null = null;

    globalFetch.mockImplementation(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      const signal = (init?.signal || input?.signal) as AbortSignal;

      if (url.includes('/api/guest/address') && !fastSignal) {
        // Initial session check: unauthenticated
        return {
          ok: false,
          status: 401,
          json: async () => ({ success: false, error: 'Unauthorized' }),
        };
      }
      if (url.includes('validate-code?code=SLOWCODE')) {
        slowSignal = signal;
        return new Promise(() => {});
      }
      if (url.includes('validate-code?code=FASTCODE')) {
        fastSignal = signal;
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
      if (url.includes('/api/guest/address') && fastSignal) {
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
      expect(slowSignal).not.toBeNull();
    });
    expect(slowSignal?.aborted).toBe(false);

    // User submits FASTCODE before SLOWCODE completes
    fireEvent.change(input, { target: { value: 'FASTCODE' } });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(fastSignal).not.toBeNull();
    });

    // SLOWCODE request was aborted!
    expect(slowSignal?.aborted).toBe(true);
    expect(fastSignal?.aborted).toBe(false);

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
    expect(await screen.findByText('Guest Mailing Address Portal')).toBeInTheDocument();
    expect(screen.getByLabelText('Invitation Code')).toBeInTheDocument();
  });
});
