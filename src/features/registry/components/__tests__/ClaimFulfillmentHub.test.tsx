import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { checkAdminClient } from '@/core/auth/auth.client';
import { createMockMedia } from '@/testing/factories/mediaFactory';
import { createMockRegistryItem } from '@/testing/factories/registryFactory';
import { ClaimFulfillmentHub } from '../ClaimFulfillmentHub';
import RegistryItemCard from '../RegistryItemCard';
import RegistryPage from '../../pages/index';
import { GuestSessionProvider } from '../../context/GuestSessionContext';
import { recordStoredSessionClaimHold } from '../../lib/claimHubStorage';
import type { ClaimHubResponse } from '../../types';

expect.extend(toHaveNoViolations);

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

jest.mock('@/core/auth/auth.client');
const mockedCheckAdminClient = checkAdminClient as jest.Mock;

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

const mockMultiHoldResponse: ClaimHubResponse = {
  holds: [
    {
      contributorId: 'hold-espresso',
      status: 'RESERVED',
      amount: 599.95,
      createdAt: '2026-11-20T12:00:00.000Z',
      itemId: 'item-espresso',
      itemName: 'Breville Barista Express Espresso Machine',
      itemDescription: 'Stainless steel espresso maker',
      itemImageUrl: '/images/espresso.jpg',
      itemCategory: 'Kitchen',
      itemType: 'PHYSICAL',
      isGroupGift: false,
      vendorUrl: 'https://www.crateandbarrel.com/espresso',
      paymentHandle: null,
      paymentHandleType: null,
      retailerOrderNumber: null,
      carrier: null,
      trackingNumber: null,
      confirmToken: 'tok-confirm-espresso',
      cancelToken: 'tok-cancel-espresso',
    },
    {
      contributorId: 'hold-duvet',
      status: 'RESERVED',
      amount: 279,
      createdAt: '2026-11-20T12:05:00.000Z',
      itemId: 'item-duvet',
      itemName: 'Brooklinen Luxe Core Sheet Set (King)',
      itemDescription: 'Long-staple cotton sateen',
      itemImageUrl: '/images/sheets.jpg',
      itemCategory: 'Bedroom',
      itemType: 'PHYSICAL',
      isGroupGift: false,
      vendorUrl: 'https://www.brooklinen.com/sheets',
      paymentHandle: null,
      paymentHandleType: null,
      retailerOrderNumber: null,
      carrier: null,
      trackingNumber: null,
      confirmToken: 'tok-confirm-duvet',
      cancelToken: 'tok-cancel-duvet',
    },
  ],
  maxPendingReservations: 5,
  coupleNames: 'Elena & Julian',
  shippingAddress: {
    recipientName: 'Elena Vance & Julian Sterling',
    addressLine1: '742 Evergreen Terrace',
    addressLine2: 'Apt 4B',
    city: 'Seattle',
    state: 'WA',
    zip: '98101',
    country: 'United States',
    phone: '(206) 555-0148',
    deliveryNotes: 'Leave packages with concierge',
  },
  selectedContributorId: 'hold-espresso',
  selectedAction: 'confirm',
};

describe('ClaimFulfillmentHub, Access Tier Gates & Shipping Disclosure UI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
    mockedCheckAdminClient.mockResolvedValue(false);
  });

  it('switches between multiple reserved items in ClaimFulfillmentHub, copies shipping address, confirms tracking details, releases another hold, and passes axe', async () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
    });

    const submittedPayloads: Array<Record<string, unknown>> = [];

    server.use(
      http.get('/api/registry/claim', () =>
        HttpResponse.json({
          success: true,
          data: mockMultiHoldResponse,
        })
      ),
      http.post('/api/registry/claim', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        submittedPayloads.push(body);
        const isCancel = String(body.token).includes('cancel');
        return HttpResponse.json({
          success: true,
          data: {
            action: isCancel ? 'cancel' : 'confirm',
            status: isCancel ? 'CANCELLED' : 'CONFIRMED',
            changed: true,
          },
        });
      })
    );

    const { container } = render(
      <ClaimFulfillmentHub mode="page" initialToken="tok-confirm-espresso" />
    );

    expect(
      await screen.findByTestId('claim-hub-hold-card-hold-espresso')
    ).toBeInTheDocument();
    expect(screen.getByTestId('claim-hub-hold-card-hold-duvet')).toBeInTheDocument();
    expect(screen.getByTestId('claim-hub-hold-count-badge')).toHaveTextContent('2 Items on Hold');

    // Verify shipping card & copy button
    expect(screen.getByTestId('claim-shipping-address-card')).toHaveTextContent(
      '742 Evergreen Terrace'
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('copy-shipping-address-button'));
    });
    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining('742 Evergreen Terrace')
    );

    // Check accessibility on active two-column multi-item workspace
    const a11yResults = await axe(container);
    expect(a11yResults).toHaveNoViolations();

    // Confirm first item with tracking details
    expect(screen.getByTestId('claim-vendor-link')).toHaveAttribute(
      'href',
      'https://www.crateandbarrel.com/espresso'
    );
    fireEvent.change(screen.getByLabelText(/Retailer Order Number/i), {
      target: { value: 'CB-884120' },
    });
    fireEvent.change(screen.getByLabelText(/Shipping Carrier/i), {
      target: { value: 'FedEx' },
    });
    fireEvent.change(screen.getByLabelText(/Tracking Number/i), {
      target: { value: '774819200123' },
    });

    fireEvent.click(screen.getByTestId('guest-claim-submit-button'));

    expect(
      await screen.findByRole('heading', { name: 'Gift Confirmed!' })
    ).toBeInTheDocument();

    expect(submittedPayloads[0]).toEqual({
      token: 'tok-confirm-espresso',
      retailerOrderNumber: 'CB-884120',
      carrier: 'FedEx',
      trackingNumber: '774819200123',
    });

    // Select second reserved item in the left column and release the reservation
    fireEvent.click(screen.getByTestId('claim-hub-hold-card-hold-duvet'));

    await waitFor(() => {
      expect(screen.getByTestId('claim-vendor-link')).toHaveAttribute(
        'href',
        'https://www.brooklinen.com/sheets'
      );
    });

    fireEvent.click(screen.getByTestId('guest-claim-release-button'));

    expect(
      await screen.findByRole('heading', { name: 'Reservation Released' })
    ).toBeInTheDocument();
    expect(submittedPayloads[1]).toEqual({
      token: 'tok-cancel-duvet',
    });
  });

  it('shows INVITED_HOUSEHOLDS guidance, POST_CLAIM_ONLY pre-claim notice + post-claim shipping reveal, and clickable /guest/claim link on 429 hold cap in RegistryItemCard', async () => {
    server.use(
      http.get('/api/rsvp/session', () =>
        HttpResponse.json({
          success: true,
          data: {
            authenticated: false,
            hasPasscodeSession: true,
          },
        })
      )
    );

    const physicalItem = createMockRegistryItem({
      id: 'card-phys-item',
      name: 'Artisan Stand Mixer',
      description: '5-quart tilt-head stand mixer',
      price: 350,
      category: 'Kitchen',
      itemType: 'PHYSICAL',
      isGroupGift: false,
      purchased: false,
      vendorUrl: 'https://retailer.example.com/mixer',
      image: createMockMedia({
        id: 'img-mixer',
        url: '/images/mixer.jpg',
        altText: 'Artisan Stand Mixer',
      }),
    });

    // 1. INVITED_HOUSEHOLDS blocks passcode-only session with clear notice
    const { unmount } = render(
      <GuestSessionProvider>
        <RegistryItemCard
          item={physicalItem}
          onClose={jest.fn()}
          onContribute={jest.fn()}
          giftAccessTier="INVITED_HOUSEHOLDS"
          shippingDisclosureTier="INVITED_HOUSEHOLDS"
          hasShippingAddress={true}
          shippingAddress={null}
        />
      </GuestSessionProvider>
    );

    expect(
      await screen.findByTestId('invited-households-access-notice')
    ).toHaveTextContent(/Household Invitation Code Required/i);
    expect(
      screen.getByTestId('registry-shipping-disclosure-notice')
    ).toHaveTextContent(/Household Verification Required/i);
    unmount();

    // 2. PASSCODE_GUESTS + POST_CLAIM_ONLY shows pre-claim disclosure notice, renders /guest/claim link on 429 error, and reveals shipping card post-claim
    const mockContribute = jest
      .fn()
      .mockRejectedValueOnce(
        new Error(
          'Too many active gift reservations (2 maximum). Please confirm or cancel your existing reservations on /guest/claim first.'
        )
      )
      .mockResolvedValueOnce({
        ...physicalItem,
        purchased: true,
        claimActions: {
          confirmToken: 'tok-post-confirm',
          cancelToken: 'tok-post-cancel',
          shippingAddress: {
            recipientName: 'Alex & Taylor',
            addressLine1: '900 Pine Street',
            addressLine2: '',
            city: 'Portland',
            state: 'OR',
            zip: '97209',
            country: 'United States',
            phone: '',
            deliveryNotes: '',
          },
        },
      });

    render(
      <GuestSessionProvider>
        <RegistryItemCard
          item={physicalItem}
          onClose={jest.fn()}
          onContribute={mockContribute}
          giftAccessTier="PASSCODE_GUESTS"
          shippingDisclosureTier="POST_CLAIM_ONLY"
          hasShippingAddress={true}
          shippingAddress={null}
        />
      </GuestSessionProvider>
    );

    // Pre-claim notice is shown while raw address is hidden
    expect(
      await screen.findByTestId('registry-shipping-disclosure-notice')
    ).toHaveTextContent(/Revealed After Claiming/i);
    expect(screen.queryByTestId('registry-shipping-address-card')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Your Name/i), {
      target: { value: 'Jordan Guest' },
    });
    fireEvent.change(screen.getByLabelText(/Email Address/i), {
      target: { value: 'jordan@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Claim Gift' }));

    const quotaLink = await screen.findByTestId('hold-quota-claim-hub-link');
    expect(quotaLink).toHaveAttribute('href', '/guest/claim');

    // Retry succeeds and reveals post-claim shipping address card
    fireEvent.click(screen.getByRole('button', { name: 'Claim Gift' }));

    expect(
      await screen.findByTestId('registry-shipping-address-card')
    ).toHaveTextContent('900 Pine Street');
  });

  it('renders shipping disclosure banner and opens two-column My Reserved Gifts modal on RegistryPage', async () => {
    recordStoredSessionClaimHold({
      confirmToken: 'tok-confirm-espresso',
      cancelToken: 'tok-cancel-espresso',
      itemId: 'item-espresso',
      itemName: 'Breville Barista Express Espresso Machine',
      amount: 599.95,
    });

    const pageItem = createMockRegistryItem({
      id: 'item-espresso',
      name: 'Breville Barista Express Espresso Machine',
      description: 'Stainless steel espresso maker',
      price: 599.95,
      category: 'Kitchen',
      itemType: 'PHYSICAL',
      isGroupGift: false,
      purchased: false,
      vendorUrl: 'https://www.crateandbarrel.com/espresso',
      image: createMockMedia({
        id: 'img-esp',
        url: '/images/espresso.jpg',
        altText: 'Espresso Machine',
      }),
    });

    server.use(
      http.get('/api/rsvp/session', () =>
        HttpResponse.json({
          success: true,
          data: {
            authenticated: false,
            hasPasscodeSession: true,
          },
        })
      ),
      http.get('/api/registry/capabilities', () =>
        HttpResponse.json({
          success: true,
          data: {
            cardCheckoutEnabled: false,
            stripePublishableKey: null,
            giftAccessTier: 'PASSCODE_GUESTS',
            shippingDisclosureTier: 'POST_CLAIM_ONLY',
            maxPendingReservations: 5,
            hasShippingAddress: true,
          },
        })
      ),
      http.get('/api/registry', () =>
        HttpResponse.json({
          success: true,
          data: {
            items: [pageItem],
            nextCursor: null,
            totalCount: 1,
          },
        })
      ),
      http.get('/api/registry/claim', () =>
        HttpResponse.json({
          success: true,
          data: mockMultiHoldResponse,
        })
      )
    );

    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RegistryPage />
        </ToastProvider>
      </QueryClientProvider>
    );

    expect(
      await screen.findByTestId('registry-page-shipping-disclosure-notice')
    ).toHaveTextContent(/Couple's Shipping Address Revealed After Reserving a Gift/i);

    const openHubBtn = screen.getByTestId('open-claim-hub-button');
    expect(openHubBtn).toHaveTextContent('My Reserved Gifts');
    expect(within(openHubBtn).getByText('1')).toBeInTheDocument();

    fireEvent.click(openHubBtn);

    const modalHub = await screen.findByTestId('claim-fulfillment-hub');
    expect(
      within(modalHub).getByRole('heading', {
        name: /My Reserved Gifts & Fulfillment Hub/i,
      })
    ).toBeInTheDocument();
    expect(
      await within(modalHub).findByTestId('claim-shipping-address-card')
    ).toHaveTextContent('742 Evergreen Terrace');
  });
});
