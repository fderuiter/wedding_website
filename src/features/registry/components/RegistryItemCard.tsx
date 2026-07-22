'use client';
import React, { useState } from 'react';
import { RegistryItem } from '../types';
import RegistryItemProgressBar from './RegistryItemProgressBar';
import { MediaImage } from '@/components/MediaImage';
import { Icon } from '@/components/ui/Icon';
import { ContributionSchema } from '../schemas';
import { FormGroup, Label, Input, FormMessage } from '@/components/ui/forms';
import { formatCurrency, formatDate } from '@/utils/intl';
import { Button } from '@/components/ui/Button';

/**
 * @interface RegistryItemCardProps
 * @description Defines the props for the RegistryItemCard component.
 * @property {RegistryItem} item - The registry item to be displayed in the card.
 * @property {() => void} onClose - Callback function to close the card.
 * @property {(itemId: string, contributorName: string, amount: number) => Promise<void>} onContribute - Async function to handle the contribution or claiming of an item.
 */
interface RegistryItemCardProps {
  item: RegistryItem;
  onClose: () => void;
  onContribute: (itemId: string, contributorName: string, amount: number) => Promise<void>;
}

/**
 * @function RegistryItemCard
 * @description A React component that displays a card layout for a registry item inside an overlay.
 * It allows users to view item details and contribute to or claim the item.
 * @param {RegistryItemCardProps} props - The props for the component.
 * @returns {JSX.Element} The rendered RegistryItemCard component.
 */
const RegistryItemCard: React.FC<RegistryItemCardProps> = ({ item, onClose, onContribute }) => {
  const [contributorName, setContributorName] = useState('');
  const [amount, setAmount] = useState<number | string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleContributeClick = async () => {
    setError(null);
    const rawAmount = item.isGroupGift ? amount : item.price;

    const result = ContributionSchema.safeParse({
      itemId: item.id,
      name: contributorName,
      amount: rawAmount,
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
      await onContribute(item.id, validData.name, finalAmount);
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
        Price: {formatCurrency(item.price)}
      </p>
      {item.isGroupGift && (
        <div className="mb-3">
          <p className="text-sm text-secondary">
            Group Gift - {formatCurrency(item.amountContributed)} contributed so far.
          </p>
          {!isFullyFunded && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {formatCurrency(remainingAmount)} still needed.
            </p>
          )}
          <RegistryItemProgressBar contributed={item.amountContributed} total={item.price} />
        </div>
      )}
      {isVendorUrlSafe && (
        <a
          href={item.vendorUrl as string}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-primary dark:text-primary hover:text-primary dark:hover:text-primary underline mb-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded"
        >
          View on Vendor Site
        </a>
      )}
      {!item.purchased ? (
        <form noValidate 
          className="mt-5 pt-4 border-t border-primary"
          onSubmit={(e) => { e.preventDefault(); handleContributeClick(); }}
        >
          <h3 className="font-semibold text-lg mb-3 text-primary">
            {item.isGroupGift ? 'Contribute to this Gift' : 'Claim This Gift'}
          </h3>
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
