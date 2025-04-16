import React from 'react';
import { RegistryItem } from '@/types/registry';
import Link from 'next/link'; // Import Link for navigation
import { getRegistryItemStatus, RegistryItemStatus } from './registryStatusUtils';

interface RegistryCardProps {
  item: RegistryItem;
  onClick: () => void;
  isAdmin?: boolean; // Optional: Flag to show admin controls
  onEdit?: (id: string) => void; // Optional: Handler for edit action
  onDelete?: (id: string) => void; // Optional: Handler for delete action
}

const RegistryCard: React.FC<RegistryCardProps> = ({ item, onClick, isAdmin, onEdit, onDelete }) => {
  const status = getRegistryItemStatus(item);
  const isClaimed = status === 'claimed' || status === 'fullyFunded';
  // Adjust card styling slightly if admin controls are present
  const cardClasses = `border rounded-2xl overflow-hidden shadow-md hover:shadow-xl transition relative bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus-within:ring-4 focus-within:ring-primary-300 outline-none ${isClaimed ? 'opacity-60' : ''}`;
  // Make card clickable only if not claimed AND not in admin mode (to avoid conflict with buttons)
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
      {/* Visual overlay for claimed/fully funded */}
      {isClaimed && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10 pointer-events-none rounded-2xl">
          <span className="bg-green-700 text-white text-base font-bold px-4 py-2 rounded-full shadow-xl">
            {status === 'fullyFunded' ? 'Fully Funded' : 'Claimed'}
          </span>
        </div>
      )}
      {/* Display a placeholder if image path is invalid or missing */}
      <img
        src={item.image || '/images/placeholder.jpg'}
        alt={item.name}
        className="w-full h-56 object-cover bg-gray-100 dark:bg-gray-800 rounded-t-2xl"
        loading="lazy"
        onError={(e) => {
          const target = e.target as HTMLImageElement;
          target.onerror = null;
          target.src = '/images/placeholder.jpg';
        }}
      />
      <div className="p-6 pb-16 relative z-20 flex flex-col gap-2">
        <h3 className="text-2xl font-extrabold truncate text-primary-700 dark:text-yellow-300" title={item.name}>{item.name}</h3>
        <p className="text-base text-gray-700 dark:text-gray-200 mb-1 font-medium">{item.category}</p>
        <p className="mt-1 text-lg text-gray-900 dark:text-yellow-100 font-bold">$ {item.price.toFixed(2)}</p>
        {item.isGroupGift && !isClaimed && (
          <p className="text-base text-blue-800 dark:text-blue-300 mt-1 font-semibold">
            Group Gift: <span className="font-bold">${item.amountContributed.toFixed(2)}</span> contributed
          </p>
        )}
        {isClaimed && (
          <p className="text-base text-green-800 dark:text-green-300 font-semibold mt-1">
            {status === 'fullyFunded' ? 'Fully Funded!' : 'Claimed!'}
          </p>
        )}
      </div>
      {/* Admin Controls - Absolutely positioned at the bottom */}
      {isAdmin && (
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-yellow-50 dark:bg-yellow-900 bg-opacity-95 flex justify-end space-x-3 rounded-b-2xl border-t border-yellow-200 dark:border-yellow-800">
          <button
            onClick={handleEditClick}
            className="text-base bg-blue-700 hover:bg-blue-800 text-white py-2 px-4 rounded-lg transition font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400"
            aria-label={`Edit ${item.name}`}
          >
            Edit
          </button>
          <button
            onClick={handleDeleteClick}
            className="text-base bg-red-700 hover:bg-red-800 text-white py-2 px-4 rounded-lg transition font-semibold focus:outline-none focus:ring-2 focus:ring-red-400"
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
