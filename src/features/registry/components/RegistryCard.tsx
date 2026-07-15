import React from 'react';
import { RegistryItem } from '../types';
import { getRegistryItemStatus } from '../lib/registryStatusUtils';
import { MediaImage } from '@/components/MediaImage';
import { Interactive3DCard } from '@/components/ui/Interactive3DCard';
import { formatCurrency } from '@/utils/intl';
import { Button } from '@/components/ui/Button';

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
  const isClickable = !isClaimed && !isAdmin;
  const cardClasses = `border border-primary dark:border-gray-700 rounded-2xl overflow-hidden shadow-md transition relative bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus-visible:ring-4 focus-visible:ring-primary outline-none block w-full text-left ${isClaimed ? 'opacity-60' : ''} ${isClickable ? 'hover:shadow-xl hover:scale-105' : ''}`;

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.(item.id);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(item.id);
  };

  const innerContent = (
    <>
      {/* Visual overlay for claimed/fully funded - Adjusted colors */}
      {isClaimed && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10 pointer-events-none rounded-2xl">
          <span className="bg-gradient-to-r from-primary to-secondary text-white text-base font-bold px-4 py-2 rounded-full shadow-xl">
            {status === 'fullyFunded' ? 'Fully Funded' : 'Claimed'}
          </span>
        </div>
      )}
      {/* Display a placeholder if image path is invalid or missing */}
      <div className="relative w-full aspect-square overflow-hidden bg-gray-100 rounded-t-2xl">
        {/* Blurred Background Layer via CSS */}
        <div
          className="absolute inset-0 bg-cover bg-center opacity-50 scale-125 blur-2xl"
          style={{ backgroundImage: `url("${item.image?.url || '/images/placeholder.png'}")` }}
          aria-hidden="true"
        />
        {/* Main Image Layer */}
        <MediaImage
          media={item.image}
          fallbackUrl="/images/placeholder.png"
          className="object-contain relative z-10 w-full h-full"
          loading="lazy"
          onError={(e: any) => {
            const target = e.target as HTMLImageElement;
            target.onerror = null;
            target.src = '/images/placeholder.png';
          }}
        />
      </div>
      <div className="p-6 pb-16 relative z-20 flex flex-col gap-2">
        <h3 className="text-2xl font-extrabold truncate text-primary" title={item.name}>{item.name}</h3>
        <p className="text-base text-gray-600 dark:text-gray-300 mb-1 font-medium">{item.category}</p>
        <p className="mt-1 text-lg text-gray-800 dark:text-gray-100 font-bold">{formatCurrency(item.price)}</p>
        {item.isGroupGift && !isClaimed && (
          <p className="text-base text-secondary mt-1 font-semibold">
            Group Gift: <span className="font-bold">{formatCurrency(item.amountContributed)}</span> contributed
          </p>
        )}
        {isClaimed && (
          <p className="text-base text-green-700 font-semibold mt-1">
            {status === 'fullyFunded' ? 'Fully Funded!' : 'Claimed!'}
          </p>
        )}
        {isAdmin && (
          <div className="absolute bottom-4 right-4 flex gap-2 z-20">
            <Button
              variant="primary"
              size="sm"
              onClick={handleEdit}
              aria-label={`Edit ${item.name}`}
            >
              Edit
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDelete}
              aria-label={`Delete ${item.name}`}
            >
              Delete
            </Button>
          </div>
        )}
      </div>
    </>
  );

  const commonProps = {
    className: `${cardClasses} h-full`,
    style: { cursor: isClickable ? 'pointer' : 'default', minHeight: 'calc(340px * var(--scale-factor))' },
    'data-testid': 'registry-card',
    'aria-label': `${item.name}, ${formatCurrency(item.price)}${isClaimed ? ', Claimed' : ''}`,
    tabIndex: 0,
    role: isClickable ? 'button' : undefined,
  };

  if (isAdmin) {
    return <div {...commonProps}>{innerContent}</div>;
  }

  return (
    <Interactive3DCard
      as={isClickable ? 'button' : 'div'}
      {...commonProps}
      onClick={isClickable ? () => onClick(item) : undefined}
    >
      {innerContent}
    </Interactive3DCard>
  );
};

export default React.memo(RegistryCard);
