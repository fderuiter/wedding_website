import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Overlay } from '@/components/ui/Overlay';
import RegistryItemCard from '../RegistryItemCard';
import RegistryItemForm from '../RegistryItemForm';
import type { RegistryItem } from '@/features/registry';
import { apiClient } from '@/lib/apiClient';
import { getStripePromise } from '@/lib/stripe';

const mockConfirmPayment = jest.fn();
const mockElementsSubmit = jest.fn().mockResolvedValue({});

jest.mock('@stripe/react-stripe-js', () => {
  const ReactActual = require('react');
  return {
    Elements: ({ children }: { children: React.ReactNode }) =>
      ReactActual.createElement('div', { 'data-testid': 'stripe-elements-container' }, children),
    PaymentElement: (props: Record<string, unknown>) =>
      ReactActual.createElement(
        'div',
        { 'data-testid': 'stripe-payment-element', ...props },
        'Stripe Payment Element'
      ),
    useStripe: () => ({
      confirmPayment: mockConfirmPayment,
    }),
    useElements: () => ({
      submit: mockElementsSubmit,
      getElement: jest.fn(),
    }),
  };
});

jest.mock('@/lib/stripe', () => {
  const actual = jest.requireActual('@/lib/stripe');
  return {
    ...actual,
    getStripePromise: jest.fn(() => Promise.resolve({ mockStripeClient: true })),
  };
});

describe('Capability-Aware Dual-Mode Fund Checkout UI', () => {
  const hybridFundItem: RegistryItem = {
    id: 'fund-hybrid-1',
    name: 'Amalfi Coast Honeymoon Fund',
    description: 'Help us celebrate along the Italian coast.',
    price: 1000,
    amountContributed: 200,
    purchased: false,
    isGroupGift: true,
    itemType: 'CASH_FUND',
    category: 'Honeymoon',
    paymentHandleType: 'Venmo',
    paymentHandle: '@couple-honeymoon',
    contributors: [],
  };

  const unconfiguredFundItem: RegistryItem = {
    id: 'fund-unconfigured-1',
    name: 'Future Home Down Payment',
    description: 'Saving for our first home together.',
    price: 2000,
    amountContributed: 0,
    purchased: false,
    isGroupGift: true,
    itemType: 'CASH_FUND',
    category: 'Cash Fund',
    paymentHandleType: undefined,
    paymentHandle: undefined,
    contributors: [],
  };

  const mockOnClose = jest.fn();
  const mockOnContribute = jest.fn().mockResolvedValue(undefined);
  let postSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    postSpy = jest.spyOn(apiClient, 'post').mockResolvedValue({
      clientSecret: 'pi_real_123_secret_abc',
      paymentIntentId: 'pi_real_123',
      amount: 100,
      feeAmount: 0,
    });
  });

  afterEach(() => {
    postSpy.mockRestore();
  });

  it('Acceptance Criterion 2: opening a fund with a transfer handle without Stripe keys triggers zero requests to card endpoints', async () => {
    render(
      <Overlay isOpen={true} onClose={mockOnClose}>
        <RegistryItemCard
          item={hybridFundItem}
          onClose={mockOnClose}
          onContribute={mockOnContribute}
          cardCheckoutEnabled={false}
          stripePublishableKey={null}
        />
      </Overlay>
    );

    // Direct transfer details (handle, link, QR code) are visible
    expect(screen.getByText('@couple-honeymoon')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open payment link for Venmo/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/QR code to pay via Venmo/i)).toBeInTheDocument();

    // No mode selector, no Stripe payment notice, and no card inputs
    expect(screen.queryByTestId('payment-mode-selector')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stripe-payment-notice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stripe-elements-container')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stripe-payment-element')).not.toBeInTheDocument();

    // Wait past the 250ms PaymentIntent debounce window to confirm zero card endpoint calls
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(postSpy).not.toHaveBeenCalledWith('/api/registry/payment-intent', expect.anything());
    expect(getStripePromise).not.toHaveBeenCalled();
  });

  it('Acceptance Criterion 3 & 5: records a direct transfer with name, amount, and note without card details and shows self-reported confirmation', async () => {
    render(
      <Overlay isOpen={true} onClose={mockOnClose}>
        <RegistryItemCard
          item={hybridFundItem}
          onClose={mockOnClose}
          onContribute={mockOnContribute}
          cardCheckoutEnabled={false}
          stripePublishableKey={null}
        />
      </Overlay>
    );

    fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Morgan Guest' } });
    fireEvent.change(screen.getByLabelText(/Contribution Amount/i), { target: { value: '125' } });
    fireEvent.change(screen.getByLabelText(/Personal Message/i), {
      target: { value: 'Enjoy gelato in Positano!' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Record Direct Transfer' }));

    await waitFor(() => {
      expect(mockOnContribute).toHaveBeenCalledWith(
        'fund-hybrid-1',
        'Morgan Guest',
        125,
        undefined,
        'Enjoy gelato in Positano!'
      );
    });

    // Zero calls to Stripe confirmPayment or payment-intent endpoint
    expect(mockConfirmPayment).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalledWith('/api/registry/payment-intent', expect.anything());

    // Self-reported direct transfer confirmation message (distinct from card confirmation)
    expect(await screen.findByText('Direct Transfer Recorded!')).toBeInTheDocument();
    expect(screen.getByText(/self-reported direct transfer/i)).toBeInTheDocument();
    expect(screen.getByText(/No card was charged on this website/i)).toBeInTheDocument();
    expect(screen.queryByText(/Transaction Reference:/i)).not.toBeInTheDocument();
  });

  it('Requirement 3, 5 & Acceptance Criterion 4, 5: dual-mode fund renders mode selector, applies 2.5% fee breakdown & cover option in Card Checkout mode, and shows confirmed card charge message', async () => {
    mockConfirmPayment.mockResolvedValueOnce({
      paymentIntent: {
        id: 'pi_card_confirmed_555',
        status: 'succeeded',
      },
    });

    const eightArgContribute = jest.fn(
      async (
        _itemId: string,
        _name: string,
        _amount: number,
        _code?: string,
        _message?: string,
        _coverFee?: boolean,
        _email?: string,
        _paymentIntentId?: string
      ) => undefined
    );

    render(
      <Overlay isOpen={true} onClose={mockOnClose}>
        <RegistryItemCard
          item={hybridFundItem}
          onClose={mockOnClose}
          onContribute={eightArgContribute}
          cardCheckoutEnabled={true}
          stripePublishableKey="pk_test_real_publishable_12345"
        />
      </Overlay>
    );

    // Selector displays both modes and defaults to Direct Transfer (0% Fee)
    const directRadio = screen.getByRole('radio', { name: 'Direct Transfer (0% Fee)' });
    const cardRadio = screen.getByRole('radio', { name: 'Card Checkout (2.5% Fee)' });
    expect(directRadio).toHaveAttribute('aria-checked', 'true');
    expect(cardRadio).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Direct Transfer Notice')).toBeInTheDocument();
    expect(screen.queryByTestId('stripe-payment-element')).not.toBeInTheDocument();

    // Enter guest inputs in Direct mode and verify they persist when switching to Card mode
    fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Riley Donor' } });
    fireEvent.change(screen.getByLabelText(/Contribution Amount/i), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText(/Personal Message/i), {
      target: { value: 'Safe travels!' },
    });

    // Switch to Card Checkout (2.5% Fee)
    fireEvent.click(cardRadio);
    expect(cardRadio).toHaveAttribute('aria-checked', 'true');
    expect(directRadio).toHaveAttribute('aria-checked', 'false');

    // Preserved form inputs
    expect(screen.getByLabelText(/Your Name/i)).toHaveValue('Riley Donor');
    expect(screen.getByLabelText(/Contribution Amount/i)).toHaveValue(200);
    expect(screen.getByLabelText(/Personal Message/i)).toHaveValue('Safe travels!');

    // Displays 2.5% fee breakdown, coverFee option, and Stripe PaymentElement even though item has a paymentHandle
    expect(screen.getByText('Payment Processing Fee Notice')).toBeInTheDocument();
    expect(screen.getByText('Standard Fee: 2.5%')).toBeInTheDocument();
    expect(screen.getByText('-$5.00')).toBeInTheDocument();
    expect(screen.getByText('$195.00')).toBeInTheDocument();
    expect(screen.getByTestId('stripe-payment-element')).toBeInTheDocument();

    // Toggle coverFee option -> $200 + $5.00 = $205.00 total charged, $200.00 net payout
    const coverFeeCheckbox = screen.getByLabelText(/Cover transaction processing fee/i);
    fireEvent.click(coverFeeCheckbox);
    expect(coverFeeCheckbox).toBeChecked();
    expect(screen.getByText('+$5.00')).toBeInTheDocument();
    expect(screen.getByText('$205.00')).toBeInTheDocument();

    // Submit Card Checkout
    fireEvent.click(screen.getByRole('button', { name: 'Submit Contribution' }));

    await waitFor(() => {
      expect(eightArgContribute).toHaveBeenCalledWith(
        'fund-hybrid-1',
        'Riley Donor',
        200,
        undefined,
        'Safe travels!',
        true,
        undefined,
        'pi_card_confirmed_555'
      );
    });

    // Confirmed card charge confirmation message (distinct from direct transfer)
    expect(await screen.findByText('Contribution Confirmed!')).toBeInTheDocument();
    expect(screen.getByText(/card payment/i)).toBeInTheDocument();
    expect(screen.getByText(/securely processed/i)).toBeInTheDocument();
    expect(screen.getByText('pi_card_confirmed_555')).toBeInTheDocument();
  });

  it('Requirement 6: disables checkout with guest notice and surfaces administrator warnings when a fund has neither card credentials nor a transfer handle', () => {
    const { rerender } = render(
      <Overlay isOpen={true} onClose={mockOnClose}>
        <RegistryItemCard
          item={unconfiguredFundItem}
          onClose={mockOnClose}
          onContribute={mockOnContribute}
          cardCheckoutEnabled={false}
          stripePublishableKey={null}
          isAdmin={false}
        />
      </Overlay>
    );

    // Guest sees clean unavailable notice instead of broken card form
    expect(screen.getByTestId('fund-checkout-unavailable')).toBeInTheDocument();
    expect(screen.getByText('Online Checkout Unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Checkout Disabled' })).toBeDisabled();
    expect(screen.queryByTestId('stripe-payment-element')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Your Name/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-fund-config-warning')).not.toBeInTheDocument();

    // Admin sees explicit configuration warning in modal
    rerender(
      <Overlay isOpen={true} onClose={mockOnClose}>
        <RegistryItemCard
          item={unconfiguredFundItem}
          onClose={mockOnClose}
          onContribute={mockOnContribute}
          cardCheckoutEnabled={false}
          stripePublishableKey={null}
          isAdmin={true}
        />
      </Overlay>
    );

    expect(screen.getByTestId('admin-fund-config-warning')).toBeInTheDocument();
    expect(screen.getByText(/Administrator Warning: Checkout Disabled/i)).toBeInTheDocument();
  });

  it('Requirement 6: warns administrators in RegistryItemForm when creating/editing a fund without a handle while card checkout is disabled', () => {
    render(
      <RegistryItemForm
        mode="edit"
        initialValues={unconfiguredFundItem}
        onSubmit={jest.fn()}
        cardCheckoutEnabled={false}
      />
    );

    expect(screen.getByTestId('unconfigured-fund-form-warning')).toBeInTheDocument();
    expect(screen.getByText(/Guest Checkout Will Be Disabled/i)).toBeInTheDocument();
  });

  it('Constraint 1: never synthesizes pi_mock_secret_* or calls confirmPayment when payment-intent fails in non-test runtime', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    postSpy.mockRejectedValue(new Error('Card checkout is not configured on this deployment.'));

    try {
      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard
            item={unconfiguredFundItem}
            onClose={mockOnClose}
            onContribute={mockOnContribute}
            cardCheckoutEnabled={true}
            stripePublishableKey="pk_live_real_publishable_12345"
          />
        </Overlay>
      );

      fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Prod Guest' } });
      fireEvent.change(screen.getByLabelText(/Contribution Amount/i), { target: { value: '50' } });

      fireEvent.click(screen.getByRole('button', { name: 'Submit Contribution' }));

      await waitFor(() => {
        expect(
          screen.getByText('Card checkout is not configured on this deployment.')
        ).toBeInTheDocument();
      });

      expect(mockConfirmPayment).not.toHaveBeenCalled();
      expect(mockOnContribute).not.toHaveBeenCalled();
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
    }
  });
});
