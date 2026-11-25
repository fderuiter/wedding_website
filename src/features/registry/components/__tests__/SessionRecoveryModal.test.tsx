import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { SessionRecoveryModal } from '../SessionRecoveryModal';
import { GuestSessionProvider } from '../../context/GuestSessionContext';
import { apiClient, ApiError } from '@/lib/apiClient';

expect.extend(toHaveNoViolations);

jest.mock('@/lib/apiClient', () => ({
  ...jest.requireActual('@/lib/apiClient'),
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

describe('SessionRecoveryModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders modal when isOpen is true', () => {
    (apiClient.get as jest.Mock).mockResolvedValue({ isVerified: false });

    render(
      <GuestSessionProvider>
        <SessionRecoveryModal isOpen={true} />
      </GuestSessionProvider>
    );

    expect(screen.getByText('Session Expired')).toBeInTheDocument();
    expect(screen.getByLabelText(/Invitation Code/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Re-verify Code/i })).toBeInTheDocument();
  });

  it('allows user to enter invitation code and submit recovery', async () => {
    (apiClient.get as jest.Mock)
      .mockResolvedValueOnce({ isVerified: false })
      .mockResolvedValueOnce({
        isVerified: true,
        code: 'NEWCODE1',
        guestName: 'Jane Restored',
        email: 'jane@example.com',
      });
    (apiClient.post as jest.Mock).mockResolvedValueOnce({
      sessionType: 'invitation',
      code: 'NEWCODE1',
      guestName: 'Jane Restored',
    });

    const handleSuccess = jest.fn();

    render(
      <GuestSessionProvider>
        <SessionRecoveryModal isOpen={true} onSuccess={handleSuccess} />
      </GuestSessionProvider>
    );

    const input = screen.getByLabelText(/Invitation Code/i);
    fireEvent.change(input, { target: { value: 'NEWCODE1' } });

    const submitBtn = screen.getByRole('button', { name: /Re-verify Code/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/api/guest/login', {
        passcode: 'NEWCODE1',
        requireInvitation: true,
      });
      expect(handleSuccess).toHaveBeenCalled();
    });
  });

  it('surfaces shared_passcode guidance when /api/guest/login returns HTTP 401 with reason: shared_passcode', async () => {
    (apiClient.get as jest.Mock).mockResolvedValueOnce({ isVerified: false });
    (apiClient.post as jest.Mock).mockRejectedValueOnce(
      new ApiError(
        401,
        'That is the shared website passcode. Please enter your unique household invitation code.',
        {
          success: false,
          valid: false,
          reason: 'shared_passcode',
          error:
            'That is the shared website passcode. Please enter your unique household invitation code.',
        }
      )
    );

    render(
      <GuestSessionProvider>
        <SessionRecoveryModal isOpen={true} />
      </GuestSessionProvider>
    );

    const input = screen.getByLabelText(/Invitation Code/i);
    fireEvent.change(input, { target: { value: 'WEDDING2026' } });
    fireEvent.click(screen.getByRole('button', { name: /Re-verify Code/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/shared website passcode/i);
  });

  it('displays error message when invitation code validation fails', async () => {
    (apiClient.get as jest.Mock).mockResolvedValueOnce({ isVerified: false });
    (apiClient.post as jest.Mock).mockResolvedValueOnce({
      valid: false,
    });

    render(
      <GuestSessionProvider>
        <SessionRecoveryModal isOpen={true} />
      </GuestSessionProvider>
    );

    const input = screen.getByLabelText(/Invitation Code/i);
    fireEvent.change(input, { target: { value: 'BADCODE' } });

    const submitBtn = screen.getByRole('button', { name: /Re-verify Code/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Invalid invitation code/i)).toBeInTheDocument();
    });
  });

  it('exposes required and aria-required="true", hides the visual asterisk with aria-hidden="true", retains focus during async verification, and passes jest-axe', async () => {
    let resolveVerify: ((value: { valid: boolean }) => void) | null = null;
    (apiClient.get as jest.Mock).mockResolvedValueOnce({ isVerified: false });
    (apiClient.post as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<{ valid: boolean }>((resolve) => {
          resolveVerify = resolve;
        })
    );

    const { container } = render(
      <GuestSessionProvider>
        <SessionRecoveryModal isOpen={true} />
      </GuestSessionProvider>
    );

    const input = screen.getByLabelText(/Invitation Code/i) as HTMLInputElement;
    const label = container.querySelector('label[for="recovery-invitation-code"]');

    expect(input).toBeRequired();
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(label).not.toBeNull();
    const hiddenAsterisk = label?.querySelector('[aria-hidden="true"]');
    expect(hiddenAsterisk).not.toBeNull();
    expect(hiddenAsterisk).toHaveTextContent('*');

    input.focus();
    fireEvent.change(input, { target: { value: 'WRONG123' } });
    fireEvent.submit(input.closest('form')!);

    // Input uses readOnly + aria-busy instead of disabled and retains focus
    expect(input).not.toBeDisabled();
    expect(input).toHaveAttribute('readonly');
    expect(input).toHaveAttribute('aria-busy', 'true');
    expect(document.activeElement).toBe(input);

    resolveVerify!({ valid: false });

    const alertMsg = await screen.findByRole('alert');
    expect(alertMsg).toHaveTextContent(/Invalid invitation code/i);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', alertMsg.id);
    expect(input).not.toHaveAttribute('readonly');
    expect(document.activeElement).toBe(input);

    expect(await axe(container)).toHaveNoViolations();
  });
});
