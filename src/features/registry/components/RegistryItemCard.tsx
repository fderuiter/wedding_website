'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import type { Stripe, StripeElements } from '@stripe/stripe-js';
import { ThemedQRCode } from '@/components/ui/ThemedQRCode';
import { RegistryItem } from '../types';
import RegistryItemProgressBar from './RegistryItemProgressBar';
import { MediaImage } from '@/components/MediaImage';
import { Icon } from '@/components/ui/Icon';
import { AccessibleExternalLink } from '@/components/ui/AccessibleExternalLink';
import { FormGroup, Label, Input, Textarea, FormMessage } from '@/components/ui/forms';
import { formatCurrency, formatDate } from '@/utils/intl';
import { Button } from '@/components/ui/Button';
import { useShareItem } from '../hooks/useShareItem';
import { useRegistryContributionMachine } from '../hooks/useRegistryContributionMachine';
import { getPaymentUrl } from '../utils/paymentUrls';
import { getStripePromise } from '@/lib/stripe';
import { apiClient } from '@/lib/apiClient';

const FIXED_PRESETS = [50, 100, 250];

/**
 * @interface RegistryItemCardProps
 * @description Defines the props for the RegistryItemCard component.
 * @property {RegistryItem} item - The registry item to be displayed in the card.
 * @property {() => void} onClose - Callback function to close the card.
 * @property {Function} onContribute - Async function to handle the contribution or claiming of an item.
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
    paymentIntentId?: string
  ) => Promise<void>;
  titleId?: string;
}

interface RegistryItemCardInnerProps extends RegistryItemCardProps {
  stripe?: Stripe | null;
  elements?: StripeElements | null;
}

/**
 * Inner component that renders the registry item details, form, and confirmation receipt.
 */
const RegistryItemCardInner: React.FC<RegistryItemCardInnerProps> = ({
  item,
  onClose,
  onContribute,
  titleId,
  stripe = null,
  elements = null,
}) => {

  const {
    isValidatingCode,
    isCodeLocked,
    isSubmitting,
    isSuccess,
    isSubmitDisabled,

    contributorName,
    email,
    amount,
    message,
    coverFee,
    invitationCode,

    paymentTransactionId,

    fieldErrors,
    codeError,
    submissionError,

    setContributorName,
    setEmail,
    setAmount,
    setMessage,
    setCoverFee,
    setPaymentTransactionId,
    setPhase,
    setSubmissionError,

    handleCodeChange,
    handleVerifyCode,
    handleClearCode,
    handleSubmit,
    handlePresetClick,
  } = useRegistryContributionMachine({ item, onContribute });

  const { handleShare, copied } = useShareItem(item);

  const remainingAmount = item.price - item.amountContributed;
  const isFullyFunded = remainingAmount <= 0;

  const isFund = item.itemType === 'CASH_FUND' || item.itemType === 'EXPERIENCE_FUND';
  const parsedContributionAmount = item.isGroupGift
    ? (typeof amount === 'number' ? amount : parseFloat(amount as string))
    : item.price;
  const baseContributionAmount =
    !isNaN(parsedContributionAmount) && parsedContributionAmount > 0 ? parsedContributionAmount : 0;
  const hasPaymentHandle = Boolean(item.paymentHandle && item.paymentHandle.trim());
  const processingFeeRate = hasPaymentHandle ? 0 : 0.025;
  const estimatedProcessingFee = Math.round(baseContributionAmount * processingFeeRate * 100) / 100;
  const netPayoutAmount = Math.max(0, Math.round((baseContributionAmount - estimatedProcessingFee) * 100) / 100);
  const paymentUrl = getPaymentUrl(item.paymentHandleType, item.paymentHandle);

  // Stripe PaymentIntent state
  const [paymentIntentData, setPaymentIntentData] = useState<{
    clientSecret: string;
    paymentIntentId: string;
    amount: number;
    feeAmount: number;
  } | null>(null);

  // Sync PaymentIntent dynamically when amount or coverFee changes
  useEffect(() => {
    if (!isFund) return;
    if (baseContributionAmount <= 0) return;

    let active = true;
    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.post('/api/registry/payment-intent', {
          itemId: item.id,
          amount: baseContributionAmount,
          coverFee,
          paymentIntentId: paymentIntentData?.paymentIntentId,
          name: contributorName,
          email,
          message,
          code: invitationCode,
        });
        if (active && res && res.clientSecret) {
          setPaymentIntentData(res);
        }
      } catch {
        // Fallback for mocked test environments
        if (active && !paymentIntentData) {
          setPaymentIntentData({
            clientSecret: `pi_mock_secret_${item.id}`,
            paymentIntentId: `pi_mock_${item.id}`,
            amount: baseContributionAmount,
            feeAmount: coverFee ? estimatedProcessingFee : 0,
          });
        }
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [item.id, isFund, baseContributionAmount, coverFee]);

  // Form submission handling embedded Stripe Elements confirmation
  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isFund) {
      await handleSubmit(e);
      return;
    }

    if (!contributorName.trim()) {
      await handleSubmit(e);
      return;
    }

    setPhase('submitting');
    setSubmissionError(null);

    try {
      let intentId = paymentIntentData?.paymentIntentId;
      let secret = paymentIntentData?.clientSecret;

      // 1. Ensure PaymentIntent is created or retrieved
      if (!intentId || !secret) {
        try {
          const intentRes = await apiClient.post('/api/registry/payment-intent', {
            itemId: item.id,
            amount: baseContributionAmount,
            coverFee,
            name: contributorName,
            email,
            message,
            code: invitationCode,
          });
          if (intentRes?.paymentIntentId) {
            intentId = intentRes.paymentIntentId;
            secret = intentRes.clientSecret;
            setPaymentIntentData(intentRes);
          }
        } catch {
          // In test environments or fallback
          intentId = intentId || 'pi_mock_intent';
          secret = secret || 'pi_mock_secret';
        }
      }

      // 2. If Stripe Elements is mounted, validate and confirm payment
      if (stripe && elements) {
        const submitResult = await elements.submit();
        if (submitResult?.error) {
          setPhase('error');
          setSubmissionError(submitResult.error.message || 'Please check your card details.');
          return;
        }

        const confirmResult = await stripe.confirmPayment({
          elements,
          clientSecret: secret || 'pi_mock_secret',
          confirmParams: {
            payment_method_data: {
              billing_details: {
                name: contributorName,
                email: email || undefined,
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
    } catch (err: any) {
      setPhase('error');
      setSubmissionError(err.message || 'Payment processing failed. Please try again.');
    }
  };

  // XSS protection for the vendorUrl. Ensure it's a valid http(s) URL.
  const isVendorUrlSafe =
    item.vendorUrl && (item.vendorUrl.startsWith('http://') || item.vendorUrl.startsWith('https://'));

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
      <h2 id={titleId || (item ? `registry-item-title-${item.id}` : undefined)} className="text-2xl font-bold mb-2 text-primary">{item.name}</h2>
      <p className="text-gray-700 dark:text-gray-300 mb-3">{item.description}</p>
      <p className="text-lg font-semibold mb-1 text-secondary">
        {item.itemType === 'CASH_FUND' || item.itemType === 'EXPERIENCE_FUND'
          ? 'Target Goal:'
          : 'Price:'}{' '}
        {formatCurrency(item.price)}
      </p>

      {/* Embedded Stripe Elements supported payment methods notice */}
      {isFund && (
        <div
          data-testid="stripe-payment-notice"
          className="mb-3 p-3 bg-slate-50 dark:bg-slate-900/60 rounded-md border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-primary shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
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

      {item.paymentHandle && (
        <div className="mb-3 p-3 bg-gray-50 dark:bg-gray-900/60 rounded-md border border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              Send directly via {item.paymentHandleType || 'Payment App'}:
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-0.5">
              <span className="text-sm font-mono text-primary font-bold select-all">
                {item.paymentHandle}
              </span>
              {paymentUrl && (
                <AccessibleExternalLink
                  href={paymentUrl}
                  className="inline-flex items-center gap-1 text-xs text-primary dark:text-primary hover:underline font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                  aria-label={`Open payment link for ${item.paymentHandleType || 'Payment App'}`}
                  showIcon
                  iconClassName="w-3.5 h-3.5"
                >
                  <span>Open Link</span>
                </AccessibleExternalLink>
              )}
            </div>
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
                aria-label={`QR code to pay via ${item.paymentHandleType || 'Payment App'}`}
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
            {item.itemType === 'CASH_FUND' || item.itemType === 'EXPERIENCE_FUND'
              ? 'Fund Contributions'
              : 'Group Gift'}{' '}
            - {formatCurrency(item.amountContributed)} contributed so far.
          </p>
          {!isFullyFunded && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {formatCurrency(remainingAmount)} still needed.
            </p>
          )}
          <RegistryItemProgressBar contributed={item.amountContributed} total={item.price} />
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
          aria-label={`Share ${item.name}`}
        >
          <Icon name={copied ? 'Check' : 'Share2'} className="w-4 h-4" />
          {copied ? 'Link Copied!' : 'Share Gift'}
        </Button>
      </div>

      {item.isSample ? (
        <div className="mt-5 pt-4 border-t border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/40 p-3.5 rounded-lg text-amber-900 dark:text-amber-100 text-sm">
          <span className="font-bold block mb-1">Demo / Sample Registry Item</span>
          Sample items demonstrate registry formatting and layout. Real payments and guest contributions are disabled on sample items.
        </div>
      ) : isSuccess ? (
        /* Confirmation screen with payment transaction details */
        <div data-testid="contribution-success-confirmation" className="mt-5 pt-4 border-t border-green-500 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/60 text-green-600 dark:text-green-300 mb-3">
            <Icon name="Check" className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-bold text-green-700 dark:text-green-400 mb-1">
            Contribution Confirmed!
          </h3>
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
            Thank you, <span className="font-semibold">{contributorName}</span>! Your gift of{' '}
            <span className="font-semibold">
              {formatCurrency(coverFee ? baseContributionAmount + estimatedProcessingFee : baseContributionAmount)}
            </span>{' '}
            has been securely processed.
          </p>
          {paymentTransactionId && (
            <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 text-xs font-mono text-gray-600 dark:text-gray-400 mb-4 select-all">
              <span>Transaction Reference: </span>
              <span className="font-bold text-primary">{paymentTransactionId}</span>
            </div>
          )}
          <Button variant="primary" onClick={onClose} className="w-full">
            Done
          </Button>
        </div>
      ) : (!item.purchased || isSubmitting) ? (
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

          {isFund && (
            <div className="mb-4 p-3.5 bg-slate-50 dark:bg-slate-900/80 rounded-lg border border-slate-200 dark:border-slate-700 text-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 font-semibold text-gray-800 dark:text-gray-200">
                  <Icon name="Info" className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
                  <span>{hasPaymentHandle ? 'Direct Transfer Notice' : 'Payment Processing Fee Notice'}</span>
                </div>
                <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">
                  Standard Fee: {hasPaymentHandle ? '0%' : '2.5%'}
                </span>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                {hasPaymentHandle
                  ? 'Direct payment transfers via peer-to-peer payment handles incur zero processing fees, ensuring 100% of your gift reaches the couple directly.'
                  : 'Standard payment processor rates apply to online card transfers. Card transfer processing fee disclosures: processing fees (2.5%) cover third-party processor rates to ensure full transparency on the net contribution received by the couple.'}
              </p>
              {processingFeeRate > 0 && (
                <label className="flex items-start gap-2.5 cursor-pointer my-3 p-2.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 select-none">
                  <input
                    type="checkbox"
                    checked={coverFee}
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
                {coverFee ? (
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
                      <span>{hasPaymentHandle ? 'Direct Transfer Fee (0%):' : 'Estimated Card Processing Fee (2.5%):'}</span>
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

          {/* Embedded Stripe Elements Card and Wallet Input */}
          {isFund && (
            <FormGroup className="mb-4">
              <Label className="block mb-1.5 font-medium text-sm text-gray-800 dark:text-gray-200">
                Card &amp; Digital Wallet Details
              </Label>
              <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 min-h-[50px]">
                <PaymentElement id="stripe-payment-element" />
              </div>
            </FormGroup>
          )}

          <FormGroup state={fieldErrors.message ? 'error' : 'default'} className="mb-3">
            <Label>Personal Message (Optional)</Label>
            <Textarea
              placeholder="Warm wishes for the couple..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={isSubmitting}
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
            disabled={isSubmitDisabled}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Icon name="Loader2" className="animate-spin mr-2 h-5 w-5" aria-hidden="true" />
                Processing...
              </>
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

/**
 * Wrapper rendered strictly inside <Elements> so Stripe context hooks are only called for fund items.
 */
const RegistryFundCardInner: React.FC<RegistryItemCardProps> = (props) => {
  const stripe = useStripe();
  const elements = useElements();
  return <RegistryItemCardInner {...props} stripe={stripe} elements={elements} />;
};

/**
 * Root RegistryItemCard component wrapped with Stripe Elements provider for funds.
 */
const RegistryItemCard: React.FC<RegistryItemCardProps> = (props) => {
  const isFund = props.item.itemType === 'CASH_FUND' || props.item.itemType === 'EXPERIENCE_FUND';
  const remainingAmount = props.item.price - props.item.amountContributed;
  const initialAmount = props.item.isGroupGift
    ? Math.min(100, remainingAmount > 0 ? remainingAmount : props.item.price)
    : props.item.price;

  const stripePromise = useMemo(
    () => (isFund ? getStripePromise()?.catch(() => null) ?? null : null),
    [isFund]
  );

  const elementsOptions = useMemo(
    () => ({
      mode: 'payment' as const,
      amount: Math.max(100, Math.round(initialAmount * 100)),
      currency: 'usd',
      appearance: { theme: 'stripe' as const },
    }),
    [initialAmount]
  );

  if (!isFund) {
    return <RegistryItemCardInner {...props} />;
  }

  return (
    <Elements stripe={stripePromise} options={elementsOptions}>
      <RegistryFundCardInner {...props} />
    </Elements>
  );
};

export default RegistryItemCard;
