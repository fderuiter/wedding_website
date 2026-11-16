import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Overlay } from '@/components/ui/Overlay';
import RegistryItemCard from '../RegistryItemCard';
import type { RegistryItem } from '@/features/registry';

const mockConfirmPayment = jest.fn();

jest.mock('@stripe/react-stripe-js', () => {
  const React = require('react');
  return {
    Elements: ({ children }: any) => React.createElement('div', { 'data-testid': 'stripe-elements-container' }, children),
    PaymentElement: (props: any) =>
      React.createElement(
        'div',
        { 'data-testid': 'stripe-payment-element', ...props },
        React.createElement('div', { 'data-testid': 'embedded-stripe-elements' }, 'Stripe Payment Element (Cards, Apple Pay, Google Pay)')
      ),
    CardElement: (props: any) => React.createElement('div', { 'data-testid': 'stripe-card-element', ...props }),
    useStripe: () => ({
      confirmPayment: mockConfirmPayment,
    }),
    useElements: () => ({
      submit: jest.fn().mockResolvedValue({}),
      getElement: jest.fn(),
    }),
  };
});

const mockCashFundItem: RegistryItem = {
  id: 'fund-paris',
  name: 'Paris Honeymoon Dining',
  description: 'Romantic dinners along the Seine',
  price: 500,
  image: '/images/honeymoon.jpg',
  vendorUrl: null,
  quantity: 1,
  category: 'Cash Fund',
  itemType: 'CASH_FUND',
  isGroupGift: true,
  purchased: false,
  amountContributed: 100,
  contributors: [],
};

const mockPhysicalItem: RegistryItem = {
  id: 'phys-toaster',
  name: 'Artisan 4-Slice Toaster',
  description: 'Stainless steel toaster',
  price: 80,
  image: '/images/toaster.jpg',
  vendorUrl: 'https://store.example.com/toaster',
  quantity: 1,
  category: 'Kitchen',
  itemType: 'PHYSICAL',
  isGroupGift: false,
  purchased: false,
  amountContributed: 0,
  contributors: [],
};

const mockOnClose = jest.fn();
const mockOnContribute = jest.fn().mockResolvedValue(undefined);

describe('Stripe Elements Embedded Checkout Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Criterion 1: displays embedded Stripe Elements when guest initiates a contribution', () => {
    render(
      <Overlay isOpen={true} onClose={mockOnClose}>
        <RegistryItemCard
          item={mockCashFundItem}
          onClose={mockOnClose}
          onContribute={mockOnContribute}
        />
      </Overlay>
    );

    // Verify Cash Fund title and details
    expect(screen.getByText('Paris Honeymoon Dining')).toBeInTheDocument();

    // Verify embedded Stripe Elements container & payment element are present
    expect(screen.getByTestId('stripe-elements-container')).toBeInTheDocument();
    expect(screen.getByTestId('stripe-payment-element')).toBeInTheDocument();
    expect(screen.getByText(/Cards, Apple Pay, Google Pay/i)).toBeInTheDocument();

    // Verify Standard Processing Fee notice is displayed with 2.5% rate
    expect(screen.getByText(/Payment Processing Fee Notice/i)).toBeInTheDocument();
    expect(screen.getByText(/Standard Fee:\s*2\.5%/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Cover transaction processing fee/i)).toBeInTheDocument();
  });

  it('Requirement 3 & Constraint: updates fee calculation when guest toggles coverFee checkbox', () => {
    render(
      <Overlay isOpen={true} onClose={mockOnClose}>
        <RegistryItemCard
          item={mockCashFundItem}
          onClose={mockOnClose}
          onContribute={mockOnContribute}
        />
      </Overlay>
    );

    const amountInput = screen.getByLabelText(/Contribution Amount/i);
    fireEvent.change(amountInput, { target: { value: '100' } });

    const coverFeeCheckbox = screen.getByLabelText(/Cover transaction processing fee/i);
    expect(coverFeeCheckbox).not.toBeChecked();

    // Initially when coverFee is unchecked, base is $100 and net payout received by couple is $97.50
    expect(screen.getByText(/Base Contribution Amount:/i)).toBeInTheDocument();
    expect(screen.getByText('$97.50')).toBeInTheDocument();

    // Toggle coverFee to true
    fireEvent.click(coverFeeCheckbox);
    expect(coverFeeCheckbox).toBeChecked();

    // Dynamic fee update: total amount charged is $102.50 ($2.50 fee), couple receives full $100.00
    expect(screen.getByText(/Covered Card Processing Fee \(2\.5%\):/i)).toBeInTheDocument();
    expect(screen.getByText('$102.50')).toBeInTheDocument();
    expect(screen.getByText(/Net Payout Received by Couple:/i)).toBeInTheDocument();
  });

  it('Criterion 3: rejects payment submissions with invalid card numbers and displays actionable error message without closing modal or losing input', async () => {
    mockConfirmPayment.mockResolvedValueOnce({
      error: {
        type: 'card_error',
        message: 'Your card was declined. Please check your card number or expiration date and try again.',
      },
    });

    render(
      <Overlay isOpen={true} onClose={mockOnClose}>
        <RegistryItemCard
          item={mockCashFundItem}
          onClose={mockOnClose}
          onContribute={mockOnContribute}
        />
      </Overlay>
    );

    const nameInput = screen.getByLabelText(/Your Name/i);
    const emailInput = screen.getByLabelText(/Email Address/i);
    const messageInput = screen.getByLabelText(/Personal Message/i);
    const amountInput = screen.getByLabelText(/Contribution Amount/i);

    fireEvent.change(nameInput, { target: { value: 'Jordan Guest' } });
    fireEvent.change(emailInput, { target: { value: 'jordan@example.com' } });
    fireEvent.change(messageInput, { target: { value: 'Congratulations!' } });
    fireEvent.change(amountInput, { target: { value: '75' } });

    const submitButton = screen.getByRole('button', { name: 'Submit Contribution' });
    fireEvent.click(submitButton);

    // Wait for card decline error to appear in the actionable alert box
    await waitFor(() => {
      expect(
        screen.getByText('Your card was declined. Please check your card number or expiration date and try again.')
      ).toBeInTheDocument();
    });

    // Ensure modal was NOT closed
    expect(mockOnClose).not.toHaveBeenCalled();

    // Ensure guest inputs were NOT lost or wiped
    expect(nameInput).toHaveValue('Jordan Guest');
    expect(emailInput).toHaveValue('jordan@example.com');
    expect(messageInput).toHaveValue('Congratulations!');
    expect(amountInput).toHaveValue(75);
  });

  it('Criterion 5: authorizes payment and displays verified transaction reference on success confirmation screen', async () => {
    mockConfirmPayment.mockResolvedValueOnce({
      paymentIntent: {
        id: 'pi_verified_test_789',
        status: 'succeeded',
      },
    });

    render(
      <Overlay isOpen={true} onClose={mockOnClose}>
        <RegistryItemCard
          item={mockCashFundItem}
          onClose={mockOnClose}
          onContribute={mockOnContribute}
        />
      </Overlay>
    );

    fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Jane Donor' } });
    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'jane@example.com' } });
    fireEvent.change(screen.getByLabelText(/Contribution Amount/i), { target: { value: '50' } });

    const submitButton = screen.getByRole('button', { name: 'Submit Contribution' });
    fireEvent.click(submitButton);

    // Wait for confirmation phase screen to show
    await waitFor(() => {
      expect(screen.getByText('Contribution Confirmed!')).toBeInTheDocument();
    });

    // Check that verified transaction reference is displayed
    expect(screen.getByText(/Transaction Reference:/i)).toBeInTheDocument();
    expect(screen.getByText('pi_verified_test_789')).toBeInTheDocument();

    // Clicking "Done" should close the modal
    const doneButton = screen.getByRole('button', { name: 'Done' });
    fireEvent.click(doneButton);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('Constraint: physical registry gifts purchased off-site remain claimable manually without Stripe Elements', () => {
    render(
      <Overlay isOpen={true} onClose={mockOnClose}>
        <RegistryItemCard
          item={mockPhysicalItem}
          onClose={mockOnClose}
          onContribute={mockOnContribute}
        />
      </Overlay>
    );

    // Physical item vendor link is present
    expect(screen.getByRole('link', { name: /View on Vendor Site/i })).toBeInTheDocument();

    // Standard Claim Gift button is present
    expect(screen.getByRole('button', { name: 'Claim Gift' })).toBeInTheDocument();

    // Stripe Elements should NOT be rendered for manual claim of physical gift
    expect(screen.queryByTestId('stripe-payment-element')).not.toBeInTheDocument();
  });
});
