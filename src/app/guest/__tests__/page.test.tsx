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
});
