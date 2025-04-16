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
  const cardClasses = `border rounded-lg overflow-hidden shadow hover:shadow-lg transition relative bg-white dark:bg-gray-900 text-gray-900 dark:text-white ${isClaimed ? 'opacity-50' : ''}`;
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
      style={{ cursor: isClickable ? 'pointer' : 'default' }}
      data-testid="registry-card"
    >
      {/* Visual overlay for claimed/fully funded */}
      {isClaimed && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10 pointer-events-none rounded-lg">
          <span className="bg-green-600 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg">
            {status === 'fullyFunded' ? 'Fully Funded' : 'Claimed'}
          </span>
        </div>
      )}
      {/* Display a placeholder if image path is invalid or missing */}
      <img
        src={item.image || '/images/placeholder.jpg'}
        alt={item.name}
        className="w-full h-48 object-cover bg-gray-200 dark:bg-gray-800"
        onError={(e) => {
          const target = e.target as HTMLImageElement;
          target.onerror = null;
          target.src = '/images/placeholder.jpg';
        }}
      />
      <div className="p-4 pb-12 relative z-20">
        <h3 className="text-xl font-bold truncate text-red-700 dark:text-yellow-400">{item.name}</h3>
        <p className="text-yellow-700 dark:text-yellow-300 text-sm mb-1">{item.category}</p>
        <p className="mt-1 text-yellow-700 dark:text-yellow-300 font-semibold">$ {item.price.toFixed(2)}</p>
        {item.isGroupGift && !isClaimed && (
          <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
            Group Gift: ${item.amountContributed.toFixed(2)} contributed
          </p>
        )}
        {isClaimed && (
          <p className="text-sm text-green-700 dark:text-green-400 font-semibold mt-1">
            {status === 'fullyFunded' ? 'Fully Funded!' : 'Claimed!'}
          </p>
        )}
      </div>

      {/* Admin Controls - Absolutely positioned at the bottom */}
      {isAdmin && (
        <div className="absolute bottom-0 left-0 right-0 p-2 bg-yellow-100 dark:bg-yellow-900 bg-opacity-95 flex justify-end space-x-2">
          <button
            onClick={handleEditClick}
            className="text-xs bg-blue-600 hover:bg-blue-700 text-white py-1 px-2 rounded transition"
          >
            Edit
          </button>
          <button
            onClick={handleDeleteClick}
            className="text-xs bg-red-600 hover:bg-red-700 text-white py-1 px-2 rounded transition"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
};

export default RegistryCard;
