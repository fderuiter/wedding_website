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
    expect(nameInput).toHaveAttribute('aria-invalid', 'false');
    expect(nameInput).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: /Submit Address/i });
    fireEvent.submit(submitBtn.closest('form')!);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Please enter your full name.');
    expect(alert).toHaveAttribute('id', 'address-collect-error');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');

    expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    expect(nameInput).toHaveAttribute('aria-describedby', 'address-collect-error');
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
    fireEvent.change(emailInput, { target: { value: 'invalid-email' } });

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
    const submitBtn = screen.getByRole('button', { name: /Submit Address/i });
    fireEvent.submit(submitBtn.closest('form')!);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    expect(nameInput).toHaveAttribute('aria-describedby', 'address-collect-error');

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

  test('marks street, city, state, and postal code inputs required and surfaces field validation messages on HTTP 400', async () => {
    globalFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        success: false,
        error: 'Street address is required',
        details: {
          _errors: [],
          addressLine1: { _errors: ['Street address is required'] },
          city: { _errors: ['City is required'] },
          state: { _errors: ['State or province is required'] },
          zipCode: { _errors: ['ZIP or postal code is required'] },
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

    expect(await screen.findByText('Street address is required')).toBeInTheDocument();
    expect(screen.getByText('City is required')).toBeInTheDocument();
    expect(screen.getByText('State or province is required')).toBeInTheDocument();
    expect(screen.getByText('ZIP or postal code is required')).toBeInTheDocument();
    expect(streetInput).toHaveAttribute('aria-invalid', 'true');
    expect(cityInput).toHaveAttribute('aria-invalid', 'true');
    expect(stateInput).toHaveAttribute('aria-invalid', 'true');
    expect(zipInput).toHaveAttribute('aria-invalid', 'true');
  });
});
