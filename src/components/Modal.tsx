import React, { useState } from 'react';
import { RegistryItem } from '@/types/registry';
import RegistryItemProgressBar from './RegistryItemProgressBar';

interface ModalProps {
  item: RegistryItem;
  onClose: () => void;
  onContribute: (itemId: string, contributorName: string, amount: number) => Promise<void>; // Function to handle contribution API call
}

const Modal: React.FC<ModalProps> = ({ item, onClose, onContribute }) => {
  const [contributorName, setContributorName] = useState("");
  const [amount, setAmount] = useState<number | string>(""); // Allow string for input flexibility
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    } catch (err: any) {
      setError(err.message || "Failed to process contribution. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const remainingAmount = item.price - item.amountContributed;
  const isFullyFunded = remainingAmount <= 0;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-70 z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-xl w-full p-6 relative max-h-[90vh] overflow-y-auto text-gray-900 dark:text-white">
        {/* Close Button */}
        <button
          className="absolute top-3 right-3 text-gray-400 hover:text-red-500 text-2xl font-bold"
          onClick={onClose}
          aria-label="Close modal"
        >
          &times;
        </button>
        {/* Item Image */}
        <img
          src={item.image || '/images/placeholder.jpg'}
          alt={item.name}
          className="w-full h-64 object-cover rounded mb-4 bg-gray-200 dark:bg-gray-800"
          onError={(e) => { 
            const target = e.target as HTMLImageElement;
            target.onerror = null; 
            target.src = '/images/placeholder.jpg'; 
          }}
        />
        {/* Item Details */}
        <h2 className="text-2xl font-bold mb-2 text-red-700 dark:text-yellow-400">{item.name}</h2>
        <p className="text-gray-800 dark:text-gray-200 mb-3">{item.description}</p>
        <p className="text-lg font-semibold mb-1 text-yellow-700 dark:text-yellow-300">
          Price: ${item.price.toFixed(2)}
        </p>
        {item.isGroupGift && (
          <div className="mb-3">
            <p className="text-sm text-blue-700 dark:text-blue-300">
              Group Gift - ${item.amountContributed.toFixed(2)} contributed so far.
            </p>
            {!isFullyFunded && (
              <p className="text-sm text-gray-700 dark:text-gray-300">
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
            className="inline-block text-blue-600 dark:text-yellow-300 hover:text-blue-800 underline mb-4 text-sm"
          >
            View on Vendor Site
          </a>
        )}
        {/* Contribution/Claim Section */}
        {!item.purchased ? (
          <div className="mt-5 pt-4 border-t border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-lg mb-3 text-red-700 dark:text-yellow-400">
              {item.isGroupGift ? 'Contribute to this Gift' : 'Claim This Gift'}
            </h3>
            <input
              type="text"
              placeholder="Your Name"
              className="border p-2 rounded w-full mb-3 focus:ring-2 focus:ring-yellow-400 outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              value={contributorName}
              onChange={(e) => setContributorName(e.target.value)}
              disabled={isSubmitting}
            />
            {item.isGroupGift && (
              <input
                type="number"
                placeholder={`Contribution Amount (up to $${remainingAmount.toFixed(2)})`}
                className="border p-2 rounded w-full mb-3 focus:ring-2 focus:ring-yellow-400 outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="0.01"
                step="0.01"
                max={remainingAmount}
                disabled={isSubmitting}
              />
            )}
            {error && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{error}</p>}
            <button
              className={`w-full bg-gradient-to-r from-red-600 to-yellow-500 text-white font-bold px-4 py-2 rounded shadow hover:from-yellow-500 hover:to-red-600 transition ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
              onClick={handleContributeClick}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Processing...' : (item.isGroupGift ? 'Submit Contribution' : 'Claim Gift')}
            </button>
          </div>
        ) : (
          <div className="mt-5 pt-4 border-t border-gray-200 dark:border-gray-700 text-center">
            <p className="text-xl font-semibold text-green-600 dark:text-green-400">
              {item.isGroupGift ? 'This gift is fully funded!' : 'This gift has been claimed!'}
            </p>
            {item.purchaserName && !item.isGroupGift && (
                <p className="text-sm text-gray-700 dark:text-gray-200">Claimed by: {item.purchaserName}</p>
            )}
            {item.isGroupGift && item.contributors.length > 0 && (
                <>
                    <div className="mt-2 mb-2">
                      <h4 className="font-semibold text-sm text-gray-800 dark:text-gray-200">Contributors:</h4>
                      <ul className="list-disc list-inside text-xs text-gray-700 dark:text-gray-300">
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
            <p className="mt-2 text-yellow-700 dark:text-yellow-300">Thank you for your generosity!</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Modal;
