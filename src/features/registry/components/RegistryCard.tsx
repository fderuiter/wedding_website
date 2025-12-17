import React from 'react';
import { RegistryItem } from '@/features/registry/types';
import { getRegistryItemStatus } from '@/features/registry/lib/registryStatusUtils';
import Image from 'next/image';

/**
 * Props for the RegistryCard component.
 */
export interface RegistryCardProps {
  /** The registry item data to display. */
  item: RegistryItem;
  /** Function to call when the card is clicked. */
  onClick: (item: RegistryItem) => void;
  /** Whether the user is an admin. */
  isAdmin?: boolean;
  /** Function to call when the edit button is clicked. */
  onEdit?: (id: string) => void;
  /** Function to call when the delete button is clicked. */
  onDelete?: (id: string) => void;
}

/**
 * @function RegistryCard
 * @description A card component that displays a single registry item.
 * It shows the item's name, image, price, and status (e.g., claimed, fully funded).
 * The card is clickable to open a modal for contributions, unless the item is already claimed.
 * It also provides optional controls for administrators to edit or delete the item.
 *
 * @param {RegistryCardProps} props - The props for the component.
 * @returns {React.ReactElement} The rendered registry card.
 */
const RegistryCard: React.FC<RegistryCardProps> = ({ item, onClick, isAdmin, onEdit, onDelete }) => {
  const status = getRegistryItemStatus(item);
  const isClaimed = status === 'claimed' || status === 'fullyFunded';
  // Updated card styling, removed dark mode, updated focus ring
  const isClickable = !isClaimed && !isAdmin;
  const cardClasses = `border border-rose-100 dark:border-gray-700 rounded-2xl overflow-hidden shadow-md transition relative bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus-within:ring-4 focus-within:ring-rose-300 outline-none ${isClaimed ? 'opacity-60' : ''} ${isClickable ? 'hover:shadow-xl hover:scale-105' : ''}`;

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.(item.id);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(item.id);
  };

  return (
    <div
      className={cardClasses}
      onClick={isClickable ? () => onClick(item) : undefined}
      style={{ cursor: isClickable ? 'pointer' : 'default', minHeight: 340 }}
      data-testid="registry-card"
      tabIndex={isClickable ? 0 : -1}
      aria-label={`${item.name}, $${item.price.toFixed(2)}${isClaimed ? ', Claimed' : ''}`}
      role={isClickable ? 'button' : undefined}
      onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(item); } : undefined}
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
          fill // Use fill layout
          // Added sizes prop for performance optimization
          // Matches grid layout:
          // < 640px: 1 col (100vw)
          // 640-768px: 2 cols (50vw)
          // 768-1280px: 3 cols (33vw)
          // > 1280px: 4 cols (25vw)
          sizes="(max-width: 639px) 100vw, (max-width: 767px) 50vw, (max-width: 1279px) 33vw, 25vw"
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
        {isAdmin && (
          <div className="absolute bottom-4 right-4 flex gap-2 z-20">
            <button
              onClick={handleEdit}
              className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600"
              aria-label={`Edit ${item.name}`}
            >
              Edit
            </button>
            <button
              onClick={handleDelete}
              className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600"
              aria-label={`Delete ${item.name}`}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(RegistryCard);
