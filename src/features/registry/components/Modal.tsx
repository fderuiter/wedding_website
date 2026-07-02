import React, { useState } from 'react';
import { RegistryItem } from '@/features/registry/types';
import RegistryItemProgressBar from './RegistryItemProgressBar';
import Image from 'next/image';
import { Icon } from '@/components/ui/Icon';
import { useOverlay } from '@/hooks/useOverlay';
import { validateContributeInput } from '@/utils/validation';
import { FormGroup, Label, Input, FormMessage } from '@/components/ui/forms';

/**
 * @interface ModalProps
 * @description Defines the props for the Modal component.
 * @property {RegistryItem} item - The registry item to be displayed in the modal.
 * @property {() => void} onClose - Callback function to close the modal.
 * @property {(itemId: string, contributorName: string, amount: number) => Promise<void>} onContribute - Async function to handle the contribution or claiming of an item.
 */
export interface ModalProps {
  item: RegistryItem;
  onClose: () => void;
  onContribute: (itemId: string, contributorName: string, amount: number) => Promise<void>;
}

/**
 * @function Modal
 * @description A React component that displays a modal dialog for a registry item.
 * It allows users to view item details and contribute to or claim the item.
 * @param {ModalProps} props - The props for the component.
 * @returns {JSX.Element} The rendered Modal component.
 */
const Modal: React.FC<ModalProps> = ({ item, onClose, onContribute }) => {
  const [contributorName, setContributorName] = useState("");
  const [amount, setAmount] = useState<number | string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { overlayRef, handleBackdropClick } = useOverlay(true, onClose);

  const handleContributeClick = async () => {
    setError(null);
    const contributionAmount = Number(amount);
    const finalAmount = item.isGroupGift ? contributionAmount : item.price;

    const validationError = validateContributeInput({
      itemId: item.id,
      name: contributorName,
      amount: finalAmount,
    });

    if (validationError) {
      setError(validationError);
      return;
    }

    if (item.isGroupGift) {
      const remainingAmount = item.price - item.amountContributed;
      if (contributionAmount > remainingAmount) {
        setError(`Amount cannot exceed the remaining $${remainingAmount.toFixed(2)}.`);
        return;
      }
    }
    setIsSubmitting(true);
    try {
      const finalAmount = item.isGroupGift ? contributionAmount : item.price;
      await onContribute(item.id, contributorName, finalAmount);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message || "Failed to process contribution. Please try again.");
      } else {
        setError("An unknown error occurred during contribution.");
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
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-60 z-50 p-4" role="dialog" aria-modal="true" ref={overlayRef} onClick={handleBackdropClick}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-xl w-full p-6 relative max-h-[90vh] overflow-y-auto text-gray-800 dark:text-gray-100">
        <button
          className="absolute top-3 right-3 text-gray-500 hover:text-primary dark:hover:text-primary rounded-full p-1 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          onClick={onClose}
          aria-label="Close modal"
        >
          <Icon name="X" className="w-6 h-6" />
        </button>
        <div className="relative w-full h-64 mb-4">
          <Image
            src={item.image || '/images/placeholder.png'}
            alt={item.name}
            className="object-cover rounded bg-gray-100"
            fill
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.onerror = null;
              target.srcset = '/images/placeholder.png';
              target.src = '/images/placeholder.png';
            }}
          />
        </div>
        <h2 className="text-2xl font-bold mb-2 text-primary">{item.name}</h2>
        <p className="text-gray-700 dark:text-gray-300 mb-3">{item.description}</p>
        <p className="text-lg font-semibold mb-1 text-secondary">
          Price: ${item.price.toFixed(2)}
        </p>
        {item.isGroupGift && (
          <div className="mb-3">
            <p className="text-sm text-secondary">
              Group Gift - ${item.amountContributed.toFixed(2)} contributed so far.
            </p>
            {!isFullyFunded && (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                ${remainingAmount.toFixed(2)} still needed.
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
                  placeholder={`Up to $${remainingAmount.toFixed(2)}`}
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
            <button
              type="submit"
              className="w-full btn-primary"
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
            </button>
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
                        <span className="font-medium">{c.name}</span> {c.amount ? `($${c.amount.toFixed(2)})` : ''}
                        {c.date ? <span className="ml-1 text-gray-400">{new Date(c.date).toLocaleDateString()}</span> : null}
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
    </div>
  );
};

export default Modal;
