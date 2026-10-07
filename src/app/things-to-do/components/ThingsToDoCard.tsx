'use client';

import React, { useState } from 'react';
import { MediaImage } from '@/components/MediaImage';
import type { AttractionDTO } from '@/features/attractions';
import { Icon } from '@/components/ui/Icon';
import { sanitizeUrl } from '@/utils/validation';

/**
 * @interface ThingsToDoCardProps
 * @description Defines the props for the ThingsToDoCard component.
 * @property {AttractionDTO} attraction - The attraction object containing details to display.
 */
interface ThingsToDoCardProps {
  attraction: AttractionDTO;
}

/**
 * @function ThingsToDoCard
 * @description A React component that displays a card for a "thing to do" or attraction/hotel block.
 * It includes an image, name, description, optional hotel block details, and links to website and directions.
 * @param {ThingsToDoCardProps} props - The props for the component.
 * @returns {JSX.Element} The rendered ThingsToDoCard component.
 */
const ThingsToDoCard: React.FC<ThingsToDoCardProps> = ({ attraction }) => {
  const [copied, setCopied] = useState(false);

  const handleCopyCode = async () => {
    if (!attraction.promoCode) return;
    try {
      await navigator.clipboard.writeText(attraction.promoCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback if clipboard API is restricted
    }
  };

  const safeBookingUrl = sanitizeUrl(attraction.bookingUrl);
  const safeWebsiteUrl = sanitizeUrl(attraction.website);
  const safeDirectionsUrl = sanitizeUrl(attraction.directions);

  const hasHotelBlock = Boolean(
    attraction.promoCode ||
    attraction.roomRate ||
    attraction.cutoffDate ||
    safeBookingUrl ||
    attraction.shuttleInfo ||
    attraction.category === 'hotel'
  );

  return (
    <div className="group bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden transform hover:scale-105 transition-transform duration-300 flex flex-col h-full">
      <div className="relative h-48 w-full">
        <MediaImage
          media={attraction.image}
          fallbackUrl="/images/placeholder.png"
          fallbackAlt={attraction.name}
          className="object-cover w-full h-full transition-transform duration-300 group-hover:scale-110"
        />
      </div>
      <div className="p-6 flex flex-col flex-grow">
        <h3 className="text-2xl font-bold mb-2 text-primary dark:text-primary">{attraction.name}</h3>
        <p className="text-gray-600 dark:text-gray-400 mb-4 flex-grow">{attraction.description}</p>

        {hasHotelBlock && (
          <div className="mb-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 space-y-3 text-sm">
            {attraction.roomRate && (
              <div className="flex items-center text-gray-800 dark:text-gray-200 font-medium">
                <Icon name="Tag" size={16} className="mr-2 text-primary" />
                <span>Rate: <strong className="font-semibold">{attraction.roomRate}</strong></span>
              </div>
            )}

            {attraction.promoCode && (
              <div className="flex items-center justify-between gap-2 p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                <div className="flex items-center overflow-hidden">
                  <Icon name="Gift" size={16} className="mr-2 text-primary shrink-0" />
                  <span className="text-gray-700 dark:text-gray-300 truncate">
                    Code: <code className="font-mono font-bold bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-primary">{attraction.promoCode}</code>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  aria-label={copied ? 'Promo code copied' : `Copy promo code ${attraction.promoCode}`}
                  className="px-2.5 py-1 text-xs font-semibold rounded bg-primary text-white hover:bg-primary/90 transition-colors shrink-0"
                >
                  {copied ? 'Copied!' : 'Copy Code'}
                </button>
              </div>
            )}

            {attraction.cutoffDate && (
              <div className="flex items-start p-2 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/50">
                <Icon name="Calendar" size={16} className="mr-2 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <span><strong>Cutoff Date:</strong> {attraction.cutoffDate}</span>
              </div>
            )}

            {attraction.shuttleInfo && (
              <div className="flex items-start text-gray-700 dark:text-gray-300">
                <Icon name="Truck" size={16} className="mr-2 mt-0.5 shrink-0 text-primary" />
                <span><strong>Shuttle:</strong> {attraction.shuttleInfo}</span>
              </div>
            )}

            {safeBookingUrl && (
              <div className="pt-1">
                <a
                  href={safeBookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center px-4 py-2 bg-primary text-white font-semibold rounded-lg hover:bg-primary/90 transition-colors"
                >
                  <Icon name="ExternalLink" size={16} className="mr-2" />
                  Book Hotel Block
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </div>
            )}
          </div>
        )}

        <div className="mt-auto flex justify-between items-center pt-4 border-t border-gray-200 dark:border-gray-700">
          {safeWebsiteUrl ? (
            <a
              href={safeWebsiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center text-primary dark:text-primary hover:text-primary dark:hover:text-primary transition-colors"
            >
              <Icon name="Globe" size={18} className="mr-2" />
              Website
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : <div />}
          {safeDirectionsUrl ? (
            <a
              href={safeDirectionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center text-primary dark:text-primary hover:text-primary dark:hover:text-primary transition-colors"
            >
              <Icon name="MapPin" size={18} className="mr-2" />
              Directions
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default ThingsToDoCard;
