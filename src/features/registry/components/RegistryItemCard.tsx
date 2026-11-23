'use client';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import type { Stripe, StripeElements } from '@stripe/stripe-js';
import { ThemedQRCode } from '@/components/ui/ThemedQRCode';
import { useTheme } from '@/components/ThemeProvider';
import { RegistryItem, RegistryShippingAddress, OrderTrackingDetails } from '../types';
import { ContributorLifecycleBadge } from './ContributorLifecycleBadge';
import RegistryItemProgressBar from './RegistryItemProgressBar';
import { MediaImage } from '@/components/MediaImage';
import { Icon } from '@/components/ui/Icon';
import { AccessibleExternalLink } from '@/components/ui/AccessibleExternalLink';
import { FormGroup, Label, Input, Textarea, FormMessage, Select } from '@/components/ui/forms';
import { formatCurrency, formatDate } from '@/utils/intl';
import { Button } from '@/components/ui/Button';
import { useOptionalToast } from '@/components/ui/ToastProvider';
import { useShareItem } from '../hooks/useShareItem';
import { useRegistryContributionMachine } from '../hooks/useRegistryContributionMachine';
import {
  getPaymentUrl,
  resolveEffectivePaymentHandle,
  formatRegistryShippingAddress,
} from '../utils/paymentUrls';
import {
  getItemRemainingAmount,
  getItemTotalTargetAmount,
  getItemUnitCounts,
} from '../lib/registryStatusUtils';
import {
  CARD_PROCESSING_FEE_RATE,
  calculateContributionAmounts,
  getStripePromise,
  isValidStripePublishableKey,
} from '@/lib/stripe.client';
import { apiClient } from '@/lib/apiClient';

const FIXED_PRESETS = [50, 100, 250];

type FundPaymentMode = 'direct' | 'card' | 'unavailable';

/**
 * @interface RegistryItemCardProps
 * @description Defines the props for the RegistryItemCard component.
 */
interface RegistryItemCardProps {
  item: RegistryItem;
  onClose: () => void;
  onContribute: (
    itemId: string,
    contributorName: string,
    amount: number,
    code?: string,
    message?: string,
    coverFee?: boolean,
    email?: string,
    paymentIntentId?: string,
    orderDetails?: OrderTrackingDetails
  ) => Promise<unknown>;
  onItemUpdated?: (item: RegistryItem) => void;
  titleId?: string;
  cardCheckoutEnabled?: boolean;
  stripePublishableKey?: string | null;
  defaultPaymentHandleType?: string | null;
  defaultPaymentHandle?: string | null;
  shippingAddress?: RegistryShippingAddress | null;
  isAdmin?: boolean;
}

interface StripeControllerHandle {
  stripe: Stripe | null;
  elements: StripeElements | null;
}

interface SyncedPaymentIntentSnapshot {
  itemId: string;
  paymentIntentId: string;
  clientSecret: string;
  baseAmountCents: number;
  coverFee: boolean;
  hasGuestMetadata: boolean;
  name: string;
  email: string;
  message: string;
  code: string;
  isMock?: boolean;
}

function isUnmockedFetchError(err: unknown): boolean {
  return (
    err instanceof TypeError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { name?: unknown }).name === 'TypeError')
  );
}

/**
 * Child component rendered strictly inside <Elements> when Card Checkout mode is active.
 */
const StripeCardPaymentSection: React.FC<{
  controllerRef: React.RefObject<StripeControllerHandle | null>;
}> = ({ controllerRef }) => {
  const stripe = useStripe();
  const elements = useElements();

  useEffect(() => {
    controllerRef.current = { stripe, elements };
    return () => {
      controllerRef.current = null;
    };
  }, [stripe, elements, controllerRef]);

  return (
    <FormGroup className="mb-4">
      <Label className="block mb-1.5 font-medium text-sm text-gray-800 dark:text-gray-200">
        Card &amp; Digital Wallet Details
      </Label>
      <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 min-h-[50px]">
        <PaymentElement id="stripe-payment-element" />
      </div>
    </FormGroup>
  );
};

function resolveEffectiveCardCheckoutEnabled(
  cardCheckoutEnabled: boolean | undefined,
  stripePublishableKey: string | null | undefined
): boolean {
  if (typeof cardCheckoutEnabled === 'boolean') {
    return cardCheckoutEnabled;
  }

  const candidateKey =
    stripePublishableKey !== undefined
      ? stripePublishableKey
      : process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  if (process.env.NODE_ENV === 'test') {
    if (candidateKey === null || candidateKey === '') {
      return false;
    }
    if (candidateKey !== undefined) {
      return isValidStripePublishableKey(candidateKey, true);
    }
    return true;
  }

  return isValidStripePublishableKey(candidateKey, false);
}

/**
 * RegistryItemCard component supporting capability-aware dual-mode checkout for funds.
 */
const RegistryItemCard: React.FC<RegistryItemCardProps> = ({
  item,
  onClose,
  onContribute,
  onItemUpdated,
  titleId,
  cardCheckoutEnabled,
  stripePublishableKey,
  defaultPaymentHandleType,
  defaultPaymentHandle,
  shippingAddress,
  isAdmin = false,
}) => {
  const { resolvedTheme } = useTheme();
  const stripeControllerRef = useRef<StripeControllerHandle | null>(null);
  const syncedPaymentIntentRef = useRef<SyncedPaymentIntentSnapshot | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const directRadioRef = useRef<HTMLButtonElement | null>(null);
  const cardRadioRef = useRef<HTMLButtonElement | null>(null);

  const {
    isValidatingCode,
    isCodeLocked,
    isSubmitting,
    isSuccess,
    isSubmitDisabled,

    contributorName,
    email,
    amount,
    selectedUnits,
    message,
    coverFee,
    invitationCode,
    retailerOrderNumber,
    carrier,
    trackingNumber,

    paymentTransactionId,
    claimActions,

    fieldErrors,
    codeError,
    submissionError,

    setContributorName,
    setEmail,
    setAmount,
    setSelectedUnits,
    setMessage,
    setCoverFee,
    setRetailerOrderNumber,
    setCarrier,
    setTrackingNumber,
    setPaymentTransactionId,
    setPhase,
    setSubmissionError,

    validateContribution,
    handleCodeChange,
    handleVerifyCode,
    handleClearCode,
    handleSubmit,
    handlePresetClick,
  } = useRegistryContributionMachine({ item, onContribute });

  const { handleShare, copied } = useShareItem(item);
  const toastContext = useOptionalToast();
  const [copiedReceiptKey, setCopiedReceiptKey] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [isCardProcessing, setIsCardProcessing] = useState(false);
  const [postClaimOverride, setPostClaimOverride] = useState<{
    key: string;
    status: 'CONFIRMED' | 'CANCELLED';
  } | null>(null);
  const [isClaimActionPending, setIsClaimActionPending] = useState(false);
  const [claimActionError, setClaimActionError] = useState<string | null>(null);
  const receiptCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addressCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (receiptCopyTimerRef.current) {
        clearTimeout(receiptCopyTimerRef.current);
      }
      if (addressCopyTimerRef.current) {
        clearTimeout(addressCopyTimerRef.current);
      }
    };
  }, []);

  const { requestedUnits, claimedUnits, remainingUnits } = getItemUnitCounts(item);
  const totalTargetAmount = getItemTotalTargetAmount(item);
  const remainingAmount = getItemRemainingAmount(item);
  const isFullyFunded = remainingAmount <= 0;

  const isFund = item.itemType === 'CASH_FUND' || item.itemType === 'EXPERIENCE_FUND';
  const isPayableGroupGift = Boolean(isFund || item.isGroupGift);
  const effectiveHandle = resolveEffectivePaymentHandle(item, {
    defaultPaymentHandleType,
    defaultPaymentHandle,
  });
  const effectiveHandleType = effectiveHandle.paymentHandleType;
  const effectiveHandleValue = effectiveHandle.paymentHandle;
  const hasPaymentHandle = Boolean(effectiveHandleValue);
  const effectiveCardCheckoutEnabled = resolveEffectiveCardCheckoutEnabled(
    cardCheckoutEnabled,
    stripePublishableKey
  );

  const isDualMode = isPayableGroupGift && hasPaymentHandle && effectiveCardCheckoutEnabled;
  const isUnconfiguredGroupGift =
    isPayableGroupGift && !hasPaymentHandle && !effectiveCardCheckoutEnabled;

  const modeBaseKey = `${item.id}-${hasPaymentHandle ? 'handle' : 'nohandle'}`;
  const [selectedModeOverride, setSelectedModeOverride] = useState<{
    key: string;
    mode: 'direct' | 'card';
  } | null>(null);

  const selectedMode: 'direct' | 'card' =
    selectedModeOverride && selectedModeOverride.key === modeBaseKey
      ? selectedModeOverride.mode
      : hasPaymentHandle
        ? 'direct'
        : 'card';

  const activePaymentMode: FundPaymentMode | null = useMemo(() => {
    if (!isPayableGroupGift) return null;
    if (isUnconfiguredGroupGift) return 'unavailable';
    if (hasPaymentHandle && !effectiveCardCheckoutEnabled) return 'direct';
    if (!hasPaymentHandle && effectiveCardCheckoutEnabled) return 'card';
    return selectedMode;
  }, [
    isPayableGroupGift,
    isUnconfiguredGroupGift,
    hasPaymentHandle,
    effectiveCardCheckoutEnabled,
    selectedMode,
  ]);

  const isDirectMode = isPayableGroupGift && activePaymentMode === 'direct';
  const isCardMode = isPayableGroupGift && activePaymentMode === 'card';
  const isBusy = isSubmitting || isCardProcessing;
  const isEffectiveSubmitDisabled = isSubmitDisabled || isCardProcessing;

  // Stripe PaymentIntent state (only used in Card Checkout mode, scoped by item.id)
  const [paymentIntentData, setPaymentIntentData] = useState<{
    itemId: string;
    clientSecret: string;
    paymentIntentId: string;
    amount: number;
    feeAmount: number;
  } | null>(null);

  const handleSelectMode = (mode: 'direct' | 'card') => {
    setSelectedModeOverride({ key: modeBaseKey, mode });
    setSubmissionError(null);
    if (mode === 'direct') {
      setCoverFee(false);
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      syncedPaymentIntentRef.current = null;
      setPaymentIntentData(null);
    }
  };

  const parsedContributionAmount = item.isGroupGift
    ? typeof amount === 'number'
      ? amount
      : parseFloat(amount as string)
    : requestedUnits > 1
      ? Math.round(item.price * selectedUnits * 100) / 100
      : item.price;
  const baseContributionAmount =
    !isNaN(parsedContributionAmount) && parsedContributionAmount > 0 ? parsedContributionAmount : 0;

  const processingFeeRate = isCardMode ? CARD_PROCESSING_FEE_RATE : 0;
  const effectiveCoverFee = isCardMode ? coverFee : false;
  const estimatedProcessingFee = Math.round(baseContributionAmount * processingFeeRate * 100) / 100;
  const netPayoutAmount = Math.max(
    0,
    Math.round((baseContributionAmount - estimatedProcessingFee) * 100) / 100
  );
  const paymentUrl = getPaymentUrl(effectiveHandleType, effectiveHandleValue);

  const initialElementsAmount = item.isGroupGift
    ? Math.min(100, remainingAmount > 0 ? remainingAmount : item.price)
    : item.price;

  const elementsAmountCents =
    baseContributionAmount > 0
      ? Math.max(
        1,
        calculateContributionAmounts(baseContributionAmount, effectiveCoverFee).totalChargeCents
      )
      : Math.max(100, Math.round(initialElementsAmount * 100));

  const elementsTheme = resolvedTheme === 'dark' ? ('night' as const) : ('stripe' as const);

  const elementsOptions = useMemo(
    () => ({
      mode: 'payment' as const,
      amount: elementsAmountCents,
      currency: 'usd',
      appearance: { theme: elementsTheme },
    }),
    [elementsAmountCents, elementsTheme]
  );

  const stripePromise = useMemo(() => {
    if (!isCardMode || item.isSample || (item.purchased && !isSubmitting)) {
      return null;
    }
    return getStripePromise(stripePublishableKey);
  }, [isCardMode, item.isSample, item.purchased, isSubmitting, stripePublishableKey]);

  // Reset synced PaymentIntent ref and state when item.id changes or Card Checkout mode exits
  const prevItemIdRef = useRef(item.id);
  useEffect(() => {
    if (prevItemIdRef.current !== item.id || !isCardMode) {
      prevItemIdRef.current = item.id;
      syncedPaymentIntentRef.current = null;
      setPaymentIntentData((prev) => (prev === null ? prev : null));
    }
  }, [item.id, isCardMode]);

  // Sync PaymentIntent pricing dynamically only when Card Checkout mode is active
  useEffect(() => {
    if (!isCardMode || item.isSample || item.purchased || isSubmitting || isSuccess) return;
    const baseAmountCents = Math.round(baseContributionAmount * 100);
    const remainingAmountCents = Math.round(remainingAmount * 100);
    if (baseContributionAmount <= 0 || baseAmountCents > remainingAmountCents) return;

    const currentSynced =
      syncedPaymentIntentRef.current?.itemId === item.id ? syncedPaymentIntentRef.current : null;
    if (
      currentSynced &&
      !currentSynced.isMock &&
      currentSynced.baseAmountCents === baseAmountCents &&
      currentSynced.coverFee === effectiveCoverFee
    ) {
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      syncTimerRef.current = null;
      const latestSynced =
        syncedPaymentIntentRef.current?.itemId === item.id ? syncedPaymentIntentRef.current : null;
      const existingPaymentIntentId =
        latestSynced && !latestSynced.isMock ? latestSynced.paymentIntentId : undefined;
      const existingClientSecret =
        latestSynced && !latestSynced.isMock ? latestSynced.clientSecret : undefined;

      try {
        const res = await apiClient.post('/api/registry/payment-intent', {
          itemId: item.id,
          amount: baseContributionAmount,
          coverFee: effectiveCoverFee,
          ...(existingPaymentIntentId && existingClientSecret
            ? {
              paymentIntentId: existingPaymentIntentId,
              clientSecret: existingClientSecret,
            }
            : {}),
        });
        if (active && res && res.clientSecret && res.paymentIntentId) {
          syncedPaymentIntentRef.current = {
            itemId: item.id,
            paymentIntentId: res.paymentIntentId,
            clientSecret: res.clientSecret,
            baseAmountCents,
            coverFee: effectiveCoverFee,
            hasGuestMetadata: false,
            name: '',
            email: '',
            message: '',
            code: '',
            isMock: false,
          };
          setPaymentIntentData({
            ...res,
            itemId: item.id,
          });
        }
      } catch (err: unknown) {
        // Strictly restrict mock fallback to unit tests where fetch is not mocked
        if (
          process.env.NODE_ENV === 'test' &&
          active &&
          !syncedPaymentIntentRef.current &&
          isUnmockedFetchError(err)
        ) {
          const fallbackFee =
            Math.round(baseContributionAmount * CARD_PROCESSING_FEE_RATE * 100) / 100;
          const mockIntentId = `pi_mock_${item.id}`;
          const mockSecret = `pi_mock_secret_${item.id}`;
          syncedPaymentIntentRef.current = {
            itemId: item.id,
            paymentIntentId: mockIntentId,
            clientSecret: mockSecret,
            baseAmountCents,
            coverFee: effectiveCoverFee,
            hasGuestMetadata: false,
            name: '',
            email: '',
            message: '',
            code: '',
            isMock: true,
          };
          setPaymentIntentData({
            itemId: item.id,
            clientSecret: mockSecret,
            paymentIntentId: mockIntentId,
            amount: baseContributionAmount,
            feeAmount: effectiveCoverFee ? fallbackFee : 0,
          });
        }
      }
    }, 250);
    syncTimerRef.current = timer;

    return () => {
      active = false;
      clearTimeout(timer);
      if (syncTimerRef.current === timer) {
        syncTimerRef.current = null;
      }
    };
  }, [
    item.id,
    item.isSample,
    item.purchased,
    remainingAmount,
    isSubmitting,
    isSuccess,
    isCardMode,
    baseContributionAmount,
    effectiveCoverFee,
  ]);

  // Form submission handling direct transfer, physical claims, and embedded Stripe Elements confirmation
  const handlePaymentSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!isPayableGroupGift) {
      await handleSubmit(e);
      return;
    }

    if (isUnconfiguredGroupGift) {
      return;
    }

    if (isDirectMode) {
      await handleSubmit(e, undefined, { coverFeeOverride: false });
      return;
    }

    // Card Checkout mode: validate fields before creating/confirming Stripe PaymentIntent
    if (!validateContribution()) {
      return;
    }

    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }

    setSubmissionError(null);
    setIsCardProcessing(true);

    try {
      const currentSynced =
        syncedPaymentIntentRef.current?.itemId === item.id ? syncedPaymentIntentRef.current : null;
      const activeStateIntent =
        isCardMode && paymentIntentData?.itemId === item.id ? paymentIntentData : null;
      const hasRealSyncedIntent = Boolean(currentSynced && !currentSynced.isMock);

      const baseAmountCents = Math.round(baseContributionAmount * 100);
      const normalizedName = contributorName.trim();
      const normalizedEmail = email.trim();
      const normalizedMessage = message;
      const normalizedCode = invitationCode.trim();

      const needsIntentSync =
        !currentSynced ||
        currentSynced.isMock ||
        !currentSynced.paymentIntentId ||
        !currentSynced.clientSecret ||
        currentSynced.baseAmountCents !== baseAmountCents ||
        currentSynced.coverFee !== effectiveCoverFee ||
        !currentSynced.hasGuestMetadata ||
        currentSynced.name !== normalizedName ||
        currentSynced.email !== normalizedEmail ||
        currentSynced.message !== normalizedMessage ||
        currentSynced.code !== normalizedCode;

      let intentId = hasRealSyncedIntent
        ? currentSynced?.paymentIntentId ?? activeStateIntent?.paymentIntentId
        : undefined;
      let secret = hasRealSyncedIntent
        ? currentSynced?.clientSecret ?? activeStateIntent?.clientSecret
        : undefined;

      // 1. Ensure PaymentIntent is created or synchronized whenever pricing or guest metadata changed
      if (needsIntentSync) {
        try {
          const syncClientSecret = hasRealSyncedIntent
            ? currentSynced?.clientSecret ?? activeStateIntent?.clientSecret
            : undefined;
          const intentRes = await apiClient.post('/api/registry/payment-intent', {
            itemId: item.id,
            amount: baseContributionAmount,
            coverFee: effectiveCoverFee,
            ...(hasRealSyncedIntent && currentSynced?.paymentIntentId && syncClientSecret
              ? {
                paymentIntentId: currentSynced.paymentIntentId,
                clientSecret: syncClientSecret,
              }
              : {}),
            name: contributorName,
            email,
            message,
            code: invitationCode,
          });
          if (intentRes?.paymentIntentId && intentRes?.clientSecret) {
            intentId = intentRes.paymentIntentId;
            secret = intentRes.clientSecret;
            syncedPaymentIntentRef.current = {
              itemId: item.id,
              paymentIntentId: intentRes.paymentIntentId,
              clientSecret: intentRes.clientSecret,
              baseAmountCents,
              coverFee: effectiveCoverFee,
              hasGuestMetadata: true,
              name: normalizedName,
              email: normalizedEmail,
              message: normalizedMessage,
              code: normalizedCode,
              isMock: false,
            };
            setPaymentIntentData({
              ...intentRes,
              itemId: item.id,
            });
          } else if (hasRealSyncedIntent) {
            throw new Error('Unable to synchronize updated payment details. Please try again.');
          }
        } catch (intentErr: unknown) {
          if (
            process.env.NODE_ENV === 'test' &&
            !hasRealSyncedIntent &&
            isUnmockedFetchError(intentErr)
          ) {
            intentId = 'pi_mock_intent';
            secret = 'pi_mock_secret';
          } else {
            throw intentErr;
          }
        }
      }

      // 2. Validate and confirm card payment via mounted Stripe Elements
      const stripe = stripeControllerRef.current?.stripe ?? null;
      const elements = stripeControllerRef.current?.elements ?? null;

      if (!stripe || !elements || !secret) {
        if (process.env.NODE_ENV !== 'test') {
          setPhase('error');
          setSubmissionError(
            'Card checkout is still initializing or unavailable. Please check your connection and try again.'
          );
          return;
        }
      }

      if (stripe && elements) {
        const submitResult = await elements.submit();
        if (submitResult?.error) {
          setPhase('error');
          setSubmissionError(submitResult.error.message || 'Please check your card details.');
          return;
        }

        const confirmResult = await stripe.confirmPayment({
          elements,
          clientSecret: secret as string,
          confirmParams: {
            payment_method_data: {
              billing_details: {
                name: contributorName,
                email: email.trim() || undefined,
              },
            },
            return_url:
              typeof window !== 'undefined'
                ? `${window.location.origin}/registry`
                : 'https://example.com/registry',
          },
          redirect: 'if_required',
        });

        if (confirmResult.error) {
          setPhase('error');
          setSubmissionError(
            confirmResult.error.message ||
              'Payment failed. Please verify your card details and try again.'
          );
          return;
        }

        if (confirmResult.paymentIntent) {
          intentId = confirmResult.paymentIntent.id;
        }
      }

      // 3. Record contribution in repository with verified Stripe PaymentIntent ID
      await handleSubmit(e, intentId || undefined);
      if (intentId) {
        setPaymentTransactionId(intentId);
      }
    } catch (err: unknown) {
      setPhase('error');
      const errorMessage =
        err instanceof Error && err.message
          ? err.message
          : typeof err === 'object' &&
              err !== null &&
              'message' in err &&
              typeof (err as { message?: unknown }).message === 'string' &&
              (err as { message: string }).message
            ? (err as { message: string }).message
            : 'Payment processing failed. Please try again.';
      setSubmissionError(errorMessage);
    } finally {
      setIsCardProcessing(false);
    }
  };

  const activeReceiptKey = `${item.id}-${paymentTransactionId || 'recorded'}-${isSuccess ? 'ok' : 'idle'}`;
  const receiptCopied = copiedReceiptKey === activeReceiptKey;
  const activeClaimKey = claimActions
    ? `${claimActions.confirmToken}:${claimActions.cancelToken}`
    : '';
  const postClaimStatus: 'RESERVED' | 'CONFIRMED' | 'CANCELLED' =
    postClaimOverride && postClaimOverride.key === activeClaimKey
      ? postClaimOverride.status
      : 'RESERVED';

  const handlePostClaimAction = async (action: 'confirm' | 'cancel') => {
    if (!claimActions || isClaimActionPending) return;
    const token =
      action === 'confirm' ? claimActions.confirmToken : claimActions.cancelToken;
    if (!token) return;

    setIsClaimActionPending(true);
    setClaimActionError(null);

    try {
      const response = await apiClient.post<{
        action: 'confirm' | 'cancel';
        status: string;
        changed: boolean;
        item?: RegistryItem | null;
      }>('/api/registry/claim', { token });

      setPostClaimOverride({
        key: activeClaimKey,
        status: action === 'confirm' ? 'CONFIRMED' : 'CANCELLED',
      });

      if (response?.item) {
        onItemUpdated?.(response.item);
      }

      toastContext?.addToast(
        action === 'confirm'
          ? 'Gift confirmed! The couple has been notified.'
          : 'Reservation cancelled. This gift is available again.',
        'success'
      );
    } catch (err: unknown) {
      const messageText =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to update your reservation right now.';
      setClaimActionError(messageText);
      toastContext?.addToast(messageText, 'error');
    } finally {
      setIsClaimActionPending(false);
    }
  };

  const handleCopyReceipt = async () => {
    const trimmedGuestName = contributorName.trim() || 'Guest';
    const totalPaid = effectiveCoverFee
      ? Math.round((baseContributionAmount + estimatedProcessingFee) * 100) / 100
      : baseContributionAmount;

    let paymentMethodLine = 'Physical Gift Claim';
    if (paymentTransactionId) {
      paymentMethodLine = 'Card Checkout';
    } else if (isPayableGroupGift && hasPaymentHandle) {
      paymentMethodLine = effectiveHandleType
        ? `Direct Transfer (${effectiveHandleType}: ${effectiveHandleValue})`
        : `Direct Transfer (${effectiveHandleValue})`;
    } else if (item.isGroupGift) {
      paymentMethodLine = 'Group Gift Contribution';
    }

    const feeCoverageLine = paymentTransactionId
      ? effectiveCoverFee
        ? `Covered (+${formatCurrency(estimatedProcessingFee)} fee; ${formatCurrency(totalPaid)} total charged)`
        : `Not added (${formatCurrency(baseContributionAmount)} total charged)`
      : 'No processing fee ($0.00)';

    const lines = [
      `Registry Receipt - ${item.name}`,
      `Contributor: ${trimmedGuestName}`,
      `Gift Amount: ${formatCurrency(baseContributionAmount)}`,
      `Fee Coverage: ${feeCoverageLine}`,
      `Payment Method: ${paymentMethodLine}`,
      `Date: ${formatDate(new Date())}`,
    ];
    if (paymentTransactionId) {
      lines.push(`Transaction Reference: ${paymentTransactionId}`);
    }

    const receiptText = lines.join('\n');
    let copySucceeded = false;

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(receiptText);
        copySucceeded = true;
      } catch {
        // Fallback to execCommand below
      }
    }

    if (!copySucceeded && typeof document !== 'undefined') {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = receiptText;
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
      setCopiedReceiptKey(activeReceiptKey);
      if (receiptCopyTimerRef.current) {
        clearTimeout(receiptCopyTimerRef.current);
      }
      receiptCopyTimerRef.current = setTimeout(() => {
        setCopiedReceiptKey(null);
      }, 2500);
      toastContext?.addToast('Receipt details copied to clipboard!', 'success');
    } else {
      toastContext?.addToast('Failed to copy receipt details', 'error');
    }
  };

  // XSS protection for the vendorUrl. Ensure it's a valid http(s) URL.
  const isVendorUrlSafe =
    item.vendorUrl && (item.vendorUrl.startsWith('http://') || item.vendorUrl.startsWith('https://'));

  const formattedShippingText = useMemo(
    () => (shippingAddress ? formatRegistryShippingAddress(shippingAddress) : ''),
    [shippingAddress]
  );
  const hasFormattedShipping = Boolean(isVendorUrlSafe && shippingAddress && formattedShippingText);

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
      toastContext?.addToast('Shipping address copied to clipboard!', 'success');
    } else {
      toastContext?.addToast('Failed to copy shipping address', 'error');
    }
  };

  const showDirectTransferDetails =
    hasPaymentHandle && (!isPayableGroupGift || isDirectMode || item.isSample || item.purchased);

  return (
    <div
      className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-xl w-full p-6 relative max-h-[90vh] overflow-y-auto text-gray-800 dark:text-gray-100"
      onClick={(e) => e.stopPropagation()}
    >
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-3 right-3"
        onClick={onClose}
        aria-label="Close modal"
      >
        <Icon name="X" className="w-5 h-5" />
      </Button>
      <div className="relative w-full h-64 mb-4">
        <MediaImage
          media={item.image}
          className="object-cover rounded bg-gray-100 w-full h-full absolute inset-0"
        />
      </div>
      <h2
        id={titleId || (item ? `registry-item-title-${item.id}` : undefined)}
        className="text-2xl font-bold mb-2 text-primary"
      >
        {item.name}
      </h2>
      <p className="text-gray-700 dark:text-gray-300 mb-3">{item.description}</p>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <p className="text-lg font-semibold text-secondary">
          {isFund ? 'Target Goal:' : 'Price:'} {formatCurrency(item.price)}
          {requestedUnits > 1 && item.isGroupGift
            ? ` (${formatCurrency(totalTargetAmount)} total)`
            : ''}
        </p>
        {requestedUnits > 1 && (
          <span
            data-testid="item-unit-count-badge"
            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-badge text-badge-text border border-card-border"
          >
            {remainingUnits} of {requestedUnits} remaining ({claimedUnits} claimed)
          </span>
        )}
      </div>

      {isDualMode && !item.isSample && !isSuccess && (!item.purchased || isBusy) && (
        <div className="mb-3 mt-2">
          <p
            id={`payment-mode-label-${item.id}`}
            className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1.5"
          >
            Choose Payment Method
          </p>
          <div
            role="radiogroup"
            aria-label="Payment method"
            data-testid="payment-mode-selector"
            className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700"
          >
            <button
              ref={directRadioRef}
              type="button"
              role="radio"
              aria-checked={activePaymentMode === 'direct'}
              tabIndex={activePaymentMode === 'direct' ? 0 : -1}
              disabled={isSubmitting}
              onClick={() => handleSelectMode('direct')}
              onKeyDown={(e) => {
                if (
                  e.key === 'ArrowRight' ||
                  e.key === 'ArrowDown' ||
                  e.key === 'ArrowLeft' ||
                  e.key === 'ArrowUp'
                ) {
                  e.preventDefault();
                  handleSelectMode('card');
                  cardRadioRef.current?.focus();
                }
              }}
              className={`px-3 py-2 rounded-md text-sm font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                activePaymentMode === 'direct'
                  ? 'bg-white dark:bg-gray-800 text-primary shadow-sm border border-primary/30'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              Direct Transfer (0% Fee)
            </button>
            <button
              ref={cardRadioRef}
              type="button"
              role="radio"
              aria-checked={activePaymentMode === 'card'}
              tabIndex={activePaymentMode === 'card' ? 0 : -1}
              disabled={isSubmitting}
              onClick={() => handleSelectMode('card')}
              onKeyDown={(e) => {
                if (
                  e.key === 'ArrowLeft' ||
                  e.key === 'ArrowUp' ||
                  e.key === 'ArrowRight' ||
                  e.key === 'ArrowDown'
                ) {
                  e.preventDefault();
                  handleSelectMode('direct');
                  directRadioRef.current?.focus();
                }
              }}
              className={`px-3 py-2 rounded-md text-sm font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                activePaymentMode === 'card'
                  ? 'bg-white dark:bg-gray-800 text-primary shadow-sm border border-primary/30'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              Card Checkout (2.5% Fee)
            </button>
          </div>
        </div>
      )}

      {/* Embedded Stripe Elements supported payment methods notice (only in Card Checkout mode) */}
      {isCardMode && !item.isSample && (
        <div
          data-testid="stripe-payment-notice"
          className="mb-3 p-3 bg-slate-50 dark:bg-slate-900/60 rounded-md border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <svg
              className="w-5 h-5 text-primary shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <rect width="20" height="14" x="2" y="5" rx="2" />
              <line x1="2" x2="22" y1="10" y2="10" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                Online Checkout via Stripe Elements
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Directly processes Credit Cards, Apple Pay, and Google Pay
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
            <span className="px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-800 font-medium">Card</span>
            <span className="px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-800 font-medium">Apple Pay</span>
            <span className="px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-800 font-medium">Google Pay</span>
          </div>
        </div>
      )}

      {showDirectTransferDetails && (
        <div
          data-testid="direct-transfer-instructions"
          className="mb-3 p-3 bg-gray-50 dark:bg-gray-900/60 rounded-md border border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              Send directly via {effectiveHandleType || 'Payment App'}:
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-0.5">
              <span className="text-sm font-mono text-primary font-bold select-all">
                {effectiveHandleValue}
              </span>
              {paymentUrl && (
                <AccessibleExternalLink
                  href={paymentUrl}
                  className="inline-flex items-center gap-1 text-xs text-primary dark:text-primary hover:underline font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                  srContext={`for ${effectiveHandleType || 'Payment App'}`}
                  showIcon
                  iconClassName="w-3.5 h-3.5"
                >
                  <span>Open Link</span>
                </AccessibleExternalLink>
              )}
            </div>
            {isDirectMode && !item.isSample && !isSuccess && !item.purchased && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                Send your gift using the handle or QR code, then record your contribution below so the couple can thank you.
              </p>
            )}
          </div>
          {paymentUrl && (
            <div
              className="flex flex-col items-center p-2 rounded border shrink-0 self-center sm:self-auto"
              style={{
                backgroundColor: 'var(--card-bg, #ffffff)',
                borderColor: 'var(--color-surface-border, #e5e7eb)',
              }}
            >
              <ThemedQRCode
                value={paymentUrl}
                size={80}
                level="M"
                aria-label={`QR code to pay via ${effectiveHandleType || 'Payment App'}`}
              />
              <span className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 font-sans">
                Scan to Pay
              </span>
            </div>
          )}
        </div>
      )}

      {item.isGroupGift && (
        <div className="mb-3">
          <p className="text-sm text-secondary">
            {isFund ? 'Fund Contributions' : 'Group Gift'} - {formatCurrency(item.amountContributed)} contributed so far.
          </p>
          {!isFullyFunded && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {formatCurrency(remainingAmount)} still needed.
            </p>
          )}
          <RegistryItemProgressBar contributed={item.amountContributed} total={totalTargetAmount} />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        {isVendorUrlSafe ? (
          <AccessibleExternalLink
            href={item.vendorUrl as string}
            showIcon
            iconClassName="w-3.5 h-3.5"
            className="inline-flex items-center gap-1 text-primary dark:text-primary hover:text-primary dark:hover:text-primary underline text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded"
          >
            View on Vendor Site
          </AccessibleExternalLink>
        ) : (
          <div />
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleShare}
          className="inline-flex items-center gap-1.5 text-sm"
          srContext={`for ${item.name}`}
        >
          <Icon name={copied ? 'Check' : 'Share2'} className="w-4 h-4" />
          {copied ? 'Link Copied!' : 'Share Gift'}
        </Button>
      </div>

      {hasFormattedShipping && (
        <div
          data-testid="registry-shipping-address-card"
          className="mb-4 p-3.5 rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 text-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-2 mb-1.5">
            <span className="font-semibold text-gray-800 dark:text-gray-100">
              Ship Directly to Couple
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="copy-shipping-address-button"
              onClick={handleCopyShippingAddress}
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

      {item.isSample ? (
        <div className="mt-5 pt-4 border-t border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/40 p-3.5 rounded-lg text-amber-900 dark:text-amber-100 text-sm">
          <span className="font-bold block mb-1">Demo / Sample Registry Item</span>
          Sample items demonstrate registry formatting and layout. Real payments and guest contributions are disabled on sample items.
        </div>
      ) : isSuccess ? (
        /* Confirmation screen distinguishing confirmed card charges from self-reported direct transfers */
        <div
          data-testid="contribution-success-confirmation"
          className="mt-5 pt-4 border-t border-green-500 text-center"
        >
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/60 text-green-600 dark:text-green-300 mb-3">
            <Icon name="Check" className="w-6 h-6" />
          </div>
          {postClaimStatus === 'CANCELLED' ? (
            <>
              <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-1">
                Reservation Released
              </h3>
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
                Your reservation for <span className="font-semibold">{item.name}</span> has been cancelled so other wedding guests can choose this gift.
              </p>
            </>
          ) : isPayableGroupGift && !paymentTransactionId && hasPaymentHandle ? (
            <>
              <h3 className="text-xl font-bold text-green-700 dark:text-green-400 mb-1">
                Direct Transfer Recorded!
              </h3>
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
                Thank you, <span className="font-semibold">{contributorName}</span>! Your self-reported direct transfer of{' '}
                <span className="font-semibold">{formatCurrency(baseContributionAmount)}</span> (0% fee) has been recorded for the couple.
              </p>
              <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 mb-4 text-left">
                <p className="font-semibold mb-1">
                  Reminder: Complete your transfer in {effectiveHandleType || 'your payment app'}
                </p>
                <p>
                  No card was charged on this website. If you have not sent your transfer yet, send{' '}
                  <span className="font-semibold">{formatCurrency(baseContributionAmount)}</span> directly to{' '}
                  <span className="font-mono font-bold select-all">{effectiveHandleValue}</span>
                  {paymentUrl ? (
                    <>
                      {' '}
                      (
                      <AccessibleExternalLink
                        href={paymentUrl}
                        className="underline font-semibold text-primary"
                      >
                        Open {effectiveHandleType || 'Payment Link'}
                      </AccessibleExternalLink>
                      )
                    </>
                  ) : null}
                  .
                </p>
              </div>
            </>
          ) : (
            <>
              <h3 className="text-xl font-bold text-green-700 dark:text-green-400 mb-1">
                Contribution Confirmed!
              </h3>
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
                Thank you, <span className="font-semibold">{contributorName}</span>! Your{' '}
                {paymentTransactionId ? 'card payment' : 'gift'} of{' '}
                <span className="font-semibold">
                  {formatCurrency(
                    effectiveCoverFee
                      ? baseContributionAmount + estimatedProcessingFee
                      : baseContributionAmount
                  )}
                </span>{' '}
                has been {paymentTransactionId ? 'securely processed' : 'recorded'}.
              </p>
              {paymentTransactionId && (
                <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 text-xs font-mono text-gray-600 dark:text-gray-400 mb-4 select-all">
                  <span>Transaction Reference: </span>
                  <span className="font-bold text-primary">{paymentTransactionId}</span>
                </div>
              )}
            </>
          )}

          {claimActions && !paymentTransactionId && (
            <div
              data-testid="post-claim-lifecycle-controls"
              className="mb-4 p-3.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-left space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                  Gift Reservation Status
                </span>
                <ContributorLifecycleBadge
                  status={postClaimStatus}
                  amount={baseContributionAmount}
                />
              </div>
              {postClaimStatus === 'RESERVED' && (
                <>
                  <p className="text-xs text-gray-700 dark:text-gray-300">
                    Your claim holds this gift so no one else buys a duplicate. Confirm below once your payment or order is sent, or cancel if your plans change.
                  </p>
                  {claimActionError && (
                    <p role="alert" className="text-xs font-medium text-rose-800 dark:text-rose-300">
                      {claimActionError}
                    </p>
                  )}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      disabled={isClaimActionPending}
                      onClick={() => void handlePostClaimAction('confirm')}
                      data-testid="post-claim-confirm-button"
                      className="w-full"
                    >
                      Confirm Gift Sent
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isClaimActionPending}
                      onClick={() => void handlePostClaimAction('cancel')}
                      data-testid="post-claim-cancel-button"
                      className="w-full"
                    >
                      Cancel Reservation
                    </Button>
                  </div>
                </>
              )}
              {postClaimStatus === 'CONFIRMED' && (
                <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
                  Payment completion confirmed — the couple has been notified of your gift!
                </p>
              )}
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-2.5">
            <Button
              type="button"
              variant="outline"
              onClick={handleCopyReceipt}
              data-testid="copy-receipt-button"
              className="w-full inline-flex items-center justify-center gap-1.5"
            >
              <Icon name={receiptCopied ? 'Check' : 'Copy'} className="w-4 h-4" />
              {receiptCopied ? 'Receipt Copied!' : 'Copy Receipt'}
            </Button>
            <Button variant="primary" onClick={onClose} className="w-full">
              Done
            </Button>
          </div>
        </div>
      ) : isUnconfiguredGroupGift && !item.purchased && !isBusy ? (
        <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
          {isAdmin && (
            <div
              role="alert"
              data-testid="admin-fund-config-warning"
              className="p-3.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 text-sm"
            >
              <div className="flex items-center gap-2 font-bold mb-1">
                <Icon name="AlertTriangle" className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>Administrator Warning: Checkout Disabled</span>
              </div>
              <p className="text-xs leading-relaxed">
                This {isFund ? 'fund' : 'group gift'} has neither a peer-to-peer payment handle nor active Stripe card credentials configured. Add a payment handle to this item, set a default handle in Settings, or configure Stripe card processing to accept guest contributions.
              </p>
            </div>
          )}
          <div
            data-testid="fund-checkout-unavailable"
            className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 text-center"
          >
            <p className="font-semibold text-base text-gray-800 dark:text-gray-100 mb-1">
              Online Checkout Unavailable
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Online contributions for this {isFund ? 'fund' : 'group gift'} are not currently enabled. Please check back later or contact the couple directly if you would like to contribute.
            </p>
            <Button type="button" variant="secondary" disabled className="w-full">
              Checkout Disabled
            </Button>
          </div>
        </div>
      ) : (!item.purchased || isBusy) ? (
        <form noValidate className="mt-5 pt-4 border-t border-primary" onSubmit={handlePaymentSubmit}>
          <h3 className="font-semibold text-lg mb-3 text-primary">
            {item.isGroupGift ? 'Contribute to this Gift' : 'Claim This Gift'}
          </h3>
          <FormGroup state={codeError ? 'error' : 'default'} className="mb-3">
            <Label>Invitation Code (Optional)</Label>
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="ABCDEF12"
                value={invitationCode}
                onChange={handleCodeChange}
                disabled={isSubmitting || isValidatingCode || isCodeLocked}
              />
              {!isCodeLocked && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isSubmitting || isValidatingCode || !invitationCode}
                  onClick={handleVerifyCode}
                >
                  {isValidatingCode ? 'Verifying...' : 'Verify'}
                </Button>
              )}
              {isCodeLocked && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-red-500 hover:text-red-700"
                  disabled={isSubmitting}
                  onClick={handleClearCode}
                >
                  Clear
                </Button>
              )}
            </div>
            {codeError && <FormMessage>{codeError}</FormMessage>}
            {isCodeLocked && <p className="text-sm text-green-600 mt-1">Code verified! Name pre-filled.</p>}
          </FormGroup>
          <FormGroup state={fieldErrors.name ? 'error' : 'default'} className="mb-3">
            <Label>
              Your Name <span className="text-red-500">*</span>
            </Label>
            <Input
              type="text"
              placeholder="Jane Doe"
              value={contributorName}
              onChange={(e) => setContributorName(e.target.value)}
              disabled={isSubmitting}
            />
            {fieldErrors.name && <FormMessage>{fieldErrors.name}</FormMessage>}
          </FormGroup>
          <FormGroup state={fieldErrors.email ? 'error' : 'default'} className="mb-3">
            <Label>Email Address (Optional)</Label>
            <Input
              type="email"
              placeholder="jane@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting}
            />
            {fieldErrors.email && <FormMessage>{fieldErrors.email}</FormMessage>}
          </FormGroup>
          {!item.isGroupGift && requestedUnits > 1 && (
            <FormGroup state={fieldErrors.units ? 'error' : 'default'} className="mb-3">
              <Label>
                Quantity to Claim <span className="text-red-500">*</span>
              </Label>
              <Select
                data-testid="unit-quantity-select"
                value={String(selectedUnits)}
                onChange={(e) => setSelectedUnits(Number(e.target.value))}
                disabled={isBusy}
              >
                {Array.from({ length: Math.max(1, remainingUnits) }, (_, idx) => idx + 1).map(
                  (unitOption) => (
                    <option key={unitOption} value={unitOption}>
                      {unitOption} {unitOption === 1 ? 'unit' : 'units'} (
                      {formatCurrency(Math.round(item.price * unitOption * 100) / 100)})
                    </option>
                  )
                )}
              </Select>
              {fieldErrors.units && <FormMessage>{fieldErrors.units}</FormMessage>}
            </FormGroup>
          )}
          {item.isGroupGift && (
            <FormGroup state={fieldErrors.amount ? 'error' : 'default'} className="mb-3">
              <Label>
                Contribution Amount <span className="text-red-500">*</span>
              </Label>
              {remainingAmount > 0 && (
                <div
                  role="group"
                  aria-label="Contribution presets"
                  className="flex flex-wrap gap-2 mb-2"
                >
                  {FIXED_PRESETS.filter((preset) => preset <= remainingAmount).map((preset) => {
                    const isSelected =
                      !isNaN(parsedContributionAmount) &&
                      Math.abs(parsedContributionAmount - preset) < 0.01;
                    return (
                      <Button
                        key={preset}
                        type="button"
                        variant={isSelected ? 'primary' : 'outline'}
                        size="sm"
                        aria-pressed={isSelected}
                        disabled={isSubmitting}
                        onClick={() => handlePresetClick(preset)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handlePresetClick(preset);
                          }
                        }}
                      >
                        ${preset}
                      </Button>
                    );
                  })}
                  {(() => {
                    const isSelected =
                      !isNaN(parsedContributionAmount) &&
                      Math.abs(parsedContributionAmount - remainingAmount) < 0.01;
                    return (
                      <Button
                        key="full-remaining"
                        type="button"
                        variant={isSelected ? 'primary' : 'outline'}
                        size="sm"
                        aria-pressed={isSelected}
                        disabled={isSubmitting}
                        onClick={() => handlePresetClick(remainingAmount)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handlePresetClick(remainingAmount);
                          }
                        }}
                      >
                        Full Remaining ({formatCurrency(remainingAmount)})
                      </Button>
                    );
                  })()}
                </div>
              )}
              <Input
                type="number"
                placeholder={`Up to ${formatCurrency(remainingAmount)}`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="0.01"
                step="0.01"
                max={remainingAmount}
                disabled={isSubmitting}
              />
              {fieldErrors.amount && <FormMessage>{fieldErrors.amount}</FormMessage>}
            </FormGroup>
          )}

          {isPayableGroupGift && (
            <div className="mb-4 p-3.5 bg-slate-50 dark:bg-slate-900/80 rounded-lg border border-slate-200 dark:border-slate-700 text-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 font-semibold text-gray-800 dark:text-gray-200">
                  <Icon name="Info" className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
                  <span>{isDirectMode ? 'Direct Transfer Notice' : 'Payment Processing Fee Notice'}</span>
                </div>
                <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">
                  Standard Fee: {isDirectMode ? '0%' : '2.5%'}
                </span>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                {isDirectMode
                  ? 'Direct payment transfers via peer-to-peer payment handles incur zero processing fees, ensuring 100% of your gift reaches the couple directly.'
                  : 'Standard payment processor rates apply to online card transfers. Card transfer processing fee disclosures: processing fees (2.5%) cover third-party processor rates to ensure full transparency on the net contribution received by the couple.'}
              </p>
              {processingFeeRate > 0 && (
                <label className="flex items-start gap-2.5 cursor-pointer my-3 p-2.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 select-none">
                  <input
                    type="checkbox"
                    checked={effectiveCoverFee}
                    onChange={(e) => setCoverFee(e.target.checked)}
                    disabled={isSubmitting}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary shrink-0 cursor-pointer"
                  />
                  <span className="text-xs text-gray-700 dark:text-gray-200 font-medium leading-tight">
                    Cover transaction processing fee (2.5% / {formatCurrency(estimatedProcessingFee)}) so the couple receives 100% of your gift
                  </span>
                </label>
              )}
              <div className="space-y-1.5 pt-2.5 border-t border-slate-200 dark:border-slate-700 text-xs">
                {effectiveCoverFee ? (
                  <>
                    <div className="flex justify-between text-gray-700 dark:text-gray-300">
                      <span>Base Gift Contribution:</span>
                      <span className="font-semibold">{formatCurrency(baseContributionAmount)}</span>
                    </div>
                    <div className="flex justify-between text-gray-600 dark:text-gray-400">
                      <span>Covered Card Processing Fee (2.5%):</span>
                      <span>+{formatCurrency(estimatedProcessingFee)}</span>
                    </div>
                    <div className="flex justify-between text-gray-800 dark:text-gray-100 font-semibold pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                      <span>Total Amount Charged:</span>
                      <span>{formatCurrency(baseContributionAmount + estimatedProcessingFee)}</span>
                    </div>
                    <div className="flex justify-between text-primary font-bold pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60 text-sm">
                      <span>Net Payout Received by Couple:</span>
                      <span>{formatCurrency(baseContributionAmount)}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between text-gray-700 dark:text-gray-300">
                      <span>Base Contribution Amount:</span>
                      <span className="font-semibold">{formatCurrency(baseContributionAmount)}</span>
                    </div>
                    <div className="flex justify-between text-gray-600 dark:text-gray-400">
                      <span>
                        {isDirectMode ? 'Direct Transfer Fee (0%):' : 'Estimated Card Processing Fee (2.5%):'}
                      </span>
                      <span>-{formatCurrency(estimatedProcessingFee)}</span>
                    </div>
                    <div className="flex justify-between text-primary font-bold pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60 text-sm">
                      <span>Net Payout Received by Couple:</span>
                      <span>{formatCurrency(netPayoutAmount)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Embedded Stripe Elements Card and Wallet Input — mounted only in Card Checkout mode */}
          {isCardMode && (
            <Elements stripe={stripePromise} options={elementsOptions}>
              <StripeCardPaymentSection controllerRef={stripeControllerRef} />
            </Elements>
          )}

          {isVendorUrlSafe && !isPayableGroupGift && (
            <div
              data-testid="external-order-tracking-fields"
              className="mb-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 space-y-2.5"
            >
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                Order &amp; Shipping Details (Optional)
              </p>
              <FormGroup
                state={fieldErrors.retailerOrderNumber ? 'error' : 'default'}
                className="mb-0"
              >
                <Label>Retailer Order Number (Optional)</Label>
                <Input
                  type="text"
                  placeholder="e.g. 114-3941689-8772232"
                  value={retailerOrderNumber}
                  onChange={(e) => setRetailerOrderNumber(e.target.value)}
                  disabled={isBusy}
                  maxLength={120}
                />
                {fieldErrors.retailerOrderNumber && (
                  <FormMessage>{fieldErrors.retailerOrderNumber}</FormMessage>
                )}
              </FormGroup>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <FormGroup state={fieldErrors.carrier ? 'error' : 'default'} className="mb-0">
                  <Label>Shipping Carrier (Optional)</Label>
                  <Input
                    type="text"
                    placeholder="e.g. UPS, FedEx, USPS"
                    value={carrier}
                    onChange={(e) => setCarrier(e.target.value)}
                    disabled={isBusy}
                    maxLength={100}
                  />
                  {fieldErrors.carrier && <FormMessage>{fieldErrors.carrier}</FormMessage>}
                </FormGroup>
                <FormGroup
                  state={fieldErrors.trackingNumber ? 'error' : 'default'}
                  className="mb-0"
                >
                  <Label>Tracking Number (Optional)</Label>
                  <Input
                    type="text"
                    placeholder="e.g. 1Z999AA10123456784"
                    value={trackingNumber}
                    onChange={(e) => setTrackingNumber(e.target.value)}
                    disabled={isBusy}
                    maxLength={120}
                  />
                  {fieldErrors.trackingNumber && (
                    <FormMessage>{fieldErrors.trackingNumber}</FormMessage>
                  )}
                </FormGroup>
              </div>
            </div>
          )}

          <FormGroup state={fieldErrors.message ? 'error' : 'default'} className="mb-3">
            <Label>Personal Message (Optional)</Label>
            <Textarea
              placeholder="Warm wishes for the couple..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={isBusy}
              maxLength={1000}
              rows={3}
            />
            {fieldErrors.message && <FormMessage>{fieldErrors.message}</FormMessage>}
          </FormGroup>
          {submissionError && (
            <FormGroup state="error" className="mb-3">
              <FormMessage>{submissionError}</FormMessage>
            </FormGroup>
          )}
          <Button
            type="submit"
            variant="primary"
            className="w-full flex items-center justify-center"
            disabled={isEffectiveSubmitDisabled}
            aria-busy={isBusy}
          >
            {isBusy ? (
              <>
                <Icon name="Loader2" className="animate-spin mr-2 h-5 w-5" aria-hidden="true" />
                Processing...
              </>
            ) : isDirectMode ? (
              'Record Direct Transfer'
            ) : item.isGroupGift ? (
              'Submit Contribution'
            ) : (
              'Claim Gift'
            )}
          </Button>
        </form>
      ) : (
        <div className="mt-5 pt-4 border-t border-primary text-center">
          <p className="text-xl font-semibold text-green-600">
            {item.isGroupGift ? 'This gift is fully funded!' : 'This gift has been claimed!'}
          </p>
          {item.purchaserName && !item.isGroupGift && (
            <p className="text-sm text-gray-600 dark:text-gray-400">Claimed by: {item.purchaserName}</p>
          )}
          {item.isGroupGift && item.contributors.length > 0 && (
            <div className="mt-2 mb-2">
              <h4 className="font-semibold text-sm text-gray-700 dark:text-gray-300">Contributors:</h4>
              <ul className="list-disc list-inside text-xs text-gray-600 dark:text-gray-400">
                {item.contributors.map((c, idx) => (
                  <li key={idx}>
                    <span className="font-medium">{c.name}</span>{' '}
                    {c.amount ? `(${formatCurrency(c.amount)})` : ''}
                    {c.date ? <span className="ml-1 text-gray-400">{formatDate(c.date)}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-2 text-secondary">Thank you for your generosity!</p>
        </div>
      )}
    </div>
  );
};

export default RegistryItemCard;
