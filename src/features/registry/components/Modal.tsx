import React, { useState, useRef, useEffect } from 'react';
import { RegistryItem } from '@/features/registry/types';
import RegistryItemProgressBar from './RegistryItemProgressBar';
import Image from 'next/image';
import { X, Loader2 } from 'lucide-react';

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
  const modalRef = useRef<HTMLDivElement>(null);
  const firstFocusableRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const focusableSelectors = [
      'button', 'a[href]', 'input', '[tabindex]:not([tabindex="-1"])'
    ];
    const modal = modalRef.current;
    if (!modal) return;
    const focusableEls = modal.querySelectorAll<HTMLElement>(focusableSelectors.join(','));
    if (focusableEls.length > 0) {
      (focusableEls[0] as HTMLElement).focus();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab') {
        const focusable = Array.from(focusableEls);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            (last as HTMLElement).focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            (first as HTMLElement).focus();
          }
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleContributeClick = async () => {
    setError(null);
    const contributionAmount = Number(amount);

    if (!contributorName.trim()) {
      setError("Please enter your name.");
      return;
    }

    if (item.isGroupGift) {
      if (isNaN(contributionAmount) || contributionAmount <= 0) {
        setError("Please enter a valid contribution amount.");
        return;
      }
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

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-60 z-50 p-4" role="dialog" aria-modal="true" ref={modalRef}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-xl w-full p-6 relative max-h-[90vh] overflow-y-auto text-gray-800 dark:text-gray-100">
        <button
          className="absolute top-3 right-3 text-gray-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-full p-1 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          onClick={onClose}
          aria-label="Close modal"
          ref={firstFocusableRef}
        >
          <X className="w-6 h-6" />
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
        <h2 className="text-2xl font-bold mb-2 text-rose-700">{item.name}</h2>
        <p className="text-gray-700 dark:text-gray-300 mb-3">{item.description}</p>
        <p className="text-lg font-semibold mb-1 text-amber-700">
          Price: ${item.price.toFixed(2)}
        </p>
        {item.isGroupGift && (
          <div className="mb-3">
            <p className="text-sm text-amber-700">
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
        {item.vendorUrl && (
          <a
            href={item.vendorUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-rose-600 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-300 underline mb-4 text-sm"
          >
            View on Vendor Site
          </a>
        )}
        {!item.purchased ? (
          <div className="mt-5 pt-4 border-t border-rose-100">
            <h3 className="font-semibold text-lg mb-3 text-rose-700">
              {item.isGroupGift ? 'Contribute to this Gift' : 'Claim This Gift'}
            </h3>
            <div className="mb-3">
              <label htmlFor="contributorName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Your Name <span className="text-red-500">*</span>
              </label>
              <input
                id="contributorName"
                type="text"
                placeholder="Jane Doe"
                className="border border-gray-300 dark:border-gray-600 p-2 rounded w-full focus:ring-2 focus:ring-rose-400 outline-none bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                value={contributorName}
                onChange={(e) => setContributorName(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
            {item.isGroupGift && (
              <div className="mb-3">
                <label htmlFor="contributionAmount" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Contribution Amount <span className="text-red-500">*</span>
                </label>
                <input
                  id="contributionAmount"
                  type="number"
                  placeholder={`Up to $${remainingAmount.toFixed(2)}`}
                  className="border border-gray-300 dark:border-gray-600 p-2 rounded w-full focus:ring-2 focus:ring-rose-400 outline-none bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  min="0.01"
                  step="0.01"
                  max={remainingAmount}
                  disabled={isSubmitting}
                />
              </div>
            )}
            {error && <p className="text-red-600 text-sm mb-3" role="alert">{error}</p>}
            <button
              className={`w-full bg-gradient-to-r from-rose-700 to-amber-500 text-white font-bold px-4 py-2 rounded shadow hover:from-amber-500 hover:to-rose-700 transition flex items-center justify-center ${isSubmitting ? 'opacity-75 cursor-not-allowed' : ''}`}
              onClick={handleContributeClick}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin mr-2 h-5 w-5" />
                  Processing...
                </>
              ) : (
                item.isGroupGift ? 'Submit Contribution' : 'Claim Gift'
              )}
            </button>
          </div>
        ) : (
          <div className="mt-5 pt-4 border-t border-rose-100 text-center">
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
            <p className="mt-2 text-amber-700">Thank you for your generosity!</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Modal;
