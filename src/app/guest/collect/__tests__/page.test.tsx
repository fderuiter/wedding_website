import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import GuestAddressCollectPage from '../page';

expect.extend(toHaveNoViolations);

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
    expect(screen.getByLabelText(/Household Name/i)).toBeInTheDocument();
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

    const nameInput = screen.getByLabelText(/Full Name/i);
    fireEvent.change(screen.getByLabelText(/Street Address Line 1/i), { target: { value: '100 Main St' } });
    fireEvent.change(screen.getByLabelText(/City/i), { target: { value: 'Denver' } });
    fireEvent.change(screen.getByLabelText(/State \/ Province/i), { target: { value: 'CO' } });
    fireEvent.change(screen.getByLabelText(/ZIP \/ Postal Code/i), { target: { value: '80202' } });

    expect(nameInput).toHaveAttribute('aria-invalid', 'false');
    expect(nameInput).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: /Submit Address/i });
    fireEvent.submit(submitBtn.closest('form')!);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Guest name is required and must be under 100 characters.');
    expect(alert).toHaveAttribute('id', 'guestName-error');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');

    expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    expect(nameInput).toHaveAttribute('aria-describedby', 'guestName-error');
    expect(document.activeElement).toBe(nameInput);
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

  test('marks only email invalid when API returns field-level email error details', async () => {
    globalFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        success: false,
        error: 'Invalid email address.',
        details: {
          _errors: [],
          email: { _errors: ['Invalid email address.'] },
        },
      }),
    });

    const { container } = render(<GuestAddressCollectPage />);

    const nameInput = screen.getByLabelText(/Full Name/i);
    const emailInput = screen.getByLabelText(/Email Address/i);
    fireEvent.change(nameInput, { target: { value: 'Bob Guest' } });
    fireEvent.change(screen.getByLabelText(/Street Address Line 1/i), { target: { value: '100 Main St' } });
    fireEvent.change(screen.getByLabelText(/City/i), { target: { value: 'Denver' } });
    fireEvent.change(screen.getByLabelText(/State \/ Province/i), { target: { value: 'CO' } });
    fireEvent.change(screen.getByLabelText(/ZIP \/ Postal Code/i), { target: { value: '80202' } });
    fireEvent.change(emailInput, { target: { value: 'bob@example.com' } });

    const submitBtn = screen.getByRole('button', { name: /Submit Address/i });
    fireEvent.submit(submitBtn.closest('form')!);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Invalid email address.');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(container.querySelector('#address-collect-error')).not.toBeInTheDocument();

    expect(emailInput).toHaveAttribute('aria-invalid', 'true');
    expect(emailInput).toHaveAttribute('aria-describedby', alert.id);
    expect(nameInput).toHaveAttribute('aria-invalid', 'false');
    expect(nameInput).not.toHaveAttribute('aria-describedby');

    const axeResults = await axe(container);
    expect(axeResults).toHaveNoViolations();
  });

  test('renders general API error alert without marking guestName invalid', async () => {
    globalFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        success: false,
        error: 'Service temporarily unavailable. Please try again.',
      }),
    });

    render(<GuestAddressCollectPage />);

    const nameInput = screen.getByLabelText(/Full Name/i);
    const emailInput = screen.getByLabelText(/Email Address/i);
    fireEvent.change(nameInput, { target: { value: 'Bob Guest' } });
    fireEvent.change(screen.getByLabelText(/Street Address Line 1/i), { target: { value: '100 Main St' } });
    fireEvent.change(screen.getByLabelText(/City/i), { target: { value: 'Denver' } });
    fireEvent.change(screen.getByLabelText(/State \/ Province/i), { target: { value: 'CO' } });
    fireEvent.change(screen.getByLabelText(/ZIP \/ Postal Code/i), { target: { value: '80202' } });

    const submitBtn = screen.getByRole('button', { name: /Submit Address/i });
    fireEvent.submit(submitBtn.closest('form')!);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Service temporarily unavailable. Please try again.');
    expect(alert).toHaveAttribute('id', 'address-collect-error');
    expect(nameInput).toHaveAttribute('aria-invalid', 'false');
    expect(nameInput).not.toHaveAttribute('aria-describedby');
    expect(emailInput).toHaveAttribute('aria-invalid', 'false');
  });

  test('clears error alert and resets input aria attributes when editing after an error', async () => {
    render(<GuestAddressCollectPage />);

    const nameInput = screen.getByLabelText(/Full Name/i);
    fireEvent.change(screen.getByLabelText(/Street Address Line 1/i), { target: { value: '100 Main St' } });
    fireEvent.change(screen.getByLabelText(/City/i), { target: { value: 'Denver' } });
    fireEvent.change(screen.getByLabelText(/State \/ Province/i), { target: { value: 'CO' } });
    fireEvent.change(screen.getByLabelText(/ZIP \/ Postal Code/i), { target: { value: '80202' } });

    const submitBtn = screen.getByRole('button', { name: /Submit Address/i });
    fireEvent.submit(submitBtn.closest('form')!);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    expect(nameInput).toHaveAttribute('aria-describedby', 'guestName-error');

    fireEvent.change(nameInput, { target: { value: 'Alice' } });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(nameInput).toHaveAttribute('aria-invalid', 'false');
    expect(nameInput).not.toHaveAttribute('aria-describedby');
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
    fireEvent.change(screen.getByLabelText(/Street Address Line 1/i), { target: { value: '100 Main St' } });
    fireEvent.change(screen.getByLabelText(/City/i), { target: { value: 'Denver' } });
    fireEvent.change(screen.getByLabelText(/State \/ Province/i), { target: { value: 'CO' } });
    fireEvent.change(screen.getByLabelText(/ZIP \/ Postal Code/i), { target: { value: '80202' } });
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

  test('renders container and card with semantic theme utility classes and without nested main', async () => {
    const { container } = render(<GuestAddressCollectPage />);

    expect(container.querySelector('main')).toBeNull();
    const rootContainer = container.firstElementChild as HTMLElement;
    expect(rootContainer).toHaveClass('bg-container');
    expect(rootContainer.className).not.toContain('bg-gray-50');

    const cardElement = screen.getByText('Mailing Address Form').closest('div.rounded-2xl');
    expect(cardElement).toHaveClass('bg-card');
    expect(cardElement).toHaveClass('border-card-border');
    expect(cardElement?.className).not.toContain('bg-white');
    expect(cardElement?.className).not.toContain('border-gray-100');

    const heading = screen.getByText('Mailing Address Form');
    expect(heading).toHaveClass('text-heading');
  });

  test('renders inline Need Help? trigger that opens contextual help dialog and restores focus on Escape', async () => {
    render(<GuestAddressCollectPage />);

    const helpTrigger = screen.getByRole('button', { name: /Need Help\?/i });
    helpTrigger.focus();
    fireEvent.click(helpTrigger);

    const dialog = screen.getByRole('dialog', { name: /Guest Help & Support/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText(/Physical envelopes & paper mailers/i)).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(helpTrigger);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  test('marks street, city, state, and postal code inputs required and surfaces field validation messages on client and HTTP 400', async () => {
    globalFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        success: false,
        error: 'Street address is required',
        details: {
          _errors: [],
          addressLine1: { _errors: ['Street address could not be verified'] },
          city: { _errors: ['City could not be verified'] },
          state: { _errors: ['State or province is invalid'] },
          zipCode: { _errors: ['ZIP or postal code is invalid'] },
        },
      }),
    });

    render(<GuestAddressCollectPage />);

    const streetInput = screen.getByLabelText(/Street Address Line 1/i);
    const cityInput = screen.getByLabelText(/City/i);
    const stateInput = screen.getByLabelText(/State \/ Province/i);
    const zipInput = screen.getByLabelText(/ZIP \/ Postal Code/i);

    expect(streetInput).toBeRequired();
    expect(cityInput).toBeRequired();
    expect(stateInput).toBeRequired();
    expect(zipInput).toBeRequired();

    fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: 'Postal Missing Guest' } });
    fireEvent.submit(screen.getByRole('button', { name: /Submit Address/i }).closest('form')!);

    expect(await screen.findByText('Street address is required.')).toBeInTheDocument();
    expect(screen.getByText('City is required.')).toBeInTheDocument();
    expect(screen.getByText('State / Province is required.')).toBeInTheDocument();
    expect(screen.getByText('ZIP / Postal code is required.')).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(streetInput).toHaveAttribute('aria-invalid', 'true');
    expect(cityInput).toHaveAttribute('aria-invalid', 'true');
    expect(stateInput).toHaveAttribute('aria-invalid', 'true');
    expect(zipInput).toHaveAttribute('aria-invalid', 'true');
    expect(document.activeElement).toBe(streetInput);
    expect(globalFetch).not.toHaveBeenCalled();

    fireEvent.change(streetInput, { target: { value: '123 Main St' } });
    fireEvent.change(cityInput, { target: { value: 'Denver' } });
    fireEvent.change(stateInput, { target: { value: 'CO' } });
    fireEvent.change(zipInput, { target: { value: '80202' } });
    fireEvent.submit(screen.getByRole('button', { name: /Submit Address/i }).closest('form')!);

    expect(await screen.findByText('Street address could not be verified')).toBeInTheDocument();
    expect(screen.getByText('City could not be verified')).toBeInTheDocument();
    expect(screen.getByText('State or province is invalid')).toBeInTheDocument();
    expect(screen.getByText('ZIP or postal code is invalid')).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  test('hides all five required asterisks with aria-hidden="true", deduplicates empty-submit errors to a single role="alert" without duplicate IDs, locks busy controls without dropping focus, and preserves #website honeypot', async () => {
    const submitDeferred: { resolve?: (val: unknown) => void } = {};
    globalFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          submitDeferred.resolve = resolve;
        })
    );

    const { container } = render(<GuestAddressCollectPage />);

    const nameInput = screen.getByLabelText(/Full Name/i);
    const streetInput = screen.getByLabelText(/Street Address Line 1/i);
    const cityInput = screen.getByLabelText(/City/i);
    const stateInput = screen.getByLabelText(/State \/ Province/i);
    const zipInput = screen.getByLabelText(/ZIP \/ Postal Code/i);

    for (const requiredInput of [nameInput, streetInput, cityInput, stateInput, zipInput]) {
      expect(requiredInput).toBeRequired();
      expect(requiredInput).toHaveAttribute('aria-required', 'true');
    }

    const asterisks = Array.from(container.querySelectorAll('label span')).filter(
      (el) => el.textContent?.trim() === '*'
    );
    expect(asterisks).toHaveLength(5);
    asterisks.forEach((span) => {
      expect(span).toHaveAttribute('aria-hidden', 'true');
    });

    // Empty submission flags all 5 fields with unique IDs, focuses Full Name, and mounts only 1 alert
    const submitBtn = screen.getByRole('button', { name: /Submit Address/i });
    submitBtn.focus();
    fireEvent.submit(submitBtn.closest('form')!);

    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveAttribute('id', 'address-collect-error');
    expect(container.querySelectorAll('#address-collect-error')).toHaveLength(1);

    expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    expect(nameInput).toHaveAttribute('aria-describedby', 'guestName-error');
    expect(streetInput).toHaveAttribute('aria-describedby', 'addressLine1-error');
    expect(cityInput).toHaveAttribute('aria-describedby', 'city-error');
    expect(stateInput).toHaveAttribute('aria-describedby', 'state-error');
    expect(zipInput).toHaveAttribute('aria-describedby', 'zipCode-error');
    expect(document.activeElement).toBe(nameInput);
    expect(await axe(container)).toHaveNoViolations();

    // Fill valid address and verify busy lock keeps focus on submit button and ignores duplicate submit
    fireEvent.change(nameInput, { target: { value: 'Jane Doe' } });
    fireEvent.change(streetInput, { target: { value: '100 Main St' } });
    fireEvent.change(cityInput, { target: { value: 'Denver' } });
    fireEvent.change(stateInput, { target: { value: 'CO' } });
    fireEvent.change(zipInput, { target: { value: '80202' } });

    submitBtn.focus();
    fireEvent.submit(submitBtn.closest('form')!);

    const busyBtn = screen.getByRole('button', { name: /Submitting Address/i });
    expect(document.activeElement).toBe(busyBtn);
    expect(busyBtn).not.toBeDisabled();
    expect(busyBtn).toHaveAttribute('aria-busy', 'true');
    expect(busyBtn).toHaveAttribute('aria-disabled', 'true');
    expect(nameInput).toHaveAttribute('readonly');
    expect(nameInput).toHaveAttribute('aria-busy', 'true');

    await waitFor(() => {
      expect(globalFetch).toHaveBeenCalledTimes(1);
    });

    // Duplicate submit while busy is ignored
    fireEvent.submit(busyBtn.closest('form')!);
    expect(globalFetch).toHaveBeenCalledTimes(1);

    submitDeferred.resolve?.({
      ok: true,
      json: async () => ({
        success: true,
        message: 'Address submitted successfully.',
      }),
    });

    expect(await screen.findByText('Address Received!')).toBeInTheDocument();
    const submittedHelpTrigger = screen.getByRole('button', { name: /Need Help\?/i });
    const submitAnotherBtn = screen.getByRole('button', { name: /Submit Another Address/i });
    expect(
      submittedHelpTrigger.compareDocumentPosition(submitAnotherBtn) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    // Reset and verify #website honeypot bypasses client error hints so server honeypot handles bots
    fireEvent.click(submitAnotherBtn);
    const formHelpTrigger = screen.getByRole('button', { name: /Need Help\?/i });
    const resetNameInput = screen.getByLabelText(/Full Name/i);
    expect(
      formHelpTrigger.compareDocumentPosition(resetNameInput) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    globalFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'Address submitted successfully.' }),
    });
    const honeypot = container.querySelector('#website') as HTMLInputElement;
    expect(honeypot).toBeInTheDocument();
    fireEvent.change(honeypot, { target: { value: 'https://spam.example' } });
    fireEvent.submit(screen.getByRole('button', { name: /Submit Address/i }).closest('form')!);
    await waitFor(() => {
      expect(globalFetch).toHaveBeenCalledTimes(2);
    });
  });
});
