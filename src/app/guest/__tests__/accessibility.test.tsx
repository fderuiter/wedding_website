import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ToastProvider } from '@/components/ui/ToastProvider';
import GuestAddressPage from '../page';

expect.extend(toHaveNoViolations);

const globalFetch = jest.fn();

describe('GuestAddressPage live region deduplication with ToastProvider', () => {
  beforeEach(() => {
    global.fetch = globalFetch;
    globalFetch.mockReset();
    window.history.pushState({}, '', '/guest');
  });

  it('triggers exactly one assertive role="alert" announcement when invitation code validation fails', async () => {
    globalFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ success: false, error: 'Unauthorized' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ success: false, error: 'Invalid or expired invitation code.' }),
      });

    const { container } = render(
      <ToastProvider>
        <GuestAddressPage />
      </ToastProvider>
    );

    const codeInput = await screen.findByLabelText('Invitation Code');
    fireEvent.change(codeInput, { target: { value: 'BADCODE1' } });
    fireEvent.click(screen.getByRole('button', { name: /Access Guest Portal/i }));

    await waitFor(() => {
      expect(codeInput).toHaveAttribute('aria-invalid', 'true');
    });

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('Invalid or expired invitation code.');
    expect(codeInput).toHaveAttribute('aria-describedby', alerts[0].id);

    expect(await axe(container)).toHaveNoViolations();
  });

  it('triggers exactly one assertive role="alert" announcement when mailing address save fails with 500', async () => {
    globalFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/api/guest/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              status: 'invitation',
              isVerified: true,
              code: 'BARTON26',
              guestName: 'Marianne Dashwood',
            },
          }),
        };
      }
      if (url.includes('/api/guest/address') && (!init?.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              guestName: 'Marianne Dashwood',
              code: 'BARTON26',
              addressLine1: 'Barton Cottage',
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
            guestName: 'Marianne Dashwood',
            rsvpOpen: true,
            data: [],
          }),
        };
      }
      return {
        ok: false,
        status: 500,
        json: async () => ({ success: false, error: 'Database timeout' }),
      };
    });

    const { container } = render(
      <ToastProvider>
        <GuestAddressPage />
      </ToastProvider>
    );

    expect(await screen.findByText('Mailing Address')).toBeInTheDocument();

    const line1Input = screen.getByLabelText('Address Line 1');
    line1Input.focus();
    fireEvent.change(line1Input, { target: { value: 'Cleveland House' } });
    fireEvent.submit(line1Input.closest('form')!);

    await waitFor(() => {
      expect(screen.getByTestId('guest-address-save-error-alert')).toBeInTheDocument();
    });

    // Active input retains focus across busy readOnly save lock
    expect(document.activeElement).toBe(line1Input);

    // Only one assertive alert is announced despite both inline retry callout and ToastProvider
    const saveAlerts = screen.getAllByRole('alert');
    expect(saveAlerts).toHaveLength(1);
    expect(saveAlerts[0]).toHaveTextContent('Database timeout');

    expect(await axe(container)).toHaveNoViolations();
  });

  it('triggers exactly one assertive role="alert" announcement when mailing address save fails with 401 session expiry', async () => {
    globalFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/api/guest/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              status: 'invitation',
              isVerified: true,
              code: 'BARTON26',
              guestName: 'Marianne Dashwood',
            },
          }),
        };
      }
      if (url.includes('/api/guest/address') && (!init?.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              guestName: 'Marianne Dashwood',
              code: 'BARTON26',
              addressLine1: 'Barton Cottage',
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
            guestName: 'Marianne Dashwood',
            rsvpOpen: true,
            data: [],
          }),
        };
      }
      return {
        ok: false,
        status: 401,
        json: async () => ({ success: false, error: 'Unauthorized' }),
      };
    });

    const { container } = render(
      <ToastProvider>
        <GuestAddressPage />
      </ToastProvider>
    );

    expect(await screen.findByText('Mailing Address')).toBeInTheDocument();

    const line1Input = screen.getByLabelText('Address Line 1');
    fireEvent.change(line1Input, { target: { value: 'Cleveland House' } });
    fireEvent.submit(line1Input.closest('form')!);

    const reloginInput = await screen.findByLabelText('Invitation Code');
    expect(reloginInput).toHaveAttribute('aria-invalid', 'true');
    expect(reloginInput).toHaveAttribute('aria-describedby', 'guest-invitation-code-error');

    const authExpiredAlerts = screen.getAllByRole('alert');
    expect(authExpiredAlerts).toHaveLength(1);
    expect(authExpiredAlerts[0]).toHaveTextContent(
      'Session expired. Please enter your invitation code.'
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
