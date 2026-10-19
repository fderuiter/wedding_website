'use client';
import React, { useState, useEffect } from 'react';
import { RegistryItem } from '../types';
import RegistryItemProgressBar from './RegistryItemProgressBar';
import { MediaImage } from '@/components/MediaImage';
import { Icon } from '@/components/ui/Icon';
import { ContributionSchema } from '../schemas';
import { FormGroup, Label, Input, Textarea, FormMessage } from '@/components/ui/forms';
import { formatCurrency, formatDate } from '@/utils/intl';
import { Button } from '@/components/ui/Button';
import { apiClient } from '@/lib/apiClient';
import { useShareItem } from '../hooks/useShareItem';
import { useGuestSession } from '../context/GuestSessionContext';

/**
 * @interface RegistryItemCardProps
 * @description Defines the props for the RegistryItemCard component.
 * @property {RegistryItem} item - The registry item to be displayed in the card.
 * @property {() => void} onClose - Callback function to close the card.
 * @property {(itemId: string, contributorName: string, amount: number, code?: string, message?: string) => Promise<void>} onContribute - Async function to handle the contribution or claiming of an item.
 */
interface RegistryItemCardProps {
  item: RegistryItem;
  onClose: () => void;
  onContribute: (itemId: string, contributorName: string, amount: number, code?: string, message?: string) => Promise<void>;
}

/**
 * @function RegistryItemCard
 * @description A React component that displays a card layout for a registry item inside an overlay.
 * It allows users to view item details and contribute to or claim the item.
 * @param {RegistryItemCardProps} props - The props for the component.
 * @returns {JSX.Element} The rendered RegistryItemCard component.
 */
const RegistryItemCard: React.FC<RegistryItemCardProps> = ({ item, onClose, onContribute }) => {
  const {
    invitationCode: sessionCode,
    guestName: sessionGuestName,
    isVerified: isSessionVerified,
    setSession,
    clearSession,
  } = useGuestSession();

  const [contributorName, setContributorName] = useState('');
  const [amount, setAmount] = useState<number | string>('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [invitationCode, setInvitationCode] = useState('');
  const [isValidatingCode, setIsValidatingCode] = useState(false);
  const [codeValidationError, setCodeValidationError] = useState<string | null>(null);
  const [isCodeLocked, setIsCodeLocked] = useState(false);

  const { handleShare, copied } = useShareItem(item);

  useEffect(() => {
    if (isSessionVerified && sessionCode) {
      setInvitationCode(sessionCode);
      setContributorName((prev) => prev || sessionGuestName || '');
      setIsCodeLocked(true);
    }
  }, [isSessionVerified, sessionCode, sessionGuestName]);

  const handleCodeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase();
    setInvitationCode(val);
    setCodeValidationError(null);
    if (val === '') {
      setIsCodeLocked(false);
      return;
    }
    // Auto-validate if length is 8 characters
    if (val.length === 8) {
      setIsValidatingCode(true);
      setCodeValidationError(null);
      setError(null);
      try {
        const data = await apiClient.get(`/api/registry/validate-code?code=${encodeURIComponent(val)}`);
        if (data && data.valid) {
          setContributorName(data.guestName);
          setIsCodeLocked(true);
          setSession({
            invitationCode: data.code || val,
            guestName: data.guestName,
            isVerified: true,
          });
        } else {
          setCodeValidationError('Invalid invitation code.');
        }
      } catch (err: any) {
        setCodeValidationError(err.message || 'Invalid invitation code.');
      } finally {
        setIsValidatingCode(false);
      }
    }
  };

  const handleContributeClick = async () => {
    setError(null);

    const rawAmount = item.isGroupGift ? amount : item.price;

    const result = ContributionSchema.safeParse({
      itemId: item.id,
      name: contributorName,
      amount: rawAmount,
      code: invitationCode || undefined,
      message: message || undefined,
    });

    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }

    const validData = result.data;
    const finalAmount = validData.amount;

    if (item.isGroupGift) {
      const remainingAmount = item.price - item.amountContributed;
      if (finalAmount > remainingAmount) {
        setError(`Amount cannot exceed the remaining ${formatCurrency(remainingAmount)}.`);
        return;
      }
    }
    setIsSubmitting(true);
    try {
      if (validData.code !== undefined || validData.message !== undefined) {
        await onContribute(
          item.id,
          validData.name,
          finalAmount,
          validData.code || undefined,
          validData.message || undefined
        );
      } else {
        await onContribute(item.id, validData.name, finalAmount);
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message || 'Failed to process contribution. Please try again.');
      } else {
        setError('An unknown error occurred during contribution.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const remainingAmount = item.price - item.amountContributed;
  const isFullyFunded = remainingAmount <= 0;

  const isFund = item.itemType === 'CASH_FUND' || item.itemType === 'EXPERIENCE_FUND';
  const parsedContributionAmount = item.isGroupGift
    ? (typeof amount === 'number' ? amount : parseFloat(amount as string))
    : item.price;
  const baseContributionAmount = !isNaN(parsedContributionAmount) && parsedContributionAmount > 0 ? parsedContributionAmount : 0;
  const estimatedProcessingFee = baseContributionAmount * 0.025;
  const netPayoutAmount = baseContributionAmount - estimatedProcessingFee;

  // XSS protection for the vendorUrl. Ensure it's a valid http(s) URL.
  const isVendorUrlSafe = item.vendorUrl && (item.vendorUrl.startsWith('http://') || item.vendorUrl.startsWith('https://'));

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-xl w-full p-6 relative max-h-[90vh] overflow-y-auto text-gray-800 dark:text-gray-100" onClick={(e) => e.stopPropagation()}>
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
      <h2 className="text-2xl font-bold mb-2 text-primary">{item.name}</h2>
      <p className="text-gray-700 dark:text-gray-300 mb-3">{item.description}</p>
      <p className="text-lg font-semibold mb-1 text-secondary">
        {item.itemType === 'CASH_FUND' || item.itemType === 'EXPERIENCE_FUND' ? 'Target Goal:' : 'Price:'} {formatCurrency(item.price)}
      </p>
      {item.paymentHandle && (
        <div className="mb-3 p-3 bg-gray-50 dark:bg-gray-900/60 rounded-md border border-gray-200 dark:border-gray-700">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Send directly via {item.paymentHandleType || 'Payment App'}:
          </p>
          <p className="text-sm font-mono text-primary font-bold mt-0.5 select-all">
            {item.paymentHandle}
          </p>
        </div>
      )}
      {item.isGroupGift && (
        <div className="mb-3">
          <p className="text-sm text-secondary">
            {item.itemType === 'CASH_FUND' || item.itemType === 'EXPERIENCE_FUND' ? 'Fund Contributions' : 'Group Gift'} - {formatCurrency(item.amountContributed)} contributed so far.
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
          <a
            href={item.vendorUrl as string}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-primary dark:text-primary hover:text-primary dark:hover:text-primary underline text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded"
          >
            View on Vendor Site
          </a>
        ) : <div />}
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
      {!item.purchased ? (
        <form noValidate 
          className="mt-5 pt-4 border-t border-primary"
          onSubmit={(e) => { e.preventDefault(); handleContributeClick(); }}
        >
          <h3 className="font-semibold text-lg mb-3 text-primary">
            {item.isGroupGift ? 'Contribute to this Gift' : 'Claim This Gift'}
          </h3>
          <FormGroup state={codeValidationError ? 'error' : 'default'} className="mb-3">
            <Label>
              Invitation Code (Optional)
            </Label>
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
                  onClick={async () => {
                    setIsValidatingCode(true);
                    setCodeValidationError(null);
                    setError(null);
                    try {
                      const data = await apiClient.get(`/api/registry/validate-code?code=${encodeURIComponent(invitationCode)}`);
                      if (data && data.valid) {
                        setContributorName(data.guestName);
                        setIsCodeLocked(true);
                        setSession({
                          invitationCode: data.code || invitationCode,
                          guestName: data.guestName,
                          isVerified: true,
                        });
                      } else {
                        setCodeValidationError('Invalid invitation code.');
                      }
                    } catch (err: any) {
                      setCodeValidationError(err.message || 'Invalid invitation code.');
                    } finally {
                      setIsValidatingCode(false);
                    }
                  }}
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
                  onClick={async () => {
                    await clearSession();
                    setIsCodeLocked(false);
                    setInvitationCode('');
                    setContributorName('');
                    setCodeValidationError(null);
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
            {codeValidationError && <FormMessage>{codeValidationError}</FormMessage>}
            {isCodeLocked && <p className="text-sm text-green-600 mt-1">Code verified! Name pre-filled.</p>}
          </FormGroup>
          <FormGroup state={error ? 'error' : 'default'} className="mb-3">
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
          </FormGroup>
          {item.isGroupGift && (
            <FormGroup state={error ? 'error' : 'default'} className="mb-3">
              <Label>
                Contribution Amount <span className="text-red-500">*</span>
              </Label>
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
            </FormGroup>
          )}
          {isFund && (
            <div className="mb-4 p-3.5 bg-slate-50 dark:bg-slate-900/80 rounded-lg border border-slate-200 dark:border-slate-700 text-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 font-semibold text-gray-800 dark:text-gray-200">
                  <Icon name="Info" className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
                  <span>Payment Processing Fee Notice</span>
                </div>
                <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">
                  Standard Fee: 2.5%
                </span>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                Standard payment processor rates apply to online card transfers. Card transfer processing fee disclosures: processing fees (2.5%) cover third-party processor rates to ensure full transparency on the net contribution received by the couple.
              </p>
              <div className="space-y-1.5 pt-2.5 border-t border-slate-200 dark:border-slate-700 text-xs">
                <div className="flex justify-between text-gray-700 dark:text-gray-300">
                  <span>Base Contribution Amount:</span>
                  <span className="font-semibold">{formatCurrency(baseContributionAmount)}</span>
                </div>
                <div className="flex justify-between text-gray-600 dark:text-gray-400">
                  <span>Estimated Card Processing Fee (2.5%):</span>
                  <span>-{formatCurrency(estimatedProcessingFee)}</span>
                </div>
                <div className="flex justify-between text-primary font-bold pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60 text-sm">
                  <span>Net Payout Received by Couple:</span>
                  <span>{formatCurrency(netPayoutAmount)}</span>
                </div>
              </div>
            </div>
          )}
          <FormGroup state={error ? 'error' : 'default'} className="mb-3">
            <Label>
              Personal Message (Optional)
            </Label>
            <Textarea
              placeholder="Warm wishes for the couple..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={isSubmitting}
              maxLength={1000}
              rows={3}
            />
          </FormGroup>
          {error && <FormGroup state="error"><FormMessage>{error}</FormMessage></FormGroup>}
          <Button
            type="submit"
            variant="primary"
            className="w-full flex items-center justify-center"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Icon name="Loader2" className="animate-spin mr-2 h-5 w-5" aria-hidden="true" />
                Processing...
              </>
            ) : (
              item.isGroupGift ? 'Submit Contribution' : 'Claim Gift'
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
            <>
              <div className="mt-2 mb-2">
                <h4 className="font-semibold text-sm text-gray-700 dark:text-gray-300">Contributors:</h4>
                <ul className="list-disc list-inside text-xs text-gray-600 dark:text-gray-400">
                  {item.contributors.map((c, idx) => (
                    <li key={idx}>
                      <span className="font-medium">{c.name}</span> {c.amount ? `(${formatCurrency(c.amount)})` : ''}
                      {c.date ? <span className="ml-1 text-gray-400">{formatDate(c.date)}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
          <p className="mt-2 text-secondary">Thank you for your generosity!</p>
        </div>
      )}
    </div>
  );
};

export default RegistryItemCard;
