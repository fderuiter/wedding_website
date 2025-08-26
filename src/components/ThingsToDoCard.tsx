import React from 'react';
import Image from 'next/image';
import { Attraction } from '@/data/things-to-do';
import { MapPin, Globe } from 'lucide-react';

interface ThingsToDoCardProps {
  attraction: Attraction;
}

const ThingsToDoCard: React.FC<ThingsToDoCardProps> = ({ attraction }) => {
  return (
    <div className="group bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden transform hover:scale-105 transition-transform duration-300 flex flex-col h-full">
      <div className="relative h-48 w-full">
        <Image
          src={attraction.image || '/images/placeholder.png'}
          alt={attraction.name}
          fill
          style={{ objectFit: 'cover' }}
          className="transition-transform duration-300 group-hover:scale-110"
        />
      </div>
      <div className="p-6 flex flex-col flex-grow">
        <h3 className="text-2xl font-bold mb-2 text-rose-800 dark:text-rose-300">{attraction.name}</h3>
        <p className="text-gray-600 dark:text-gray-400 mb-4 flex-grow">{attraction.description}</p>
        <div className="mt-auto flex justify-between items-center pt-4 border-t border-gray-200 dark:border-gray-700">
          <a
            href={attraction.website}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center text-rose-600 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-200 transition-colors"
          >
            <Globe size={18} className="mr-2" />
            Website
          </a>
          <a
            href={attraction.directions}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center text-rose-600 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-200 transition-colors"
          >
            <MapPin size={18} className="mr-2" />
            Directions
          </a>
        </div>
      </div>
    </div>
  );
};

export default ThingsToDoCard;
