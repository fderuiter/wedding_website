import React, { useState } from 'react';
import { RegistryItem } from '@/types/registry';

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
    } else {
      // For non-group gifts, the amount is the full price
      if (contributionAmount !== item.price && amount !== '') { // Allow empty amount for 'Claim Gift'
         // If they entered an amount, it must match the price for non-group gifts
         setError(`Please contribute the full amount ($${item.price.toFixed(2)}) or leave blank to claim.`);
         return;
      }
    }

    setIsSubmitting(true);
    try {
      // If it's not a group gift or if the contribution amount equals the remaining amount,
      // treat it as claiming the full item (or remaining part).
      // Otherwise, it's a partial contribution.
      const finalAmount = item.isGroupGift ? contributionAmount : item.price;
      await onContribute(item.id, contributorName, finalAmount);
      // Success handled by parent component (e.g., closing modal, showing message)
    } catch (err: any) {
      console.error("Contribution error:", err);
      setError(err.message || "Failed to process contribution. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const remainingAmount = item.price - item.amountContributed;
  const isFullyFunded = remainingAmount <= 0;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-60 z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-xl w-full p-6 relative max-h-[90vh] overflow-y-auto">
        {/* Close Button */}
        <button
          className="absolute top-3 right-3 text-gray-500 hover:text-gray-800 text-2xl font-bold"
          onClick={onClose}
          aria-label="Close modal"
        >
          &times;
        </button>

        {/* Item Image */}
        <img
          src={item.image || '/images/placeholder.jpg'}
          alt={item.name}
          className="w-full h-64 object-cover rounded mb-4 bg-gray-200"
           onError={(e) => { 
            const target = e.target as HTMLImageElement;
            target.onerror = null; 
            target.src = '/images/placeholder.jpg'; 
          }}
        />

        {/* Item Details */}
        <h2 className="text-2xl font-bold mb-2">{item.name}</h2>
        <p className="text-gray-700 mb-3">{item.description}</p>
        <p className="text-lg text-gray-900 font-semibold mb-1">
          Price: ${item.price.toFixed(2)}
        </p>
        {item.isGroupGift && (
          <div className="mb-3">
            <p className="text-sm text-blue-700">
              Group Gift - ${item.amountContributed.toFixed(2)} contributed so far.
            </p>
            {!isFullyFunded && (
              <p className="text-sm text-gray-600">
                ${remainingAmount.toFixed(2)} still needed.
              </p>
            )}
             {/* Optional: Progress Bar */}
             <div className="w-full bg-gray-200 rounded-full h-2.5 mt-1">
                <div 
                  className="bg-blue-600 h-2.5 rounded-full"
                  style={{ width: `${Math.min(100, (item.amountContributed / item.price) * 100)}%` }}
                ></div>
              </div>
          </div>
        )}
        {item.vendorUrl && (
          <a
            href={item.vendorUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-blue-600 hover:text-blue-800 underline mb-4 text-sm"
          >
            View on Vendor Site
          </a>
        )}

        {/* Contribution/Claim Section */}
        {!item.purchased ? (
          <div className="mt-5 pt-4 border-t">
            <h3 className="font-semibold text-lg mb-3">
              {item.isGroupGift ? 'Contribute to this Gift' : 'Claim This Gift'}
            </h3>
            <input
              type="text"
              placeholder="Your Name"
              className="border p-2 rounded w-full mb-3 focus:ring-2 focus:ring-blue-300 outline-none"
              value={contributorName}
              onChange={(e) => setContributorName(e.target.value)}
              disabled={isSubmitting}
            />
            {item.isGroupGift && (
              <input
                type="number"
                placeholder={`Contribution Amount (up to $${remainingAmount.toFixed(2)})`}
                className="border p-2 rounded w-full mb-3 focus:ring-2 focus:ring-blue-300 outline-none"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="0.01"
                step="0.01"
                max={remainingAmount}
                disabled={isSubmitting}
              />
            )}
            {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
            <button
              className={`w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
              onClick={handleContributeClick}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Processing...' : (item.isGroupGift ? 'Submit Contribution' : 'Claim Gift')}
            </button>
          </div>
        ) : (
          <div className="mt-5 pt-4 border-t text-center">
            <p className="text-xl font-semibold text-green-600">
              {item.isGroupGift ? 'This gift is fully funded!' : 'This gift has been claimed!'}
            </p>
            {item.purchaserName && !item.isGroupGift && (
                <p className="text-sm text-gray-600">Claimed by: {item.purchaserName}</p>
            )}
            {item.isGroupGift && item.contributors.length > 0 && (
                <>
                    <p className="text-sm text-gray-600 mt-1">Thank you to all contributors!</p>
                    {/* Optional: List contributors if desired */}
                    {/* <ul className="text-xs text-gray-500 list-disc list-inside mt-1">
                        {item.contributors.map((c, i) => <li key={i}>{c.name}</li>)}
                    </ul> */}
                </>
            )}
            <p className="mt-2 text-gray-700">Thank you for your generosity!</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Modal;
