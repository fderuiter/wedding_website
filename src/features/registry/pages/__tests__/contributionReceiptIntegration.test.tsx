import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { checkAdminClient } from '@/core/auth/auth.client';
import RegistryPage from '../index';
import { RegistryItem, PaginatedRegistryItems } from '../../types';
import { createMockMedia } from '@/testing/factories/mediaFactory';
import { createMockRegistryItem } from '@/testing/factories/registryFactory';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

jest.mock('@/core/auth/auth.client');
const mockedCheckAdminClient = checkAdminClient as jest.Mock;

const mockConfirmPayment = jest.fn();
const mockElementsSubmit = jest.fn().mockResolvedValue({});

jest.mock('@stripe/react-stripe-js', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const ElementsContext = ReactActual.createContext(false);
  return {
    Elements: ({ children }: { children: React.ReactNode }) =>
      ReactActual.createElement(
        ElementsContext.Provider,
        { value: true },
        ReactActual.createElement('div', { 'data-testid': 'stripe-elements-container' }, children)
      ),
    PaymentElement: (props: Record<string, unknown>) =>
      ReactActual.createElement(
        'div',
        { 'data-testid': 'stripe-payment-element', ...props },
        ReactActual.createElement(
          'div',
          { 'data-testid': 'embedded-stripe-elements' },
          'Stripe Payment Element (Cards, Apple Pay, Google Pay)'
        )
      ),
    CardElement: (props: Record<string, unknown>) =>
      ReactActual.createElement('div', { 'data-testid': 'stripe-card-element', ...props }),
    useStripe: () => {
      const inElements = ReactActual.useContext(ElementsContext);
      if (!inElements) {
        throw new Error('Could not find Elements context; You need to wrap the part of your app that calls useStripe() in an <Elements> provider.');
      }
      return {
        confirmPayment: mockConfirmPayment,
      };
    },
    useElements: () => {
      const inElements = ReactActual.useContext(ElementsContext);
      if (!inElements) {
        throw new Error('Could not find Elements context; You need to wrap the part of your app that calls useElements() in an <Elements> provider.');
      }
      return {
        submit: mockElementsSubmit,
        getElement: jest.fn(),
      };
    },
  };
});

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

const cashFundItem: RegistryItem = createMockRegistryItem({
  id: 'fund-honeymoon',
  name: 'Tokyo Honeymoon Fund',
  description: 'Bullet train and ryokan stay',
  price: 200,
  category: 'Cash Fund',
  itemType: 'CASH_FUND',
  isGroupGift: true,
  isMostWanted: false,
  displayOrder: 0,
  isSample: false,
  purchased: false,
  amountContributed: 150,
  contributors: [],
  image: createMockMedia({
    id: 'img-fund',
    url: '/images/tokyo.jpg',
    altText: 'Tokyo Honeymoon Fund',
    isDecorative: false,
  }),
});

const physicalGiftItem: RegistryItem = createMockRegistryItem({
  id: 'phys-kettle',
  name: 'Pour-Over Electric Kettle',
  description: 'Precision gooseneck kettle',
  price: 120,
  category: 'Kitchen',
  itemType: 'PHYSICAL',
  isGroupGift: false,
  isMostWanted: false,
  displayOrder: 1,
  isSample: false,
  purchased: false,
  amountContributed: 0,
  contributors: [],
  vendorUrl: 'https://store.example.com/kettle',
  image: createMockMedia({
    id: 'img-kettle',
    url: '/images/kettle.jpg',
    altText: 'Pour-Over Electric Kettle',
    isDecorative: false,
  }),
});

function renderWithProviders(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RegistryPage />
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe('RegistryPage end-to-end contribution receipt and cache sync integration', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, '', '/registry');
    mockedCheckAdminClient.mockResolvedValue(false);
    mockElementsSubmit.mockResolvedValue({});
    queryClient = createTestQueryClient();

    const paginatedResponse: PaginatedRegistryItems = {
      items: [
        { ...cashFundItem, contributors: [] },
        { ...physicalGiftItem, contributors: [] },
      ],
      total: 2,
      page: 1,
      limit: 20,
      totalPages: 1,
    };

    server.use(
      http.get('/api/registry/session', () => {
        return HttpResponse.json({ isVerified: false, invitationCode: null, guestName: null });
      }),
      http.get('/api/registry/items', () => {
        return HttpResponse.json(paginatedResponse);
      }),
      http.post('/api/registry/payment-intent', async ({ request }) => {
        const body = (await request.json()) as { amount?: number };
        return HttpResponse.json({
          clientSecret: 'pi_live_test_secret_123',
          paymentIntentId: 'pi_verified_receipt_456',
          amount: body.amount ?? 50,
          feeAmount: 0,
        });
      })
    );
  });

  test('keeps receipt modal open with paymentTransactionId for Stripe fund contribution, updates card to Fully Funded, and closes on Done', async () => {
    let recordedContributeBody: Record<string, unknown> | null = null;

    mockConfirmPayment.mockResolvedValueOnce({
      paymentIntent: {
        id: 'pi_verified_receipt_456',
        status: 'succeeded',
      },
    });

    server.use(
      http.post('/api/registry/contribute', async ({ request }) => {
        recordedContributeBody = (await request.json()) as Record<string, unknown>;
        const updatedFund: RegistryItem = {
          ...cashFundItem,
          amountContributed: 200,
          purchased: true,
          contributors: [
            {
              name: 'Jane Donor',
              amount: 50,
              refundedAmount: 0,
              status: 'CONFIRMED',
              coverFee: false,
              feeAmount: 0,
              date: new Date().toISOString(),
              isPlusOne: false,
              thankYouStatus: 'Unsent',
              thankYouSentAt: null,
              stripePaymentIntentId: 'pi_verified_receipt_456',
              stripeChargeId: 'ch_test_456',
              transactionTimestamp: new Date().toISOString(),
            },
          ],
        };
        return HttpResponse.json(updatedFund);
      })
    );

    renderWithProviders(queryClient);

    // Wait for registry cards to render from PaginatedRegistryItems envelope
    const contributeBtn = await screen.findByRole('button', {
      name: /contribute to tokyo honeymoon fund/i,
    });
    fireEvent.click(contributeBtn);

    expect(window.location.search).toContain('item=fund-honeymoon');

    const dialog = await screen.findByRole('dialog', { name: 'Tokyo Honeymoon Fund' });
    fireEvent.change(within(dialog).getByLabelText(/Your Name/i), {
      target: { value: 'Jane Donor' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Email Address/i), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Contribution Amount/i), {
      target: { value: '50' },
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit Contribution' }));

    // Modal stays open and displays confirmation receipt + Stripe transaction reference
    await waitFor(() => {
      expect(within(dialog).getByTestId('contribution-success-confirmation')).toBeInTheDocument();
    });
    expect(within(dialog).getByText('Contribution Confirmed!')).toBeInTheDocument();
    expect(within(dialog).getByText(/Transaction Reference:/i)).toBeInTheDocument();
    expect(within(dialog).getByText('pi_verified_receipt_456')).toBeInTheDocument();

    // Guest can copy transaction reference and gift summary before closing checkout
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
    });
    const copyBtn = within(dialog).getByRole('button', { name: /Copy Receipt/i });
    fireEvent.click(copyBtn);
    expect(await within(dialog).findByRole('button', { name: /Receipt Copied!/i })).toBeInTheDocument();
    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock.mock.calls[0][0]).toContain('Tokyo Honeymoon Fund');
    expect(writeTextMock.mock.calls[0][0]).toContain('$50.00');
    expect(writeTextMock.mock.calls[0][0]).toContain('Transaction Reference: pi_verified_receipt_456');

    expect(recordedContributeBody).toMatchObject({
      itemId: 'fund-honeymoon',
      purchaserName: 'Jane Donor',
      amount: 50,
      paymentIntentId: 'pi_verified_receipt_456',
    });

    const getRegistryCardArticle = (name: string) => {
      const article = screen
        .getAllByRole('heading', { level: 2, name })
        .map((heading) => heading.closest('article'))
        .find((el): el is HTMLElement => el !== null);
      expect(article).toBeDefined();
      return article!;
    };

    // Background card in the registry grid immediately reflects the updated cache state
    const fundCard = getRegistryCardArticle('Tokyo Honeymoon Fund');
    expect(fundCard).toBeInTheDocument();
    expect(within(fundCard).getByText('Fully Funded')).toBeInTheDocument();

    // Clicking Done closes the modal and clears ?item= from the URL
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(window.location.search).not.toContain('item=fund-honeymoon');
  });

  test('claims physical gift, shows Contribution Confirmed!, marks card Claimed, and closes on Done', async () => {
    server.use(
      http.post('/api/registry/contribute', async () => {
        const updatedGift: RegistryItem = {
          ...physicalGiftItem,
          purchased: true,
          purchaserName: 'A*** G***',
        };
        return HttpResponse.json(updatedGift);
      })
    );

    renderWithProviders(queryClient);

    const contributeBtn = await screen.findByRole('button', {
      name: /contribute to pour-over electric kettle/i,
    });
    fireEvent.click(contributeBtn);

    const dialog = await screen.findByRole('dialog', { name: 'Pour-Over Electric Kettle' });
    fireEvent.change(within(dialog).getByLabelText(/Your Name/i), {
      target: { value: 'Alex Guest' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Claim Gift' }));

    await waitFor(() => {
      expect(within(dialog).getByText('Contribution Confirmed!')).toBeInTheDocument();
    });

    // Underlying RegistryCard is immediately marked Claimed
    const claimedCard = screen
      .getAllByRole('heading', { level: 2, name: 'Pour-Over Electric Kettle' })
      .map((heading) => heading.closest('article'))
      .find((el): el is HTMLElement => el !== null)!;
    expect(claimedCard).toBeInTheDocument();
    expect(within(claimedCard).getByText('Claimed')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  test('rolls back paginated cache and preserves guest inputs when contribution API fails, then succeeds on retry', async () => {
    let attempt = 0;
    server.use(
      http.post('/api/registry/contribute', async () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json({ error: 'Temporary server error' }, { status: 500 });
        }
        return HttpResponse.json({
          ...physicalGiftItem,
          purchased: true,
          purchaserName: 'A*** G***',
        });
      })
    );

    renderWithProviders(queryClient);

    const contributeBtn = await screen.findByRole('button', {
      name: /contribute to pour-over electric kettle/i,
    });
    fireEvent.click(contributeBtn);

    const dialog = await screen.findByRole('dialog', { name: 'Pour-Over Electric Kettle' });
    const nameInput = within(dialog).getByLabelText(/Your Name/i);
    const messageInput = within(dialog).getByLabelText(/Personal Message/i);

    fireEvent.change(nameInput, { target: { value: 'Alex Retry' } });
    fireEvent.change(messageInput, { target: { value: 'Best wishes!' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Claim Gift' }));

    // Error appears, inputs remain intact, and card rolls back to unclaimed
    expect(await within(dialog).findByText('Temporary server error')).toBeInTheDocument();
    expect(nameInput).toHaveValue('Alex Retry');
    expect(messageInput).toHaveValue('Best wishes!');
    const kettleCardBeforeRetry = screen
      .getAllByRole('heading', { level: 2, name: 'Pour-Over Electric Kettle' })
      .map((heading) => heading.closest('article'))
      .find((el): el is HTMLElement => el !== null)!;
    expect(within(kettleCardBeforeRetry).queryByText('Claimed')).not.toBeInTheDocument();

    // Retry succeeds
    fireEvent.click(within(dialog).getByRole('button', { name: 'Claim Gift' }));
    await waitFor(() => {
      expect(within(dialog).getByText('Contribution Confirmed!')).toBeInTheDocument();
    });
    const kettleCardAfterRetry = screen
      .getAllByRole('heading', { level: 2, name: 'Pour-Over Electric Kettle' })
      .map((heading) => heading.closest('article'))
      .find((el): el is HTMLElement => el !== null)!;
    expect(within(kettleCardAfterRetry).getByText('Claimed')).toBeInTheDocument();
  });

  test('resets contribution state when URL popstate switches selectedItem to a different item', async () => {
    server.use(
      http.post('/api/registry/contribute', async () => {
        return HttpResponse.json({
          ...physicalGiftItem,
          purchased: true,
          purchaserName: 'A*** G***',
        });
      })
    );

    renderWithProviders(queryClient);

    const contributeBtn = await screen.findByRole('button', {
      name: /contribute to pour-over electric kettle/i,
    });
    fireEvent.click(contributeBtn);

    const dialog = await screen.findByRole('dialog', { name: 'Pour-Over Electric Kettle' });
    fireEvent.change(within(dialog).getByLabelText(/Your Name/i), {
      target: { value: 'Alex Guest' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Claim Gift' }));

    await waitFor(() => {
      expect(within(dialog).getByText('Contribution Confirmed!')).toBeInTheDocument();
    });

    // Simulate navigating via URL ?item=fund-honeymoon
    act(() => {
      window.history.pushState({}, '', '/registry?item=fund-honeymoon');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    const newDialog = await screen.findByRole('dialog', { name: 'Tokyo Honeymoon Fund' });
    expect(within(newDialog).queryByText('Contribution Confirmed!')).not.toBeInTheDocument();
    expect(within(newDialog).getByRole('button', { name: 'Submit Contribution' })).toBeInTheDocument();
  });
});
