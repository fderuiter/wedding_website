import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { Overlay } from '@/components/ui/Overlay';
import { DemoProvider, useOptionalDemo } from '@/components/demo/DemoContext';
import RegistryItemCard from '../RegistryItemCard';
import type { SimulatedTestCardId } from '../SimulatedCardCheckout';
import { GuestSessionProvider } from '../../context/GuestSessionContext';
import { resetDemoState, setDemoArchetype } from '@/lib/demo/demoStore';

expect.extend(toHaveNoViolations);

jest.mock('next/navigation', () => ({
  usePathname: () => '/registry',
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
  }),
}));

function LiveDemoRegistryItemHarness({
  itemIndex = 3,
  initialSimulatedCardId,
}: {
  itemIndex?: number;
  initialSimulatedCardId?: SimulatedTestCardId;
}) {
  const demo = useOptionalDemo();
  const item = demo?.activeDataset.registryItems[itemIndex];
  if (!demo || !item) return null;

  const modalTitleId = `demo-modal-title-${item.id}`;

  const handleContribute = async (
    itemId: string,
    purchaserName: string,
    amount: number,
    code?: string,
    message?: string,
    coverFee?: boolean,
    email?: string,
    paymentIntentId?: string
  ) => {
    const res = await fetch('/api/registry/contribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId,
        purchaserName,
        amount,
        code,
        message,
        coverFee,
        email,
        paymentIntentId,
      }),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      throw new Error(err.error ?? 'Failed to record contribution');
    }
    return res.json();
  };

  return (
    <main aria-label="Registry Showcase">
      <div data-testid="live-item-contributed">{item.amountContributed}</div>
      <Overlay isOpen={true} onClose={jest.fn()} aria-labelledby={modalTitleId}>
        <RegistryItemCard
          item={item}
          titleId={modalTitleId}
          onClose={jest.fn()}
          onContribute={handleContribute}
          initialSimulatedCardId={initialSimulatedCardId}
        />
      </Overlay>
    </main>
  );
}

function renderDemoItemModal({
  enabled = true,
  itemIndex = 3,
  initialSimulatedCardId,
}: {
  enabled?: boolean;
  itemIndex?: number;
  initialSimulatedCardId?: SimulatedTestCardId;
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <DemoProvider enabled={enabled}>
            <GuestSessionProvider>
              <LiveDemoRegistryItemHarness
                itemIndex={itemIndex}
                initialSimulatedCardId={initialSimulatedCardId}
              />
            </GuestSessionProvider>
          </DemoProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('SimulatedCardCheckout & Demo Registry Item Flows', () => {
  const mockClipboardWriteText = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    window.localStorage.clear();
    resetDemoState();
    mockClipboardWriteText.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mockClipboardWriteText },
      configurable: true,
    });
  });

  it('keeps sample items locked when DemoProvider is disabled (standalone server mode)', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const sampleItem = {
      id: 'sample-server-1',
      name: 'Sample Cash Fund',
      description: 'Preview item',
      price: 500,
      quantity: 1,
      category: 'Travel',
      itemType: 'CASH_FUND' as const,
      isGroupGift: true,
      isMostWanted: false,
      displayOrder: 0,
      purchased: false,
      amountContributed: 0,
      isSample: true,
      contributors: [],
    };

    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ToastProvider>
            <DemoProvider enabled={false}>
              <GuestSessionProvider>
                <main aria-label="Standalone Server Registry">
                  <Overlay isOpen={true} onClose={jest.fn()} aria-labelledby="sample-title">
                    <RegistryItemCard
                      item={sampleItem}
                      titleId="sample-title"
                      onClose={jest.fn()}
                      onContribute={jest.fn()}
                    />
                  </Overlay>
                </main>
              </GuestSessionProvider>
            </DemoProvider>
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );

    expect(screen.getByText(/Demo \/ Sample Registry Item/i)).toBeInTheDocument();
    expect(screen.queryByTestId('simulated-card-checkout')).not.toBeInTheDocument();
  });

  it('blocks declined simulated cards even if a guest submits before SimulatedCardCheckout finishes loading', async () => {
    // Run BEFORE any test triggers SimulatedCardCheckout's dynamic chunk resolution
    renderDemoItemModal({
      enabled: true,
      itemIndex: 3,
      initialSimulatedCardId: 'declined_insufficient_funds',
    });

    // Wait for ActiveDemoProvider to mount RegistryItemCard, then submit immediately
    const nameInput = await screen.findByLabelText(/Your Name/i);
    fireEvent.change(nameInput, { target: { value: 'Fast Submitter' } });
    fireEvent.change(screen.getByLabelText(/Contribution Amount/i), {
      target: { value: '75' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Submit Contribution$/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Your test card ending in 0002 was declined/i);
    expect(screen.queryByText(/Contribution Confirmed!/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('live-item-contributed')).toHaveTextContent('0');
  });

  it('unlocks physical claim, direct transfer, and non-charging simulated card checkout on sample items without loading js.stripe.com', async () => {
    // Index 0 in classic archetype is KitchenAid Stand Mixer (PHYSICAL)
    renderDemoItemModal({ enabled: true, itemIndex: 0 });

    expect(await screen.findByTestId('payment-mode-claim')).toBeInTheDocument();
    expect(screen.queryByText(/Demo \/ Sample Registry Item/i)).not.toBeInTheDocument();

    // All three modes are selectable
    expect(screen.getByTestId('payment-mode-direct')).toBeInTheDocument();
    expect(screen.getByTestId('payment-mode-card')).toBeInTheDocument();

    // Switch to Card Checkout on physical item (lazy-loads SimulatedCardCheckout)
    fireEvent.click(screen.getByTestId('payment-mode-card'));
    expect(await screen.findByTestId('simulated-card-checkout')).toBeInTheDocument();
    expect(screen.getByText(/Non-Charging Demo Checkout/i)).toBeInTheDocument();

    expect(document.querySelectorAll('script[src*="js.stripe.com"]')).toHaveLength(0);
  });

  it('computes 2.5% fee coverage math, processes approved test card, updates funding totals, and copies receipt', async () => {
    // Index 3 in classic archetype is Honeymoon Experience Fund ($1,500 CASH_FUND)
    renderDemoItemModal({ enabled: true, itemIndex: 3 });

    expect(await screen.findByTestId('simulated-card-checkout')).toBeInTheDocument();
    expect(screen.getByTestId('live-item-contributed')).toHaveTextContent('0');

    // Fill contributor name and $100 amount
    fireEvent.change(screen.getByLabelText(/Your Name/i), {
      target: { value: 'Jordan Guest' },
    });
    const amountInput = screen.getByLabelText(/Contribution Amount/i);
    fireEvent.change(amountInput, { target: { value: '100' } });

    // Without coverFee: $100.00 charged, $97.50 net received by couple
    const feeDisclosure = screen.getByTestId('fee-disclosure-panel');
    expect(feeDisclosure).toHaveTextContent('$100.00');
    expect(feeDisclosure).toHaveTextContent('$97.50');

    // Check coverFee: +$2.50 processing fee -> $102.50 total charged, $100.00 net received
    const coverFeeCheckbox = screen.getByRole('checkbox', {
      name: /Cover transaction processing fee \(2\.5% \/ \$2\.50\)/i,
    });
    fireEvent.click(coverFeeCheckbox);
    expect(feeDisclosure).toHaveTextContent('$102.50');
    expect(feeDisclosure).toHaveTextContent('$100.00');

    // Submit with default Approved Visa 4242
    fireEvent.click(screen.getByRole('button', { name: /^Submit Contribution$/i }));

    expect(await screen.findByText(/Contribution Confirmed!/i)).toBeInTheDocument();
    const confirmation = screen.getByTestId('contribution-success-confirmation');
    expect(confirmation).toHaveTextContent('$102.50');
    expect(confirmation).toHaveTextContent(/pi_demo_/);

    // Live funding total updated by $100 net gift
    expect(screen.getByTestId('live-item-contributed')).toHaveTextContent('100');

    // Copy receipt
    fireEvent.click(screen.getByTestId('copy-receipt-button'));
    await waitFor(() => {
      expect(mockClipboardWriteText).toHaveBeenCalledTimes(1);
    });
    expect(mockClipboardWriteText.mock.calls[0][0]).toContain('pi_demo_');
    expect(mockClipboardWriteText.mock.calls[0][0]).toContain('$102.50');
  });

  it('displays an inline error alert on declined test card and leaves item funding totals unchanged', async () => {
    renderDemoItemModal({ enabled: true, itemIndex: 3 });

    expect(await screen.findByTestId('simulated-card-checkout')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Your Name/i), {
      target: { value: 'Declined Tester' },
    });
    fireEvent.change(screen.getByLabelText(/Contribution Amount/i), {
      target: { value: '150' },
    });

    // Select Declined Visa 0002
    fireEvent.click(screen.getByTestId('simulated-card-option-declined_insufficient_funds'));
    fireEvent.click(screen.getByRole('button', { name: /^Submit Contribution$/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Your test card ending in 0002 was declined/i);
    expect(screen.queryByText(/Contribution Confirmed!/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('live-item-contributed')).toHaveTextContent('0');
  });

  it('verifies household invitation codes against the active demo archetype', async () => {
    setDemoArchetype('destination');
    renderDemoItemModal({ enabled: true, itemIndex: 0 });

    const codeInput = await screen.findByLabelText(/Invitation Code/i);
    fireEvent.change(codeInput, { target: { value: 'RODRIGUEZ2026' } });
    fireEvent.click(screen.getByRole('button', { name: /Verify/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Carlos & Maria Rodriguez')).toBeInTheDocument();
    });
  });

  it('supports roving arrow-key navigation across simulated test cards and billing ZIP input', async () => {
    renderDemoItemModal({ enabled: true, itemIndex: 3 });

    const visaBtn = await screen.findByTestId('simulated-card-option-approved_visa');
    const mastercardBtn = screen.getByTestId('simulated-card-option-approved_mastercard');
    const declinedBtn = screen.getByTestId('simulated-card-option-declined_insufficient_funds');

    expect(visaBtn).toHaveAttribute('aria-checked', 'true');

    fireEvent.keyDown(visaBtn, { key: 'ArrowDown' });
    expect(mastercardBtn).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(mastercardBtn);

    fireEvent.keyDown(mastercardBtn, { key: 'ArrowRight' });
    expect(declinedBtn).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(declinedBtn);

    fireEvent.keyDown(declinedBtn, { key: 'ArrowUp' });
    expect(mastercardBtn).toHaveAttribute('aria-checked', 'true');

    fireEvent.keyDown(mastercardBtn, { key: 'ArrowLeft' });
    expect(visaBtn).toHaveAttribute('aria-checked', 'true');

    // Non-navigation keys are ignored cleanly
    fireEvent.keyDown(visaBtn, { key: 'Tab' });
    expect(visaBtn).toHaveAttribute('aria-checked', 'true');

    const zipInput = screen.getByLabelText(/Billing ZIP \/ Postal Code/i);
    expect(zipInput).toHaveAttribute('id', 'simulated-billing-zip');
    expect(zipInput).toHaveAttribute('autocomplete', 'postal-code');
    fireEvent.change(zipInput, { target: { value: '94559' } });
    expect(zipInput).toHaveValue('94559');
  });

  it('has zero axe accessibility violations on SimulatedCardCheckout inside RegistryItemCard', async () => {
    const { baseElement } = renderDemoItemModal({ enabled: true, itemIndex: 3 });
    expect(await screen.findByTestId('simulated-card-checkout')).toBeInTheDocument();
    const results = await axe(baseElement);
    expect(results).toHaveNoViolations();
  });
});
