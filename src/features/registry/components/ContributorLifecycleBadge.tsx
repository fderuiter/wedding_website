'use client';

import { formatCurrency } from '@/utils/intl';

export interface ContributorLifecycleBadgeProps {
  status?: string | null;
  amount?: number;
  refundedAmount?: number | null;
  contributorId?: string;
}

export function ContributorLifecycleBadge({
  status,
  amount = 0,
  refundedAmount = 0,
  contributorId,
}: ContributorLifecycleBadgeProps) {
  const normalizedStatus = (status || 'CONFIRMED').toUpperCase();
  const safeRefunded = typeof refundedAmount === 'number' && refundedAmount > 0 ? refundedAmount : 0;
  const hasPartialRefund =
    safeRefunded > 0 &&
    safeRefunded < amount &&
    normalizedStatus !== 'REFUNDED' &&
    normalizedStatus !== 'CANCELLED';

  let label = 'Confirmed';
  let badgeClassName =
    'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-700';

  if (normalizedStatus === 'RESERVED') {
    label = 'Reserved';
    badgeClassName =
      'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-700';
  } else if (normalizedStatus === 'CANCELLED') {
    label = 'Cancelled';
    badgeClassName =
      'bg-slate-200 text-slate-800 border-slate-400 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600';
  } else if (normalizedStatus === 'REFUNDED') {
    label = 'Refunded';
    badgeClassName =
      'bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-700';
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        data-testid={
          contributorId
            ? `contributor-lifecycle-badge-${contributorId}`
            : 'contributor-lifecycle-badge'
        }
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${badgeClassName}`}
      >
        {label}
      </span>
      {hasPartialRefund && (
        <span
          data-testid={
            contributorId
              ? `contributor-partial-refund-badge-${contributorId}`
              : 'contributor-partial-refund-badge'
          }
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-orange-100 text-orange-900 border-orange-300 dark:bg-orange-950 dark:text-orange-200 dark:border-orange-700"
        >
          Partial Refund (-{formatCurrency(safeRefunded)})
        </span>
      )}
    </span>
  );
}
