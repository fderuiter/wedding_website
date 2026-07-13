import React from 'react';
import { MediaImage } from '@/components/MediaImage';
import type { AttractionDTO } from '@/features/attractions/schemas';
import { Icon } from '@/components/ui/Icon';

const getSafeUrl = (url: string | undefined): string => {
  if (!url) return '#';
  try {
    const parsed = new URL(url, 'https://dummy.com');
    if (['http:', 'https:'].includes(parsed.protocol)) {
      return url;
    }
    return '#';
  } catch {
    return '#';
  }
};

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
 * @description A React component that displays a card for a "thing to do" or attraction.
 * It includes an image, name, description, and links to the attraction's website and directions.
 * @param {ThingsToDoCardProps} props - The props for the component.
 * @returns {JSX.Element} The rendered ThingsToDoCard component.
 */
const ThingsToDoCard: React.FC<ThingsToDoCardProps> = ({ attraction }) => {
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
        <div className="mt-auto flex justify-between items-center pt-4 border-t border-gray-200 dark:border-gray-700">
          <a
            href={getSafeUrl(attraction.website)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center text-primary dark:text-primary hover:text-primary dark:hover:text-primary transition-colors"
          >
            <Icon name="Globe" size={18} className="mr-2" />
            Website
          </a>
          <a
            href={getSafeUrl(attraction.directions)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center text-primary dark:text-primary hover:text-primary dark:hover:text-primary transition-colors"
          >
            <Icon name="MapPin" size={18} className="mr-2" />
            Directions
          </a>
        </div>
      </div>
    </div>
  );
};

export default ThingsToDoCard;
