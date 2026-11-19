import React from 'react';
import { render as tlRender, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/ToastProvider';
import AdminDashboardPage from '../page';
import ThankYouNotesPage from '../thank-you-notes/page';
import type { RegistryItem } from '@/features/registry';
import { checkAdminClient as mockCheckAdminClient } from '@/core/auth/auth.client';
import { createMockMedia } from '@/testing/factories/mediaFactory';
import { createMockContributor, createMockRegistryItem } from '@/testing/factories/registryFactory';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: jest.fn(),
    push: jest.fn(),
  }),
}));

jest.mock('@/core/auth/auth.client');

const mockFetch = jest.fn();

beforeEach(() => {
  (global.fetch as unknown) = mockFetch as unknown as typeof fetch;
  (window.fetch as unknown) = mockFetch as unknown as typeof fetch;
  (mockCheckAdminClient as jest.Mock).mockResolvedValue(true);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('Couple Dashboard Verified Transaction References', () => {
  const renderDashboard = (ui: React.ReactElement) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return tlRender(
      <ToastProvider>
        <QueryClientProvider client={queryClient}>
          {ui}
        </QueryClientProvider>
      </ToastProvider>
    );
  };

  it('Criterion 5: couple dashboard displays verified transaction references for completed card gifts', async () => {
    const mockItemWithStripe: RegistryItem = createMockRegistryItem({
      id: 'item-100',
      name: 'Honeymoon Excursion',
      description: 'Snorkeling trip',
      category: 'Experiences',
      price: 500,
      image: createMockMedia({ url: '/img.jpg', altText: 'Honeymoon Excursion' }),
      vendorUrl: null,
      quantity: 1,
      isGroupGift: true,
      purchased: false,
      amountContributed: 200,
      contributors: [
        createMockContributor({
          name: 'Sarah Connor',
          amount: 100,
          date: '2026-11-16T12:00:00.000Z',
          message: 'Have fun!',
          stripeChargeId: 'ch_test_charge_12345',
          stripePaymentIntentId: 'pi_test_intent_12345',
          transactionTimestamp: '2026-11-16T12:00:00.000Z',
        }),
        createMockContributor({
          name: 'Manual Giver',
          amount: 100,
          date: '2026-11-16T12:30:00.000Z',
          message: 'Paid cash',
        }),
      ],
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [mockItemWithStripe],
    });

    renderDashboard(<AdminDashboardPage />);

    expect((await screen.findAllByText('Honeymoon Excursion')).length).toBeGreaterThan(0);
    
    // Check that verified transaction reference is displayed for the card gift
    const verifiedRefs = await screen.findAllByText(/Verified Ref:\s*ch_test_charge_12345/);
    expect(verifiedRefs.length).toBeGreaterThan(0);

    // Verify manual gift does not show a verified transaction ref
    expect(screen.queryByText(/Verified Ref:\s*Manual Giver/)).not.toBeInTheDocument();
  });

  it('thank-you notes table displays verified transaction references for completed card gifts', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        items: [
          {
            id: 'c1',
            name: 'John Doe',
            email: 'john@example.com',
            amount: 150,
            date: '2026-11-16T12:00:00.000Z',
            thankYouStatus: 'Unsent',
            thankYouSentAt: null,
            thankYouNote: '',
            stripeChargeId: 'ch_card_success_99999',
            stripePaymentIntentId: 'pi_card_success_99999',
            registryItem: {
              id: 'r1',
              name: 'Kitchen Stand Mixer',
              category: 'Kitchen',
            },
          },
        ],
        metrics: {
          total: 1,
          sent: 0,
          unsent: 1,
          notNeeded: 0,
          thanked: 0,
          completionPercentage: 0,
        },
      }),
    });

    renderDashboard(<ThankYouNotesPage />);

    expect(await screen.findByText('John Doe')).toBeInTheDocument();
    expect(await screen.findByText(/Ref:\s*ch_card_success_99999/)).toBeInTheDocument();
  });
});
