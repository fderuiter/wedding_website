import React from 'react';
import { RegistryItem } from '@/types/registry';
import Link from 'next/link'; // Import Link for navigation

interface RegistryCardProps {
  item: RegistryItem;
  onClick: () => void;
  isAdmin?: boolean; // Optional: Flag to show admin controls
  onEdit?: (id: string) => void; // Optional: Handler for edit action
  onDelete?: (id: string) => void; // Optional: Handler for delete action
}

const RegistryCard: React.FC<RegistryCardProps> = ({ item, onClick, isAdmin, onEdit, onDelete }) => {
  const isClaimed = item.purchased;
  // Adjust card styling slightly if admin controls are present
  const cardClasses = `border rounded-lg overflow-hidden shadow hover:shadow-lg transition relative ${isClaimed ? 'opacity-50' : ''}`;
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
      style={{ cursor: isClickable ? 'pointer' : 'default' }} // Change cursor based on clickability
    >
      {/* Display a placeholder if image path is invalid or missing */}
      <img
        src={item.image || '/images/placeholder.jpg'} // Use a placeholder image path
        alt={item.name}
        className="w-full h-48 object-cover bg-gray-200" // Added background color for placeholders
        onError={(e) => {
          // Optional: Handle image loading errors, e.g., set to placeholder
          const target = e.target as HTMLImageElement;
          target.onerror = null; // Prevent infinite loop if placeholder also fails
          target.src = '/images/placeholder.jpg';
        }}
      />
      <div className="p-4 pb-12"> {/* Add padding-bottom to make space for buttons */}
        <h3 className="text-xl font-bold truncate">{item.name}</h3>
        <p className="text-gray-600 text-sm mb-1">{item.category}</p>
        <p className="mt-1 text-gray-800 font-semibold">$ {item.price.toFixed(2)}</p>
        {item.isGroupGift && !isClaimed && (
          <p className="text-sm text-blue-600 mt-1">
            Group Gift: ${item.amountContributed.toFixed(2)} contributed
          </p>
        )}
        {isClaimed && (
          <p className="text-sm text-red-600 font-semibold mt-1">
            {item.isGroupGift ? 'Fully Funded!' : 'Claimed!'}
          </p>
        )}
      </div>

      {/* Admin Controls - Absolutely positioned at the bottom */}
      {isAdmin && (
        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gray-100 bg-opacity-90 flex justify-end space-x-2">
          <button
            onClick={handleEditClick}
            className="text-xs bg-blue-500 hover:bg-blue-600 text-white py-1 px-2 rounded transition"
          >
            Edit
          </button>
          <button
            onClick={handleDeleteClick}
            className="text-xs bg-red-500 hover:bg-red-600 text-white py-1 px-2 rounded transition"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
};

export default RegistryCard;
