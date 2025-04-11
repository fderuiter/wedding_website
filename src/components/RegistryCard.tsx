import React from 'react';
import { RegistryItem } from '@/types/registry';

interface RegistryCardProps {
  item: RegistryItem;
  onClick: () => void;
}

const RegistryCard: React.FC<RegistryCardProps> = ({ item, onClick }) => {
  const isClaimed = item.purchased;
  const cardClasses = `border rounded-lg overflow-hidden shadow hover:shadow-lg transition ${isClaimed ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`;

  return (
    <div
      className={cardClasses}
      onClick={!isClaimed ? onClick : undefined} // Only allow click if not claimed
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
      <div className="p-4">
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
    </div>
  );
};

export default RegistryCard;
