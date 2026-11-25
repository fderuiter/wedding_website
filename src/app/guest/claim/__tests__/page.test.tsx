import { render, screen, fireEvent } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import GuestClaimPage from '../page';

expect.extend(toHaveNoViolations);

let mockSearchToken: string | null = 'signed-confirm-token-123';

jest.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === 'token' ? mockSearchToken : null),
  }),
}));

describe('GuestClaimPage (/guest/claim)', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    mockSearchToken = 'signed-confirm-token-123';
    mockFetch.mockReset();
    (global.fetch as unknown) = mockFetch as unknown as typeof fetch;
    (window.fetch as unknown) = mockFetch as unknown as typeof fetch;
  });

  it('loads gift preview via GET without mutating state, confirms only on explicit form submit, and passes axe', async () => {
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url.startsWith('/api/registry/claim?token=') && (!options?.method || options.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            success: true,
            data: {
              action: 'confirm',
              status: 'RESERVED',
              amount: 125,
              itemId: 'item-1',
              itemName: 'Kyoto Ryokan Fund',
              itemType: 'CASH_FUND',
              isGroupGift: true,
              vendorUrl: null,
              paymentHandle: '@alex-taylor',
              paymentHandleType: 'Venmo',
            },
          }),
        });
      }
      if (url === '/api/registry/claim' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            success: true,
            data: {
              action: 'confirm',
              status: 'CONFIRMED',
              changed: true,
            },
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    const { container } = render(<GuestClaimPage />);

    expect(await screen.findByRole('heading', { name: 'Confirm Your Wedding Gift' })).toBeInTheDocument();
    expect(screen.getByText('Kyoto Ryokan Fund')).toBeInTheDocument();
    expect(screen.getByText('$125.00')).toBeInTheDocument();
    expect(screen.getByText('Reserved')).toBeInTheDocument();

    // Ensure GET alone did NOT trigger any POST mutation
    expect(
      mockFetch.mock.calls.some(([, opts]) => (opts as RequestInit | undefined)?.method === 'POST')
    ).toBe(false);

    const a11yBefore = await axe(container);
    expect(a11yBefore).toHaveNoViolations();

    // Explicit form submission mutates RESERVED -> CONFIRMED
    fireEvent.click(screen.getByTestId('guest-claim-submit-button'));

    expect(await screen.findByRole('heading', { name: 'Gift Confirmed!' })).toBeInTheDocument();
    expect(screen.getByTestId('guest-claim-completed')).toHaveTextContent('Confirmed');

    const postCalls = mockFetch.mock.calls.filter(
      ([, opts]) => (opts as RequestInit | undefined)?.method === 'POST'
    );
    expect(postCalls).toHaveLength(1);

    const a11yAfter = await axe(container);
    expect(a11yAfter).toHaveNoViolations();
  });

  it('supports explicit reservation cancellation via signed cancel link', async () => {
    mockSearchToken = 'signed-cancel-token-456';
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url.startsWith('/api/registry/claim?token=') && (!options?.method || options.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            success: true,
            data: {
              action: 'cancel',
              status: 'RESERVED',
              amount: 80,
              itemId: 'item-2',
              itemName: 'French Press',
              itemType: 'PHYSICAL',
              isGroupGift: false,
              vendorUrl: 'https://vendor.example.com/press',
              paymentHandle: null,
              paymentHandleType: null,
            },
          }),
        });
      }
      if (url === '/api/registry/claim' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            success: true,
            data: {
              action: 'cancel',
              status: 'CANCELLED',
              changed: true,
            },
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    render(<GuestClaimPage />);

    expect(await screen.findByRole('heading', { name: 'Release Gift Reservation' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Cancellation' }));

    expect(await screen.findByRole('heading', { name: 'Reservation Released' })).toBeInTheDocument();
    expect(screen.getByTestId('guest-claim-completed')).toHaveTextContent('cancelled');
  });

  it('displays an accessible error banner when token is missing or expired', async () => {
    mockSearchToken = null;
    const { container } = render(<GuestClaimPage />);

    expect(await screen.findByTestId('guest-claim-error')).toHaveTextContent(
      /Missing gift verification link/i
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('displays vendorUrl, copies shippingAddress, and submits optional order tracking details on physical gift confirmation', async () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
    });

    mockSearchToken = 'signed-physical-confirm-789';
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url.startsWith('/api/registry/claim?token=') && (!options?.method || options.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            success: true,
            data: {
              action: 'confirm',
              status: 'RESERVED',
              amount: 220,
              itemId: 'item-phys-9',
              itemName: 'Enameled Cast Iron Dutch Oven',
              itemType: 'PHYSICAL',
              isGroupGift: false,
              vendorUrl: 'https://retailer.example.com/dutch-oven',
              shippingAddress: {
                recipientName: 'Alex & Taylor',
                addressLine1: '742 Evergreen Terrace',
                addressLine2: 'Apt 4B',
                city: 'Portland',
                state: 'OR',
                zip: '97205',
                country: 'United States',
                phone: '(555) 234-5678',
                deliveryNotes: 'Leave on covered porch',
              },
              paymentHandle: null,
              paymentHandleType: null,
            },
          }),
        });
      }
      if (url === '/api/registry/claim' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            success: true,
            data: {
              action: 'confirm',
              status: 'CONFIRMED',
              changed: true,
            },
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    render(<GuestClaimPage />);

    expect(await screen.findByText('Enameled Cast Iron Dutch Oven')).toBeInTheDocument();
    expect(screen.getByTestId('claim-vendor-link')).toHaveAttribute(
      'href',
      'https://retailer.example.com/dutch-oven'
    );
    expect(screen.getByTestId('claim-shipping-address-card')).toHaveTextContent(
      '742 Evergreen Terrace'
    );

    fireEvent.click(screen.getByTestId('copy-shipping-address-button'));
    expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('742 Evergreen Terrace'));

    fireEvent.change(screen.getByLabelText(/Retailer Order Number/i), {
      target: { value: ' 114-3941689-8772232 ' },
    });
    fireEvent.change(screen.getByLabelText(/Shipping Carrier/i), {
      target: { value: ' UPS ' },
    });
    fireEvent.change(screen.getByLabelText(/Tracking Number/i), {
      target: { value: ' 1Z999AA10123456784 ' },
    });

    fireEvent.click(screen.getByTestId('guest-claim-submit-button'));

    expect(await screen.findByRole('heading', { name: 'Gift Confirmed!' })).toBeInTheDocument();
    const postCall = mockFetch.mock.calls.find(
      ([, opts]) => (opts as RequestInit | undefined)?.method === 'POST'
    );
    expect(postCall).toBeDefined();
    const submittedBody = JSON.parse(String((postCall![1] as RequestInit).body));
    expect(submittedBody).toEqual({
      token: 'signed-physical-confirm-789',
      retailerOrderNumber: '114-3941689-8772232',
      carrier: 'UPS',
      trackingNumber: '1Z999AA10123456784',
    });
  });
});
