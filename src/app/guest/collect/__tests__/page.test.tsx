import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import GuestAddressCollectPage from '../page';

// Mock global fetch
const globalFetch = jest.fn();
global.fetch = globalFetch;

describe('GuestAddressCollectPage (/guest/collect)', () => {
  beforeEach(() => {
    globalFetch.mockReset();
  });

  test('renders form with all inputs and submit button', () => {
    render(<GuestAddressCollectPage />);

    expect(screen.getByText('Mailing Address Form')).toBeInTheDocument();
    expect(screen.getByLabelText(/Full Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Full Name/i)).toHaveAttribute('autocomplete', 'name');
    expect(screen.getByLabelText(/Email Address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Email Address/i)).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText(/Street Address Line 1/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Street Address Line 1/i)).toHaveAttribute('autocomplete', 'address-line1');
    expect(screen.getByLabelText(/Address Line 2/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Address Line 2/i)).toHaveAttribute('autocomplete', 'address-line2');
    expect(screen.getByLabelText(/City/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/City/i)).toHaveAttribute('autocomplete', 'address-level2');
    expect(screen.getByLabelText(/State \/ Province/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/State \/ Province/i)).toHaveAttribute('autocomplete', 'address-level1');
    expect(screen.getByLabelText(/ZIP \/ Postal Code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ZIP \/ Postal Code/i)).toHaveAttribute('autocomplete', 'postal-code');
    expect(screen.getByLabelText(/Country/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Country/i)).toHaveAttribute('autocomplete', 'country-name');
    expect(screen.getByLabelText(/Household Notes/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit Address/i })).toBeInTheDocument();
  });

  test('shows error message if submitted without guest name', async () => {
    render(<GuestAddressCollectPage />);

    const submitBtn = screen.getByRole('button', { name: /Submit Address/i });
    fireEvent.submit(submitBtn.closest('form')!);

    expect(await screen.findByText('Please enter your full name.')).toBeInTheDocument();
    expect(globalFetch).not.toHaveBeenCalled();
  });

  test('submits valid form data and renders confirmation screen', async () => {
    globalFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        message: 'Address submitted successfully.',
        data: { id: 'code-1', code: 'ABC12345', guestName: 'Alice Guest', partyTags: ['address-collection'] },
      }),
    });

    render(<GuestAddressCollectPage />);

    fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: 'Alice Guest' } });
    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'alice@example.com' } });
    fireEvent.change(screen.getByLabelText(/Street Address Line 1/i), { target: { value: '100 Main St' } });
    fireEvent.change(screen.getByLabelText(/City/i), { target: { value: 'Denver' } });
    fireEvent.change(screen.getByLabelText(/State \/ Province/i), { target: { value: 'CO' } });
    fireEvent.change(screen.getByLabelText(/ZIP \/ Postal Code/i), { target: { value: '80202' } });

    const submitBtn = screen.getByRole('button', { name: /Submit Address/i });
    fireEvent.submit(submitBtn.closest('form')!);

    await waitFor(() => {
      expect(globalFetch).toHaveBeenCalled();
      const calledArg = globalFetch.mock.calls[0][0];
      const url = typeof calledArg === 'string' ? calledArg : calledArg.url;
      expect(url).toContain('/api/guest/address/public');
    });

    await waitFor(() => {
      expect(screen.getByText('Address Received!')).toBeInTheDocument();
    });
    expect(screen.getByText(/Thank you for providing your mailing details/i)).toBeInTheDocument();
  });

  test('handles API error response gracefully', async () => {
    globalFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        success: false,
        error: 'Invalid email address.',
      }),
    });

    render(<GuestAddressCollectPage />);

    fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: 'Bob Guest' } });
    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'invalid-email' } });

    const submitBtn = screen.getByRole('button', { name: /Submit Address/i });
    fireEvent.submit(submitBtn.closest('form')!);

    await waitFor(() => {
      expect(screen.getByText('Invalid email address.')).toBeInTheDocument();
    });
  });

  test('resets form when clicking "Submit Another Address"', async () => {
    globalFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        message: 'Address submitted successfully.',
      }),
    });

    render(<GuestAddressCollectPage />);

    fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: 'Charlie Guest' } });
    const submitBtn = screen.getByRole('button', { name: /Submit Address/i });
    fireEvent.submit(submitBtn.closest('form')!);

    await waitFor(() => {
      expect(screen.getByText('Address Received!')).toBeInTheDocument();
    });

    const anotherBtn = screen.getByRole('button', { name: /Submit Another Address/i });
    fireEvent.click(anotherBtn);

    await waitFor(() => {
      expect(screen.getByText('Mailing Address Form')).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/Full Name/i)).toHaveValue('');
  });

  test('renders container and card with semantic theme utility classes', async () => {
    const { container } = render(<GuestAddressCollectPage />);

    const mainElement = container.querySelector('main');
    expect(mainElement).toHaveClass('bg-container');
    expect(mainElement?.className).not.toContain('bg-gray-50');

    const cardElement = screen.getByText('Mailing Address Form').closest('div.rounded-2xl');
    expect(cardElement).toHaveClass('bg-card');
    expect(cardElement).toHaveClass('border-card-border');
    expect(cardElement?.className).not.toContain('bg-white');
    expect(cardElement?.className).not.toContain('border-gray-100');

    const heading = screen.getByText('Mailing Address Form');
    expect(heading).toHaveClass('text-heading');
  });
});
