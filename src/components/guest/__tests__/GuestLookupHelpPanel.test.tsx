import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe } from 'jest-axe';
import { GuestLookupHelpPanel } from '../GuestLookupHelpPanel';

describe('GuestLookupHelpPanel', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('forwards ref, merges custom className, renders spelling tips, and passes jest-axe', async () => {
    const ref = React.createRef<HTMLDivElement>();
    const { container } = render(
      <GuestLookupHelpPanel
        ref={ref}
        className="mt-6 custom-test-class"
        initialGuestName="Alex Rivera"
        initialEmail="alex@example.com"
        idPrefix="test-lookup"
      />
    );

    const panel = screen.getByTestId('guest-lookup-help-panel');
    expect(ref.current).toBe(panel);
    expect(panel).toHaveClass('mt-6', 'custom-test-class');
    expect(screen.getByRole('heading', { name: /Spelling & Name Lookup Tips/i })).toBeInTheDocument();
    expect(screen.getByText(/both your first and last name/i)).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });

  it('validates required inputs, submits host alert, and handles cancellation', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        message: 'Host alert delivered!',
      }),
    });

    const { container } = render(<GuestLookupHelpPanel idPrefix="alert-test" />);

    fireEvent.click(screen.getByTestId('open-host-alert-button'));
    expect(screen.getByTestId('guest-lookup-alert-form')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    // Missing name and email triggers inline validation alert
    fireEvent.click(screen.getByTestId('submit-host-alert-button'));
    expect(screen.getByTestId('guest-lookup-alert-error')).toHaveTextContent(
      /Please enter both your full name and email address/i
    );

    // Cancel hides the form and clears error
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(screen.queryByTestId('guest-lookup-alert-form')).not.toBeInTheDocument();

    // Re-open, populate fields, and submit successfully
    fireEvent.click(screen.getByTestId('open-host-alert-button'));
    fireEvent.change(screen.getByLabelText(/Your Full Name/i), {
      target: { value: '  Jordan Taylor  ' },
    });
    fireEvent.change(screen.getByLabelText(/Your Email Address/i), {
      target: { value: '  jordan@example.com  ' },
    });
    fireEvent.change(screen.getByLabelText(/Note for Hosts/i), {
      target: { value: '  Seated with Casey  ' },
    });

    fireEvent.click(screen.getByTestId('submit-host-alert-button'));

    await waitFor(() => {
      expect(screen.getByTestId('guest-lookup-alert-success')).toHaveTextContent(
        'Host alert delivered!'
      );
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/guest/lookup/alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guestName: 'Jordan Taylor',
        guestEmail: 'jordan@example.com',
        message: 'Seated with Casey',
      }),
    });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('displays server and network errors gracefully', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Too many requests. Please wait 15 minutes.' }),
      })
      .mockRejectedValueOnce(new Error('Network down'));

    render(
      <GuestLookupHelpPanel
        initialGuestName="Sam Patel"
        initialEmail="sam@example.com"
      />
    );

    fireEvent.click(screen.getByTestId('open-host-alert-button'));
    fireEvent.click(screen.getByTestId('submit-host-alert-button'));

    await waitFor(() => {
      expect(screen.getByTestId('guest-lookup-alert-error')).toHaveTextContent(
        'Too many requests. Please wait 15 minutes.'
      );
    });

    fireEvent.click(screen.getByTestId('submit-host-alert-button'));

    await waitFor(() => {
      expect(screen.getByTestId('guest-lookup-alert-error')).toHaveTextContent(
        /A network error occurred while sending the alert/i
      );
    });
  });
});
