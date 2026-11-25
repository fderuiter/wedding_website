'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { MediaImage } from '@/components/MediaImage';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { FormGroup, Input, Label } from '@/components/ui/forms';
import { AccessibleExternalLink } from '@/components/ui/AccessibleExternalLink';
import { apiClient } from '@/lib/apiClient';
import { formatCurrency } from '@/utils/intl';
import { ContributorLifecycleBadge } from './ContributorLifecycleBadge';
import {
  readStoredSessionClaimHolds,
  removeStoredSessionClaimHoldByToken,
} from '../lib/claimHubStorage';
import {
  formatRegistryShippingAddress,
  getPaymentUrl,
} from '../utils/paymentUrls';
import type {
  ClaimHubHold,
  ClaimHubResponse,
  RegistryItem,
  RegistryShippingAddress,
} from '../types';

interface LegacyClaimPreviewPayload {
  action: 'confirm' | 'cancel';
  status: string;
  amount: number;
  itemId: string;
  itemName: string;
  itemType: string;
  isGroupGift: boolean;
  vendorUrl: string | null;
  shippingAddress?: RegistryShippingAddress | null;
  paymentHandle: string | null;
  paymentHandleType: string | null;
}

interface ClaimMutationResponse {
  action: 'confirm' | 'cancel';
  status: string;
  changed: boolean;
  item?: RegistryItem | null;
}

export interface ClaimFulfillmentHubProps {
  mode: 'page' | 'modal';
  initialToken?: string;
  titleId?: string;
  onClose?: () => void;
  onItemUpdated?: (item: RegistryItem) => void;
  onHoldsChanged?: () => void;
}

function isHubPayload(data: unknown): data is ClaimHubResponse {
  return Boolean(
    data &&
      typeof data === 'object' &&
      'holds' in data &&
      Array.isArray((data as ClaimHubResponse).holds)
  );
}

function normalizeClaimResponse(
  raw: ClaimHubResponse | LegacyClaimPreviewPayload,
  fallbackToken: string
): ClaimHubResponse {
  if (isHubPayload(raw)) {
    return raw;
  }

  const normalizedType =
    raw.itemType === 'CASH_FUND' || raw.itemType === 'EXPERIENCE_FUND'
      ? raw.itemType
      : 'PHYSICAL';
  const syntheticId = `preview-${raw.itemId || 'primary'}`;

  return {
    holds: [
      {
        contributorId: syntheticId,
        status: (raw.status as ClaimHubHold['status']) || 'RESERVED',
        amount: raw.amount,
        createdAt: new Date().toISOString(),
        itemId: raw.itemId,
        itemName: raw.itemName,
        itemDescription: '',
        itemImageUrl: null,
        itemCategory: null,
        itemType: normalizedType,
        isGroupGift: Boolean(raw.isGroupGift),
        vendorUrl: raw.vendorUrl ?? null,
        paymentHandle: raw.paymentHandle ?? null,
        paymentHandleType: raw.paymentHandleType ?? null,
        retailerOrderNumber: null,
        carrier: null,
        trackingNumber: null,
        confirmToken: raw.action === 'confirm' ? fallbackToken : '',
        cancelToken: raw.action === 'cancel' ? fallbackToken : '',
      },
    ],
    maxPendingReservations: 5,
    coupleNames: 'the couple',
    shippingAddress: raw.shippingAddress ?? null,
    selectedContributorId: syntheticId,
    selectedAction: raw.action,
  };
}

function extractVendorHostname(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
}

export const ClaimFulfillmentHub: React.FC<ClaimFulfillmentHubProps> = ({
  mode,
  initialToken = '',
  titleId,
  onClose,
  onItemUpdated,
  onHoldsChanged,
}) => {
  const token = initialToken.trim();
  const [reloadNonce, setReloadNonce] = useState(0);
  const requestKey = `${mode}:${token}:${reloadNonce}`;

  const [fetchState, setFetchState] = useState<{
    key: string;
    hubData: ClaimHubResponse | null;
    error: string | null;
  } | null>(null);
  const [statusOverridesByHold, setStatusOverridesByHold] = useState<
    Record<string, ClaimHubHold['status']>
  >({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeActionMode, setActiveActionMode] = useState<'confirm' | 'cancel'>('confirm');

  const [orderInputsByHold, setOrderInputsByHold] = useState<
    Record<
      string,
      {
        retailerOrderNumber: string;
        carrier: string;
        trackingNumber: string;
      }
    >
  >({});
  const [completedByHold, setCompletedByHold] = useState<
    Record<string, { action: 'confirm' | 'cancel'; status: string }>
  >({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState(false);

  const [lookupCode, setLookupCode] = useState('');
  const [isVerifyingLookupCode, setIsVerifyingLookupCode] = useState(false);
  const [lookupCodeError, setLookupCodeError] = useState<string | null>(null);

  const addressCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (addressCopyTimerRef.current) {
        clearTimeout(addressCopyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let active = true;
    const storedHolds = readStoredSessionClaimHolds();
    const extraTokens = storedHolds
      .map((entry) => entry.confirmToken)
      .filter((t) => Boolean(t) && t !== token);

    let endpoint: string;
    if (token) {
      endpoint = `/api/registry/claim?token=${encodeURIComponent(token)}&hub=1`;
      if (extraTokens.length > 0) {
        endpoint += `&tokens=${encodeURIComponent(extraTokens.join(','))}`;
      }
    } else if (extraTokens.length > 0) {
      endpoint = `/api/registry/claim?hub=1&tokens=${encodeURIComponent(extraTokens.join(','))}`;
    } else {
      endpoint = '/api/registry/claim?hub=1';
    }

    void apiClient
      .get<ClaimHubResponse | LegacyClaimPreviewPayload>(endpoint)
      .then((raw) => {
        if (!active) return;
        const normalized = normalizeClaimResponse(raw, token);
        setFetchState({ key: requestKey, hubData: normalized, error: null });
        setSelectedId((prev) => {
          if (prev && normalized.holds.some((h) => h.contributorId === prev)) {
            return prev;
          }
          return normalized.selectedContributorId ?? normalized.holds[0]?.contributorId ?? null;
        });
        setActiveActionMode(normalized.selectedAction === 'cancel' ? 'cancel' : 'confirm');
        setOrderInputsByHold((prev) => {
          const next = { ...prev };
          for (const hold of normalized.holds) {
            if (!next[hold.contributorId]) {
              next[hold.contributorId] = {
                retailerOrderNumber: hold.retailerOrderNumber ?? '',
                carrier: hold.carrier ?? '',
                trackingNumber: hold.trackingNumber ?? '',
              };
            }
          }
          return next;
        });
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (mode === 'modal' && !token && extraTokens.length === 0) {
          setFetchState({
            key: requestKey,
            hubData: {
              holds: [],
              maxPendingReservations: 5,
              coupleNames: 'the couple',
              shippingAddress: null,
              selectedContributorId: null,
              selectedAction: 'confirm',
            },
            error: null,
          });
        } else if (!token && extraTokens.length === 0) {
          setFetchState({
            key: requestKey,
            hubData: null,
            error:
              'Missing gift verification link. Please open the complete link from your email or verify your household invitation code below.',
          });
        } else {
          setFetchState({
            key: requestKey,
            hubData: null,
            error:
              err instanceof Error && err.message
                ? err.message
                : 'This gift link is invalid or has expired.',
          });
        }
      });

    return () => {
      active = false;
    };
  }, [mode, requestKey, token]);

  const isLoading = fetchState?.key !== requestKey;
  const hubData = fetchState?.key === requestKey ? fetchState.hubData : null;
  const loadError = fetchState?.key === requestKey ? fetchState.error : null;

  const holds = useMemo(
    () =>
      (hubData?.holds ?? []).map((h) =>
        statusOverridesByHold[h.contributorId]
          ? { ...h, status: statusOverridesByHold[h.contributorId] }
          : h
      ),
    [hubData, statusOverridesByHold]
  );
  const selectedHold = useMemo(
    () =>
      holds.find((h) => h.contributorId === selectedId) ??
      holds[0] ??
      null,
    [holds, selectedId]
  );

  const activeReservedCount = useMemo(
    () =>
      holds.filter((h) => {
        const effectiveStatus = (
          completedByHold[h.contributorId]?.status || h.status
        ).toUpperCase();
        return effectiveStatus === 'RESERVED';
      }).length,
    [holds, completedByHold]
  );

  const selectedCompletion = selectedHold
    ? completedByHold[selectedHold.contributorId] ?? null
    : null;
  const selectedStatus = (
    selectedCompletion?.status ||
    selectedHold?.status ||
    ''
  ).toUpperCase();

  const selectedInputs = selectedHold
    ? orderInputsByHold[selectedHold.contributorId] ?? {
      retailerOrderNumber: '',
      carrier: '',
      trackingNumber: '',
    }
    : { retailerOrderNumber: '', carrier: '', trackingNumber: '' };

  const updateSelectedInput = (
    field: 'retailerOrderNumber' | 'carrier' | 'trackingNumber',
    value: string
  ) => {
    if (!selectedHold) return;
    setOrderInputsByHold((prev) => ({
      ...prev,
      [selectedHold.contributorId]: {
        ...(prev[selectedHold.contributorId] ?? {
          retailerOrderNumber: '',
          carrier: '',
          trackingNumber: '',
        }),
        [field]: value,
      },
    }));
  };

  const formattedShippingText = hubData?.shippingAddress
    ? formatRegistryShippingAddress(hubData.shippingAddress)
    : '';

  const showShippingAddressCard = Boolean(
    formattedShippingText &&
      selectedCompletion?.action !== 'cancel' &&
      selectedStatus !== 'CANCELLED' &&
      selectedStatus !== 'REFUNDED'
  );

  const isVendorUrlSafe = Boolean(
    selectedHold?.vendorUrl &&
      (selectedHold.vendorUrl.startsWith('http://') ||
        selectedHold.vendorUrl.startsWith('https://'))
  );

  const paymentDeepLink =
    selectedHold?.paymentHandle && selectedHold?.paymentHandleType
      ? getPaymentUrl(
        selectedHold.paymentHandleType,
        selectedHold.paymentHandle,
        selectedHold.amount
      )
      : null;

  const handleCopyShippingAddress = async () => {
    if (!formattedShippingText) return;
    let copySucceeded = false;

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(formattedShippingText);
        copySucceeded = true;
      } catch {
        // Fallback below
      }
    }

    if (!copySucceeded && typeof document !== 'undefined') {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = formattedShippingText;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        copySucceeded = true;
      } catch {
        // Fallback failed
      }
    }

    if (copySucceeded) {
      setCopiedAddress(true);
      if (addressCopyTimerRef.current) {
        clearTimeout(addressCopyTimerRef.current);
      }
      addressCopyTimerRef.current = setTimeout(() => {
        setCopiedAddress(false);
      }, 2500);
    }
  };

  const executeClaimMutation = async (targetAction: 'confirm' | 'cancel') => {
    if (!selectedHold || isSubmitting) return;
    const actionToken =
      targetAction === 'confirm'
        ? selectedHold.confirmToken || token
        : selectedHold.cancelToken || token;
    if (!actionToken) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const payload: Record<string, string> = { token: actionToken };
      if (targetAction === 'confirm' && selectedHold.itemType === 'PHYSICAL') {
        const cleanOrderNumber = selectedInputs.retailerOrderNumber.trim();
        const cleanCarrier = selectedInputs.carrier.trim();
        const cleanTracking = selectedInputs.trackingNumber.trim();
        if (cleanOrderNumber) payload.retailerOrderNumber = cleanOrderNumber;
        if (cleanCarrier) payload.carrier = cleanCarrier;
        if (cleanTracking) payload.trackingNumber = cleanTracking;
      }

      const response = await apiClient.post<ClaimMutationResponse>(
        '/api/registry/claim',
        payload
      );

      setCompletedByHold((prev) => ({
        ...prev,
        [selectedHold.contributorId]: {
          action: response.action,
          status: response.status,
        },
      }));
      setStatusOverridesByHold((prev) => ({
        ...prev,
        [selectedHold.contributorId]: response.status as ClaimHubHold['status'],
      }));

      if (selectedHold.confirmToken) {
        removeStoredSessionClaimHoldByToken(selectedHold.confirmToken);
      }
      if (response.item) {
        onItemUpdated?.(response.item);
      }
      onHoldsChanged?.();
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

  const handleFormSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    await executeClaimMutation(activeActionMode);
  };

  const handleVerifyHouseholdLookup = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const cleanCode = lookupCode.trim().toUpperCase();
    if (!cleanCode || isVerifyingLookupCode) return;

    setIsVerifyingLookupCode(true);
    setLookupCodeError(null);

    try {
      const res = await apiClient.post<{
        valid?: boolean;
        code?: string;
        error?: string;
      }>('/api/registry/validate-code', { code: cleanCode });
      if (!res?.valid) {
        setLookupCodeError(res?.error || 'Invalid household invitation code.');
        return;
      }
      setLookupCode('');
      setReloadNonce((n) => n + 1);
    } catch (err: unknown) {
      setLookupCodeError(
        err instanceof Error && err.message
          ? err.message
          : 'Invalid household invitation code.'
      );
    } finally {
      setIsVerifyingLookupCode(false);
    }
  };

  const pageHeadingText = isLoading
    ? 'Loading Gift Reservation...'
    : loadError
      ? 'Gift Link Unavailable'
      : selectedCompletion
        ? selectedCompletion.action === 'confirm'
          ? 'Gift Confirmed!'
          : 'Reservation Released'
        : activeActionMode === 'cancel'
          ? 'Release Gift Reservation'
          : 'Confirm Your Wedding Gift';

  const SectionHeadingTag = mode === 'page' ? 'h2' : 'h3';
  const SubCardHeadingTag = mode === 'page' ? 'h3' : 'h4';
  const vendorHost = extractVendorHostname(selectedHold?.vendorUrl ?? null);

  const nextReservedHold = useMemo(
    () =>
      holds.find((h) => {
        if (h.contributorId === selectedHold?.contributorId) return false;
        const st = (completedByHold[h.contributorId]?.status || h.status).toUpperCase();
        return st === 'RESERVED';
      }) ?? null,
    [holds, selectedHold, completedByHold]
  );

  return (
    <div
      data-testid="claim-fulfillment-hub"
      className="w-full max-w-5xl mx-auto rounded-2xl bg-white dark:bg-gray-800 border border-stone-200 dark:border-gray-700 shadow-xl overflow-hidden text-gray-900 dark:text-gray-100"
    >
      {/* Hub Header */}
      <div className="px-6 sm:px-8 py-5 border-b border-stone-200 dark:border-gray-700 flex items-start justify-between gap-4 bg-stone-50/70 dark:bg-gray-900/50">
        <div className="space-y-1">
          {mode === 'page' ? (
            <>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-700 dark:text-gray-300">
                My Reserved Gifts &amp; Fulfillment Hub
              </p>
              <h1 className="font-serif text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
                {pageHeadingText}
              </h1>
            </>
          ) : (
            <h2
              id={titleId}
              className="font-serif text-xl sm:text-2xl font-bold text-gray-900 dark:text-white tracking-tight"
            >
              My Reserved Gifts &amp; Fulfillment Hub
            </h2>
          )}
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Manage your active holds and record purchase tracking directly for{' '}
            {hubData?.coupleNames || 'the couple'}.
          </p>
        </div>
        {mode === 'modal' && onClose && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close modal"
            className="shrink-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
          >
            <Icon name="X" className="w-5 h-5" />
          </Button>
        )}
      </div>

      {/* Body */}
      {isLoading ? (
        <div role="status" className="py-12 px-6 text-center text-sm text-gray-700 dark:text-gray-300">
          Retrieving your gift reservation details...
        </div>
      ) : loadError ? (
        <div className="p-6 sm:p-8 space-y-6">
          <div
            role="alert"
            data-testid="guest-claim-error"
            className="rounded-xl bg-rose-50 dark:bg-rose-950 border border-rose-300 dark:border-rose-700 p-4 text-sm text-rose-900 dark:text-rose-100 space-y-2"
          >
            <p className="font-semibold">{loadError}</p>
            <p>
              If you claimed gifts using your household invitation code, enter your code below to manage all active reservations.
            </p>
          </div>

          <form
            onSubmit={handleVerifyHouseholdLookup}
            className="rounded-xl bg-stone-50 dark:bg-gray-900 border border-stone-200 dark:border-gray-700 p-4 sm:p-5 space-y-3"
          >
            <FormGroup
              busy={isVerifyingLookupCode}
              state={lookupCodeError ? 'error' : 'default'}
              className="mb-0"
            >
              <Label htmlFor="claim-hub-household-code-input">
                Household Invitation Code
              </Label>
              <div className="flex flex-col sm:flex-row gap-2.5 mt-1">
                <Input
                  id="claim-hub-household-code-input"
                  type="text"
                  placeholder="e.g. ABCDEF12"
                  value={lookupCode}
                  onChange={(e) => {
                    setLookupCode(e.target.value);
                    setLookupCodeError(null);
                  }}
                  busy={isVerifyingLookupCode}
                />
                <Button
                  type="submit"
                  variant="primary"
                  disabled={isVerifyingLookupCode || !lookupCode.trim()}
                >
                  {isVerifyingLookupCode ? 'Verifying...' : 'Load My Reserved Gifts'}
                </Button>
              </div>
              {lookupCodeError && (
                <p role="alert" className="mt-1.5 text-xs font-medium text-rose-800 dark:text-rose-300">
                  {lookupCodeError}
                </p>
              )}
            </FormGroup>
          </form>
        </div>
      ) : holds.length === 0 ? (
        <div className="p-6 sm:p-8 space-y-6" data-testid="claim-hub-empty-state">
          <div className="rounded-xl bg-stone-50 dark:bg-gray-900 border border-stone-200 dark:border-gray-700 p-6 text-center space-y-2">
            <SectionHeadingTag className="font-serif text-lg font-bold text-gray-900 dark:text-white">
              No Active Gift Reservations
            </SectionHeadingTag>
            <p className="text-sm text-gray-700 dark:text-gray-300 max-w-md mx-auto">
              You do not currently have any pending gift holds in this session. Browse the registry to claim a gift, or verify your household invitation code below to pull up reservations from another device.
            </p>
          </div>

          <form
            onSubmit={handleVerifyHouseholdLookup}
            className="rounded-xl bg-white dark:bg-gray-900/60 border border-stone-200 dark:border-gray-700 p-4 sm:p-5 space-y-3"
          >
            <FormGroup
              busy={isVerifyingLookupCode}
              state={lookupCodeError ? 'error' : 'default'}
              className="mb-0"
            >
              <Label htmlFor="claim-hub-empty-code-input">
                Look Up Household Reservations by Invitation Code
              </Label>
              <div className="flex flex-col sm:flex-row gap-2.5 mt-1">
                <Input
                  id="claim-hub-empty-code-input"
                  type="text"
                  placeholder="e.g. ABCDEF12"
                  value={lookupCode}
                  onChange={(e) => {
                    setLookupCode(e.target.value);
                    setLookupCodeError(null);
                  }}
                  busy={isVerifyingLookupCode}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={isVerifyingLookupCode || !lookupCode.trim()}
                >
                  {isVerifyingLookupCode ? 'Verifying...' : 'Verify Code'}
                </Button>
              </div>
              {lookupCodeError && (
                <p role="alert" className="mt-1.5 text-xs font-medium text-rose-800 dark:text-rose-300">
                  {lookupCodeError}
                </p>
              )}
            </FormGroup>
          </form>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12">
          {/* Left Column: Reserved Gifts List & Shipping Address */}
          <div className="lg:col-span-5 p-6 sm:p-7 bg-stone-50/80 dark:bg-gray-900/60 border-b lg:border-b-0 lg:border-r border-stone-200 dark:border-gray-700 space-y-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <SectionHeadingTag className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                  Your Reserved Gifts
                </SectionHeadingTag>
                <span
                  data-testid="claim-hub-hold-count-badge"
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-900/60 text-amber-950 dark:text-amber-100 border border-amber-200 dark:border-amber-700"
                >
                  {activeReservedCount} {activeReservedCount === 1 ? 'Item' : 'Items'} on Hold
                </span>
              </div>

              <div className="space-y-3" data-testid="claim-hub-holds-list">
                {holds.map((hold) => {
                  const isSelected = selectedHold?.contributorId === hold.contributorId;
                  const holdStatus = (
                    completedByHold[hold.contributorId]?.status || hold.status
                  ).toUpperCase();

                  return (
                    <button
                      key={hold.contributorId}
                      type="button"
                      aria-pressed={isSelected}
                      data-testid={`claim-hub-hold-card-${hold.contributorId}`}
                      onClick={() => {
                        setSelectedId(hold.contributorId);
                        setSubmitError(null);
                      }}
                      className={`w-full text-left rounded-xl p-4 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                        isSelected
                          ? 'bg-white dark:bg-gray-800 border-2 border-primary shadow-sm'
                          : 'bg-white/80 dark:bg-gray-800/60 border border-stone-200 dark:border-gray-700 hover:border-stone-300 dark:hover:border-gray-600'
                      }`}
                    >
                      <div className="flex items-start gap-3.5">
                        {hold.itemImageUrl && (
                          <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-stone-100 dark:bg-gray-700 shrink-0 border border-stone-200 dark:border-gray-700">
                            <MediaImage
                              media={{
                                id: `hold-img-${hold.contributorId}`,
                                url: hold.itemImageUrl,
                                altText: '',
                                isDecorative: true,
                              }}
                              fallbackAlt=""
                              className="object-cover w-full h-full"
                            />
                          </div>
                        )}
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <ContributorLifecycleBadge
                              status={holdStatus}
                              amount={hold.amount}
                            />
                            {isSelected && (
                              <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 inline-flex items-center gap-1">
                                <Icon name="Check" className="w-3.5 h-3.5" />
                                Selected
                              </span>
                            )}
                          </div>
                          <p className="font-serif text-base font-bold text-gray-900 dark:text-white leading-snug">
                            {hold.itemName}
                          </p>
                          {hold.itemDescription && (
                            <p className="text-xs text-gray-700 dark:text-gray-300 line-clamp-1">
                              {hold.itemDescription}
                            </p>
                          )}
                          <div className="flex items-center justify-between gap-2 pt-0.5">
                            <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                              {formatCurrency(hold.amount)}
                            </span>
                            {hold.isGroupGift && (
                              <span className="text-[11px] px-2 py-0.5 rounded bg-stone-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-medium">
                                Group Gift
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {showShippingAddressCard && (
              <div
                data-testid="claim-shipping-address-card"
                className="rounded-xl bg-white dark:bg-gray-800 border border-stone-200 dark:border-gray-700 p-4 text-sm space-y-2.5 shadow-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <SubCardHeadingTag className="text-xs font-bold uppercase tracking-wider text-gray-800 dark:text-gray-200 inline-flex items-center gap-1.5">
                    <Icon name="MapPin" className="w-3.5 h-3.5 text-primary shrink-0" />
                    Ship Directly to Couple
                  </SubCardHeadingTag>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="copy-shipping-address-button"
                    onClick={() => void handleCopyShippingAddress()}
                    className="inline-flex items-center gap-1.5 text-xs"
                  >
                    <Icon name={copiedAddress ? 'Check' : 'Copy'} className="w-3.5 h-3.5" />
                    {copiedAddress ? 'Address Copied!' : 'Copy Shipping Address'}
                  </Button>
                </div>
                <pre className="whitespace-pre-wrap font-sans text-xs text-gray-700 dark:text-gray-300 leading-relaxed m-0">
                  {formattedShippingText}
                </pre>
              </div>
            )}
          </div>

          {/* Right Column: Selected Gift Fulfillment Form */}
          <div className="lg:col-span-7 p-6 sm:p-8 space-y-6 bg-white dark:bg-gray-800">
            {selectedHold && (
              <>
                <div className="space-y-1.5">
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                    Fulfillment Hub
                  </p>
                  <SectionHeadingTag className="font-serif text-xl sm:text-2xl font-bold text-gray-900 dark:text-white leading-snug">
                    {`Fulfillment for Selected Gift: ${selectedHold.itemName}`}
                  </SectionHeadingTag>
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    {selectedHold.itemType === 'PHYSICAL'
                      ? "Purchase this item from the retailer below using the couple's shipping address, then record your order details to finalize the gift."
                      : 'Complete your direct payment transfer using the handle below, then confirm your gift so the couple is notified.'}
                  </p>
                </div>

                {selectedCompletion ? (
                  <div
                    role="status"
                    data-testid="guest-claim-completed"
                    className={`rounded-xl p-5 border text-sm space-y-3 ${
                      selectedCompletion.action === 'confirm'
                        ? 'bg-emerald-50 dark:bg-emerald-950 border-emerald-300 dark:border-emerald-700 text-emerald-950 dark:text-emerald-100'
                        : 'bg-slate-100 dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    {selectedCompletion.action === 'confirm' ? (
                      <p>
                        Thank you! Your gift for <strong>{selectedHold.itemName}</strong> has been marked as{' '}
                        <strong>Confirmed</strong>, and the couple has been notified.
                      </p>
                    ) : (
                      <p>
                        Your reservation for <strong>{selectedHold.itemName}</strong> has been cancelled so other wedding guests can select this gift.
                      </p>
                    )}
                    {nextReservedHold && (
                      <div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedId(nextReservedHold.contributorId);
                            setActiveActionMode('confirm');
                            setSubmitError(null);
                          }}
                        >
                          Continue to Next Reserved Gift ({nextReservedHold.itemName})
                        </Button>
                      </div>
                    )}
                  </div>
                ) : selectedStatus === 'RESERVED' ? (
                  <form
                    onSubmit={handleFormSubmit}
                    className="space-y-5"
                    data-testid="guest-claim-form"
                  >
                    {activeActionMode === 'confirm' ? (
                      <>
                        {/* Step 1: Retailer or Direct Payment Link */}
                        {isVendorUrlSafe && selectedHold.vendorUrl ? (
                          <div className="rounded-xl bg-stone-50 dark:bg-gray-900/70 border border-stone-200 dark:border-gray-700 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-start gap-3">
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary text-white text-xs font-bold shrink-0 mt-0.5">
                                1
                              </span>
                              <div>
                                <SubCardHeadingTag className="text-sm font-bold text-gray-900 dark:text-white">
                                  Purchase from Retailer
                                </SubCardHeadingTag>
                                <p className="text-xs text-gray-700 dark:text-gray-300 mt-0.5">
                                  {vendorHost
                                    ? `Opens ${vendorHost} in a new tab`
                                    : 'Opens retailer product page in a new tab'}
                                </p>
                              </div>
                            </div>
                            <AccessibleExternalLink
                              href={selectedHold.vendorUrl}
                              showIcon
                              iconClassName="w-3.5 h-3.5"
                              data-testid="claim-vendor-link"
                              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-white dark:bg-gray-800 border border-stone-300 dark:border-gray-600 text-sm font-semibold text-gray-900 dark:text-white hover:bg-stone-100 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary shrink-0"
                            >
                              Buy at Retailer Website
                            </AccessibleExternalLink>
                          </div>
                        ) : selectedHold.paymentHandle ? (
                          <div className="rounded-xl bg-amber-50 dark:bg-amber-950 border border-amber-300 dark:border-amber-700 p-4 text-xs text-amber-950 dark:text-amber-100 space-y-1.5">
                            <p className="font-semibold text-sm">
                              {selectedHold.paymentHandleType || 'Direct Transfer'}:{' '}
                              <span className="font-mono">{selectedHold.paymentHandle}</span>
                            </p>
                            {paymentDeepLink && (
                              <p>
                                <AccessibleExternalLink
                                  href={paymentDeepLink}
                                  className="underline font-semibold text-amber-950 dark:text-amber-100"
                                >
                                  Open {selectedHold.paymentHandleType || 'Payment App'}
                                </AccessibleExternalLink>
                              </p>
                            )}
                          </div>
                        ) : null}

                        {/* Step 2: Order & Tracking Details (Physical Gifts) */}
                        {selectedHold.itemType === 'PHYSICAL' && (
                          <div
                            data-testid="claim-order-tracking-fields"
                            className="rounded-xl bg-stone-50 dark:bg-gray-900/70 border border-stone-200 dark:border-gray-700 p-4 sm:p-5 space-y-4"
                          >
                            <div className="flex items-start gap-3">
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary text-white text-xs font-bold shrink-0 mt-0.5">
                                {isVendorUrlSafe && selectedHold.vendorUrl ? '2' : '1'}
                              </span>
                              <div>
                                <SubCardHeadingTag className="text-sm font-bold text-gray-900 dark:text-white">
                                  Confirm Order &amp; Tracking
                                </SubCardHeadingTag>
                                <p className="text-xs text-gray-700 dark:text-gray-300 mt-0.5">
                                  Optional — helps the couple track incoming deliveries and send thank-you notes.
                                </p>
                              </div>
                            </div>

                            <FormGroup busy={isSubmitting} className="mb-0">
                              <Label>Retailer Order Number (Optional)</Label>
                              <Input
                                type="text"
                                placeholder="e.g. #WS-88392014"
                                value={selectedInputs.retailerOrderNumber}
                                onChange={(e) =>
                                  updateSelectedInput('retailerOrderNumber', e.target.value)
                                }
                                busy={isSubmitting}
                                maxLength={120}
                              />
                            </FormGroup>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <FormGroup busy={isSubmitting} className="mb-0">
                                <Label>Shipping Carrier (Optional)</Label>
                                <Input
                                  type="text"
                                  placeholder="UPS, FedEx, USPS..."
                                  value={selectedInputs.carrier}
                                  onChange={(e) => updateSelectedInput('carrier', e.target.value)}
                                  busy={isSubmitting}
                                  maxLength={100}
                                />
                              </FormGroup>
                              <FormGroup busy={isSubmitting} className="mb-0">
                                <Label>Tracking Number (Optional)</Label>
                                <Input
                                  type="text"
                                  placeholder="e.g. 1Z999AA10123456784"
                                  value={selectedInputs.trackingNumber}
                                  onChange={(e) =>
                                    updateSelectedInput('trackingNumber', e.target.value)
                                  }
                                  busy={isSubmitting}
                                  maxLength={120}
                                />
                              </FormGroup>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
                        {isVendorUrlSafe && selectedHold.vendorUrl && (
                          <div>
                            <AccessibleExternalLink
                              href={selectedHold.vendorUrl}
                              showIcon
                              iconClassName="w-3.5 h-3.5"
                              data-testid="claim-vendor-link"
                              className="inline-flex items-center gap-1 text-primary underline text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                            >
                              View on Vendor Site
                            </AccessibleExternalLink>
                          </div>
                        )}
                        <p>
                          Changed your mind? Submit below to release your reservation on{' '}
                          <strong>{selectedHold.itemName}</strong> so other wedding guests can select this gift.
                        </p>
                      </div>
                    )}

                    {submitError && (
                      <div
                        role="alert"
                        className="rounded-lg bg-rose-50 dark:bg-rose-950 border border-rose-300 dark:border-rose-700 p-3 text-sm text-rose-900 dark:text-rose-100"
                      >
                        {submitError}
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1">
                      <Button
                        type="submit"
                        variant={activeActionMode === 'confirm' ? 'primary' : 'danger'}
                        disabled={isSubmitting}
                        data-testid="guest-claim-submit-button"
                        className="flex-1"
                      >
                        {isSubmitting
                          ? 'Updating Reservation...'
                          : activeActionMode === 'confirm'
                            ? 'Confirm Gift Sent'
                            : 'Confirm Cancellation'}
                      </Button>

                      {activeActionMode === 'confirm' && Boolean(selectedHold.cancelToken) && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={isSubmitting}
                          data-testid="guest-claim-release-button"
                          onClick={() => void executeClaimMutation('cancel')}
                        >
                          Release Reservation
                        </Button>
                      )}
                      {activeActionMode === 'cancel' && Boolean(selectedHold.confirmToken) && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={isSubmitting}
                          onClick={() => setActiveActionMode('confirm')}
                        >
                          Keep Hold &amp; Confirm Instead
                        </Button>
                      )}
                    </div>
                  </form>
                ) : (
                  <div
                    role="status"
                    data-testid="guest-claim-already-finalized"
                    className="rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 p-4 text-sm text-slate-900 dark:text-slate-100"
                  >
                    {selectedStatus === 'CONFIRMED' ? (
                      <p>
                        This gift has already been <strong>Confirmed</strong>. If you need to make changes, please reach out to the couple directly.
                      </p>
                    ) : (
                      <p>
                        This reservation is already{' '}
                        <strong>{selectedStatus === 'REFUNDED' ? 'Refunded' : 'Cancelled'}</strong> and no further action is needed.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {mode === 'page' && (
        <div className="px-6 py-4 border-t border-stone-200 dark:border-gray-700 bg-stone-50/50 dark:bg-gray-900/40 text-center">
          <Link
            href="/registry"
            className="inline-flex items-center justify-center text-sm font-semibold text-primary underline hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary rounded px-2 py-1"
          >
            Return to Wedding Registry
          </Link>
        </div>
      )}
    </div>
  );
};
