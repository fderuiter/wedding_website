'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { AccessibleExternalLink } from '@/components/ui/AccessibleExternalLink';
import { apiClient } from '@/lib/apiClient';
import { formatCurrency } from '@/utils/intl';
import { ContributorLifecycleBadge, getPaymentUrl } from '@/features/registry';

interface ClaimPreviewData {
  action: 'confirm' | 'cancel';
  status: string;
  amount: number;
  itemId: string;
  itemName: string;
  itemType: string;
  isGroupGift: boolean;
  vendorUrl: string | null;
  paymentHandle: string | null;
  paymentHandleType: string | null;
}

interface ClaimMutationResponse {
  action: 'confirm' | 'cancel';
  status: string;
  changed: boolean;
}

function GuestClaimContent() {
  const searchParams = useSearchParams();
  const token = searchParams?.get('token')?.trim() || '';

  const [fetchState, setFetchState] = useState<{
    token: string;
    preview: ClaimPreviewData | null;
    error: string | null;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [completedResult, setCompletedResult] = useState<ClaimMutationResponse | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }

    let active = true;

    void apiClient
      .get<ClaimPreviewData>(`/api/registry/claim?token=${encodeURIComponent(token)}`)
      .then((data) => {
        if (!active) return;
        setFetchState({ token, preview: data, error: null });
      })
      .catch((err: unknown) => {
        if (!active) return;
        setFetchState({
          token,
          preview: null,
          error:
            err instanceof Error && err.message
              ? err.message
              : 'This gift link is invalid or has expired.',
        });
      });

    return () => {
      active = false;
    };
  }, [token]);

  const isLoading = Boolean(token) && fetchState?.token !== token;
  const preview = fetchState?.token === token ? fetchState.preview : null;
  const loadError = !token
    ? 'Missing gift verification link. Please open the complete link from your email.'
    : fetchState?.token === token
      ? fetchState.error
      : null;

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!token || isSubmitting) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await apiClient.post<ClaimMutationResponse>('/api/registry/claim', {
        token,
      });
      setCompletedResult(response);
      setFetchState((prev) =>
        prev && prev.preview
          ? { ...prev, preview: { ...prev.preview, status: response.status } }
          : prev
      );
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error && err.message
          ? err.message
          : 'Unable to update your gift reservation. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentStatus = (completedResult?.status || preview?.status || '').toUpperCase();
  const isConfirmFlow = preview?.action !== 'cancel';
  const paymentDeepLink =
    preview?.paymentHandle && preview?.paymentHandleType
      ? getPaymentUrl(preview.paymentHandleType, preview.paymentHandle)
      : null;

  return (
    <main className="min-h-screen bg-[var(--color-background,#f8fafc)] text-[var(--color-foreground,#0f172a)] py-16 px-4 flex items-center justify-center">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-xl p-6 sm:p-8 space-y-6">
        <header className="space-y-2 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-600 dark:text-gray-300">
            Wedding Registry Verification
          </p>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            {isLoading
              ? 'Loading Gift Reservation...'
              : loadError
                ? 'Gift Link Unavailable'
                : completedResult
                  ? completedResult.action === 'confirm'
                    ? 'Gift Confirmed!'
                    : 'Reservation Released'
                  : isConfirmFlow
                    ? 'Confirm Your Wedding Gift'
                    : 'Release Gift Reservation'}
          </h1>
        </header>

        {isLoading ? (
          <div role="status" className="py-8 text-center text-sm text-gray-700 dark:text-gray-300">
            Retrieving your gift reservation details...
          </div>
        ) : loadError ? (
          <div
            role="alert"
            data-testid="guest-claim-error"
            className="rounded-xl bg-rose-50 dark:bg-rose-950 border border-rose-300 dark:border-rose-700 p-4 text-sm text-rose-900 dark:text-rose-100 space-y-3"
          >
            <p className="font-semibold">{loadError}</p>
            <p>
              If you need assistance updating a gift claim, please visit the registry or reach out to the couple directly.
            </p>
          </div>
        ) : preview ? (
          <div className="space-y-5">
            <div className="rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-4 space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                  Selected Gift
                </span>
                <ContributorLifecycleBadge status={currentStatus} amount={preview.amount} />
              </div>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{preview.itemName}</p>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Reserved Amount: <span className="font-bold">{formatCurrency(preview.amount)}</span>
              </p>
            </div>

            {completedResult ? (
              <div
                role="status"
                data-testid="guest-claim-completed"
                className={`rounded-xl p-4 border text-sm ${
                  completedResult.action === 'confirm'
                    ? 'bg-emerald-50 dark:bg-emerald-950 border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-100'
                    : 'bg-slate-100 dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100'
                }`}
              >
                {completedResult.action === 'confirm' ? (
                  <p>
                    Thank you! Your gift for <strong>{preview.itemName}</strong> has been marked as{' '}
                    <strong>Confirmed</strong>, and the couple has been notified.
                  </p>
                ) : (
                  <p>
                    Your reservation for <strong>{preview.itemName}</strong> has been cancelled so other wedding guests can select this gift.
                  </p>
                )}
              </div>
            ) : currentStatus === 'RESERVED' ? (
              <form onSubmit={handleSubmit} className="space-y-4" data-testid="guest-claim-form">
                {isConfirmFlow ? (
                  <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
                    <p>
                      Please confirm below once you have completed your direct transfer or retailer order so we can notify the couple.
                    </p>
                    {preview.paymentHandle && (
                      <div className="rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-300 dark:border-amber-700 p-3 text-xs text-amber-900 dark:text-amber-100 space-y-1">
                        <p className="font-semibold">
                          {preview.paymentHandleType || 'Direct Transfer'}:{' '}
                          <span className="font-mono">{preview.paymentHandle}</span>
                        </p>
                        {paymentDeepLink && (
                          <p>
                            <AccessibleExternalLink
                              href={paymentDeepLink}
                              className="underline font-semibold text-amber-900 dark:text-amber-100"
                            >
                              Open {preview.paymentHandleType || 'Payment App'}
                            </AccessibleExternalLink>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    Changed your mind? Submit below to release your reservation on{' '}
                    <strong>{preview.itemName}</strong> so other wedding guests can contribute toward it.
                  </p>
                )}

                {submitError && (
                  <div
                    role="alert"
                    className="rounded-lg bg-rose-50 dark:bg-rose-950 border border-rose-300 dark:border-rose-700 p-3 text-sm text-rose-900 dark:text-rose-100"
                  >
                    {submitError}
                  </div>
                )}

                <Button
                  type="submit"
                  variant={isConfirmFlow ? 'primary' : 'danger'}
                  disabled={isSubmitting}
                  data-testid="guest-claim-submit-button"
                  className="w-full"
                >
                  {isSubmitting
                    ? 'Updating Reservation...'
                    : isConfirmFlow
                      ? 'Confirm Gift Sent'
                      : 'Confirm Cancellation'}
                </Button>
              </form>
            ) : (
              <div
                role="status"
                data-testid="guest-claim-already-finalized"
                className="rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 p-4 text-sm text-slate-900 dark:text-slate-100"
              >
                {currentStatus === 'CONFIRMED' ? (
                  <p>
                    This gift has already been <strong>Confirmed</strong>. If you need to make changes, please reach out to the couple directly.
                  </p>
                ) : (
                  <p>
                    This reservation is already <strong>{currentStatus === 'REFUNDED' ? 'Refunded' : 'Cancelled'}</strong> and no further action is needed.
                  </p>
                )}
              </div>
            )}
          </div>
        ) : null}

        <div className="pt-2 border-t border-gray-200 dark:border-gray-700 text-center">
          <Link
            href="/registry"
            className="inline-flex items-center justify-center text-sm font-semibold text-primary underline hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary rounded px-2 py-1"
          >
            Return to Wedding Registry
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function GuestClaimPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center p-6">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Loading gift verification...
          </p>
        </main>
      }
    >
      <GuestClaimContent />
    </Suspense>
  );
}
