import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SessionRecoveryModal } from '../SessionRecoveryModal';
import { GuestSessionProvider } from '../../context/GuestSessionContext';
import { apiClient } from '@/lib/apiClient';

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    get: jest.fn(),
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
        valid: true,
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
      expect(apiClient.get).toHaveBeenCalledWith('/api/registry/validate-code?code=NEWCODE1');
      expect(handleSuccess).toHaveBeenCalled();
    });
  });

  it('displays error message when invitation code validation fails', async () => {
    (apiClient.get as jest.Mock)
      .mockResolvedValueOnce({ isVerified: false })
      .mockResolvedValueOnce({
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
});
