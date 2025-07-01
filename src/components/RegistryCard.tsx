import React from 'react';
import { RegistryItem } from '@/types/registry';
import { getRegistryItemStatus } from './registryStatusUtils'; // Removed unused RegistryItemStatus
import Image from 'next/image'; // Import next/image

// Export the props interface
export interface RegistryCardProps {
  item: RegistryItem;
  onClick: () => void;
  isAdmin?: boolean; // Optional: Flag to show admin controls
  onEdit?: (id: string) => void; // Optional: Handler for edit action
  onDelete?: (id: string) => void; // Optional: Handler for delete action
}

const RegistryCard: React.FC<RegistryCardProps> = ({ item, onClick, isAdmin, onEdit, onDelete }) => {
  const status = getRegistryItemStatus(item);
  const isClaimed = status === 'claimed' || status === 'fullyFunded';
  // Updated card styling, removed dark mode, updated focus ring
  const cardClasses = `border border-rose-100 rounded-2xl overflow-hidden shadow-md hover:shadow-xl transition relative bg-white text-[var(--color-foreground)] focus-within:ring-4 focus-within:ring-rose-300 outline-none ${isClaimed ? 'opacity-60' : ''}`;
  const isClickable = !isClaimed && !isAdmin;

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click event
    onEdit?.(item.id);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click event
    onDelete?.(item.id);
  };

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
          src={item.image || '/images/placeholder.jpg'}
          alt={item.name}
          // Updated placeholder background
          className="object-cover bg-gray-100 rounded-t-2xl" // Removed w-full, h-56
          layout="fill" // Use fill layout
          loading="lazy"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.onerror = null; // Prevent infinite loop if placeholder also fails
            target.srcset = '/images/placeholder.jpg'; // Use srcset for next/image
            target.src = '/images/placeholder.jpg'; // Fallback src
          }}
        />
      </div>
      <div className="p-6 pb-16 relative z-20 flex flex-col gap-2">
        {/* Updated heading color */}
        <h3 className="text-2xl font-extrabold truncate text-rose-700" title={item.name}>{item.name}</h3>
        {/* Updated text color */}
        <p className="text-base text-gray-600 mb-1 font-medium">{item.category}</p>
        {/* Updated price color */}
        <p className="mt-1 text-lg text-gray-800 font-bold">$ {item.price.toFixed(2)}</p>
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
      {/* Admin Controls - Updated styles */}
      {isAdmin && (
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gray-50 bg-opacity-95 flex justify-end space-x-3 rounded-b-2xl border-t border-gray-200">
          <button
            onClick={handleEditClick}
            // Updated Edit button style (amber)
            className="text-base bg-amber-500 hover:bg-amber-600 text-white py-2 px-4 rounded-lg transition font-semibold focus:outline-none focus:ring-2 focus:ring-amber-400"
            aria-label={`Edit ${item.name}`}
          >
            Edit
          </button>
          <button
            onClick={handleDeleteClick}
            // Updated Delete button style (rose)
            className="text-base bg-rose-600 hover:bg-rose-700 text-white py-2 px-4 rounded-lg transition font-semibold focus:outline-none focus:ring-2 focus:ring-rose-400"
            aria-label={`Delete ${item.name}`}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
};

export default RegistryCard;
