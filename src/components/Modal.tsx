import React, { useState, useRef, useEffect } from 'react';
import { RegistryItem } from '@/types/registry';
import RegistryItemProgressBar from './RegistryItemProgressBar';
import Image from 'next/image'; // Import next/image

// Export the props interface
export interface ModalProps {
  item: RegistryItem;
  onClose: () => void;
  onContribute: (itemId: string, contributorName: string, amount: number) => Promise<void>; // Function to handle contribution API call
}

const Modal: React.FC<ModalProps> = ({ item, onClose, onContribute }) => {
  const [contributorName, setContributorName] = useState("");
  const [amount, setAmount] = useState<number | string>(""); // Allow string for input flexibility
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const firstFocusableRef = useRef<HTMLButtonElement | null>(null);

  // Focus trap and Escape key support
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
        // Focus trap
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
    setError(null); // Clear previous errors
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
      // Success handled by parent component (e.g., closing modal, showing message)
    } catch (err: unknown) { // Changed 'any' to 'unknown'
      // Type guard for Error object
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
    // Updated backdrop
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-60 z-50 p-4" role="dialog" aria-modal="true" ref={modalRef}>
      {/* Updated modal background and text color, removed dark mode */}
      <div className="bg-white rounded-lg shadow-xl max-w-xl w-full p-6 relative max-h-[90vh] overflow-y-auto text-[#374151]">
        {/* Close Button - Adjusted color */}
        <button
          className="absolute top-3 right-3 text-gray-500 hover:text-rose-600 text-2xl font-bold"
          onClick={onClose}
          aria-label="Close modal"
          ref={firstFocusableRef}
        >
          &times;
        </button>
        {/* Item Image - Use next/image */}
        <div className="relative w-full h-64 mb-4"> {/* Wrapper for layout="fill" */}
          <Image
            src={item.image || '/images/placeholder.jpg'}
            alt={item.name}
            className="object-cover rounded bg-gray-100" // Removed size classes
            layout="fill" // Use fill layout
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.onerror = null; // Prevent infinite loop
              target.srcset = '/images/placeholder.jpg'; // Use srcset for next/image
              target.src = '/images/placeholder.jpg'; // Fallback src
            }}
          />
        </div>
        {/* Item Details - Updated colors */}
        <h2 className="text-2xl font-bold mb-2 text-rose-700">{item.name}</h2>
        <p className="text-gray-700 mb-3">{item.description}</p>
        <p className="text-lg font-semibold mb-1 text-amber-700">
          Price: ${item.price.toFixed(2)}
        </p>
        {item.isGroupGift && (
          <div className="mb-3">
            <p className="text-sm text-amber-700">
              Group Gift - ${item.amountContributed.toFixed(2)} contributed so far.
            </p>
            {!isFullyFunded && (
              <p className="text-sm text-gray-600">
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
            // Updated link color
            className="inline-block text-rose-600 hover:text-rose-800 underline mb-4 text-sm"
          >
            View on Vendor Site
          </a>
        )}
        {/* Contribution/Claim Section */}
        {!item.purchased ? (
          // Updated border color
          <div className="mt-5 pt-4 border-t border-rose-100">
            {/* Updated heading color */}
            <h3 className="font-semibold text-lg mb-3 text-rose-700">
              {item.isGroupGift ? 'Contribute to this Gift' : 'Claim This Gift'}
            </h3>
            <input
              type="text"
              placeholder="Your Name"
              // Updated input styles
              className="border border-gray-300 p-2 rounded w-full mb-3 focus:ring-2 focus:ring-rose-400 outline-none bg-white text-[#374151]"
              value={contributorName}
              onChange={(e) => setContributorName(e.target.value)}
              disabled={isSubmitting}
            />
            {item.isGroupGift && (
              <input
                type="number"
                placeholder={`Contribution Amount (up to $${remainingAmount.toFixed(2)})`}
                // Updated input styles
                className="border border-gray-300 p-2 rounded w-full mb-3 focus:ring-2 focus:ring-rose-400 outline-none bg-white text-[#374151]"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="0.01"
                step="0.01"
                max={remainingAmount}
                disabled={isSubmitting}
              />
            )}
            {/* Updated error color */}
            {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
            <button
              // Updated button gradient to match main theme
              className={`w-full bg-gradient-to-r from-rose-700 to-amber-500 text-white font-bold px-4 py-2 rounded shadow hover:from-amber-500 hover:to-rose-700 transition ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
              onClick={handleContributeClick}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Processing...' : (item.isGroupGift ? 'Submit Contribution' : 'Claim Gift')}
            </button>
          </div>
        ) : (
          // Updated border color and text colors
          <div className="mt-5 pt-4 border-t border-rose-100 text-center">
            <p className="text-xl font-semibold text-green-600">
              {item.isGroupGift ? 'This gift is fully funded!' : 'This gift has been claimed!'}
            </p>
            {item.purchaserName && !item.isGroupGift && (
                <p className="text-sm text-gray-600">Claimed by: {item.purchaserName}</p>
            )}
            {item.isGroupGift && item.contributors.length > 0 && (
                <>
                    <div className="mt-2 mb-2">
                      <h4 className="font-semibold text-sm text-gray-700">Contributors:</h4>
                      <ul className="list-disc list-inside text-xs text-gray-600">
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
