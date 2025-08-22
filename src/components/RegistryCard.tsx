import React from 'react';
import { RegistryItem } from '@/types/registry';
import { getRegistryItemStatus } from './registryStatusUtils';
import Image from 'next/image';

/**
 * Props for the RegistryCard component.
 */
export interface RegistryCardProps {
  /** The registry item data to display. */
  item: RegistryItem;
  /** Function to call when the card is clicked. */
  onClick: () => void;
}

/**
 * A card component that displays a single registry item.
 * It shows the item's name, image, price, and status (e.g., claimed, fully funded).
 * It also provides optional controls for administrators to edit or delete the item.
 *
 * @param {RegistryCardProps} props - The props for the component.
 * @returns {React.ReactElement} The rendered registry card.
 */
const RegistryCard: React.FC<RegistryCardProps> = ({ item, onClick }) => {
  const status = getRegistryItemStatus(item);
  const isClaimed = status === 'claimed' || status === 'fullyFunded';
  // Updated card styling, removed dark mode, updated focus ring
  const isClickable = !isClaimed;
  const cardClasses = `border border-rose-100 dark:border-gray-700 rounded-2xl overflow-hidden shadow-md transition relative bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus-within:ring-4 focus-within:ring-rose-300 outline-none ${isClaimed ? 'opacity-60' : ''} ${isClickable ? 'hover:shadow-xl hover:scale-105' : ''}`;

  return (
    <div
      className={cardClasses}
      onClick={isClickable ? onClick : undefined}
      style={{ cursor: isClickable ? 'pointer' : 'default', minHeight: 340 }}
      data-testid="registry-card"
      tabIndex={isClickable ? 0 : -1}
      aria-label={item.name}
      role="button"
      onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      {/* Visual overlay for claimed/fully funded - Adjusted colors */}
      {isClaimed && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10 pointer-events-none rounded-2xl">
          <span className="bg-gradient-to-r from-rose-700 to-amber-500 text-white text-base font-bold px-4 py-2 rounded-full shadow-xl">
            {status === 'fullyFunded' ? 'Fully Funded' : 'Claimed'}
          </span>
        </div>
      )}
      {/* Display a placeholder if image path is invalid or missing */}
      <div className="relative w-full h-56"> {/* Added a wrapper for layout */}
        <Image
          src={item.image || '/images/placeholder.png'} // Fallback to placeholder if image is missing
          alt={item.name}
          // Updated placeholder background
          className="object-cover bg-gray-100 rounded-t-2xl" // Removed w-full, h-56
          layout="fill" // Use fill layout
          loading="lazy"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.onerror = null; // Prevent infinite loop if placeholder also fails
            target.srcset = '/images/placeholder.png'; // Use srcset for next/image
            target.src = '/images/placeholder.png'; // Fallback src
          }}
        />
      </div>
      <div className="p-6 pb-16 relative z-20 flex flex-col gap-2">
        {/* Updated heading color */}
        <h3 className="text-2xl font-extrabold truncate text-rose-700" title={item.name}>{item.name}</h3>
        {/* Updated text color */}
        <p className="text-base text-gray-600 dark:text-gray-300 mb-1 font-medium">{item.category}</p>
        {/* Updated price color */}
        <p className="mt-1 text-lg text-gray-800 dark:text-gray-100 font-bold">$ {item.price.toFixed(2)}</p>
        {item.isGroupGift && !isClaimed && (
          // Updated group gift text color
          <p className="text-base text-amber-700 mt-1 font-semibold">
            Group Gift: <span className="font-bold">${item.amountContributed.toFixed(2)}</span> contributed
          </p>
        )}
        {isClaimed && (
          // Updated claimed text color
          <p className="text-base text-green-700 font-semibold mt-1">
            {status === 'fullyFunded' ? 'Fully Funded!' : 'Claimed!'}
          </p>
        )}
      </div>
    </div>
  );
};

export default RegistryCard;
