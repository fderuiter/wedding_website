'use client';

import React, { useRef } from 'react';
import { FormGroup, Input, Label } from '@/components/ui/forms';
import { formatCurrency } from '@/utils/intl';

export type SimulatedTestCardId =
  | 'approved_visa'
  | 'approved_mastercard'
  | 'declined_insufficient_funds';

export interface SimulatedTestCardOption {
  id: SimulatedTestCardId;
  brand: string;
  last4: string;
  expiry: string;
  outcome: 'approved' | 'declined';
  badgeLabel: string;
  description: string;
  declineMessage?: string;
}

export const SIMULATED_TEST_CARDS: SimulatedTestCardOption[] = [
  {
    id: 'approved_visa',
    brand: 'Visa',
    last4: '4242',
    expiry: '12/29',
    outcome: 'approved',
    badgeLabel: 'Approved',
    description: 'Simulates instant card authorization and receipt generation',
  },
  {
    id: 'approved_mastercard',
    brand: 'Mastercard',
    last4: '5556',
    expiry: '08/28',
    outcome: 'approved',
    badgeLabel: 'Approved',
    description: 'Simulates approved group-gift card settlement',
  },
  {
    id: 'declined_insufficient_funds',
    brand: 'Visa',
    last4: '0002',
    expiry: '04/27',
    outcome: 'declined',
    badgeLabel: 'Declined',
    description: 'Simulates processor decline — leaves gift funding totals unchanged',
    declineMessage:
      'Simulated card declined (insufficient_funds): Your test card ending in 0002 was declined. No payment was recorded and gift funding totals remain unchanged.',
  },
];

interface SimulatedCardCheckoutProps {
  selectedCardId: SimulatedTestCardId;
  onSelectCard: (cardId: SimulatedTestCardId) => void;
  billingZip: string;
  onBillingZipChange: (zip: string) => void;
  totalChargeAmount: number;
  disabled?: boolean;
}

export function SimulatedCardCheckout({
  selectedCardId,
  onSelectCard,
  billingZip,
  onBillingZipChange,
  totalChargeAmount,
  disabled = false,
}: SimulatedCardCheckoutProps) {
  const cardButtonsRef = useRef<Array<HTMLButtonElement | null>>([]);

  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIdx = index;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      nextIdx = (index + 1) % SIMULATED_TEST_CARDS.length;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      nextIdx = (index - 1 + SIMULATED_TEST_CARDS.length) % SIMULATED_TEST_CARDS.length;
    } else {
      return;
    }
    e.preventDefault();
    const targetCard = SIMULATED_TEST_CARDS[nextIdx];
    onSelectCard(targetCard.id);
    cardButtonsRef.current[nextIdx]?.focus();
  };

  return (
    <div
      data-testid="simulated-card-checkout"
      className="mb-4 p-4 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/90 space-y-3"
    >
      <div
        data-testid="simulated-card-demo-banner"
        className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200 dark:border-slate-700"
      >
        <div>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950">
            Non-Charging Demo Checkout
          </span>
          <p className="text-xs text-slate-700 dark:text-slate-300 mt-1">
            Simulated showcase widget — no real card is charged and Stripe is never contacted.
          </p>
        </div>
        <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
          Simulated Charge: {formatCurrency(totalChargeAmount)}
        </div>
      </div>

      <div>
        <span
          id="simulated-test-card-label"
          className="block text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2"
        >
          Select Simulated Test Card
        </span>
        <div
          role="radiogroup"
          aria-labelledby="simulated-test-card-label"
          className="space-y-2"
        >
          {SIMULATED_TEST_CARDS.map((card, index) => {
            const isSelected = selectedCardId === card.id;
            const isDecline = card.outcome === 'declined';
            return (
              <button
                key={card.id}
                ref={(el) => {
                  cardButtonsRef.current[index] = el;
                }}
                type="button"
                role="radio"
                data-testid={`simulated-card-option-${card.id}`}
                aria-checked={isSelected}
                tabIndex={isSelected ? 0 : -1}
                disabled={disabled}
                onClick={() => onSelectCard(card.id)}
                onKeyDown={(e) => handleCardKeyDown(e, index)}
                className={`w-full min-h-[48px] text-left p-3 rounded-lg border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-slate-100 ${
                  isSelected
                    ? 'bg-white dark:bg-slate-800 border-slate-900 dark:border-slate-200 shadow-xs'
                    : 'bg-white/70 dark:bg-slate-800/60 border-slate-300 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-100 font-mono">
                    {card.brand} •••• {card.last4}{' '}
                    <span className="font-sans font-normal text-xs text-slate-600 dark:text-slate-300">
                      (Exp {card.expiry})
                    </span>
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                      isDecline
                        ? 'bg-rose-800 text-white dark:bg-rose-300 dark:text-slate-950'
                        : 'bg-emerald-800 text-white dark:bg-emerald-300 dark:text-slate-950'
                    }`}
                  >
                    {card.badgeLabel}
                  </span>
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-300 mt-1">
                  {card.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <FormGroup className="mb-0">
        <Label htmlFor="simulated-billing-zip" className="text-xs font-semibold text-slate-800 dark:text-slate-200">
          Billing ZIP / Postal Code (Simulated)
        </Label>
        <Input
          id="simulated-billing-zip"
          type="text"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={10}
          value={billingZip}
          onChange={(e) => onBillingZipChange(e.target.value)}
          disabled={disabled}
          placeholder="60611"
        />
      </FormGroup>
    </div>
  );
}
