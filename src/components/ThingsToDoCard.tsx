import React from 'react';
import { Attraction } from '@/data/things-to-do';
import { MapPin } from 'lucide-react';

interface ThingsToDoCardProps {
  attraction: Attraction;
}

const ThingsToDoCard: React.FC<ThingsToDoCardProps> = ({ attraction }) => {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden transform hover:scale-105 transition-transform duration-300">
      <div className="p-6">
        <h3 className="text-xl font-bold mb-2 text-rose-700 dark:text-rose-400">{attraction.name}</h3>
        <p className="text-gray-700 dark:text-gray-300 mb-4">{attraction.description}</p>
        <div className="flex justify-between items-center">
          <a
            href={attraction.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-rose-600 dark:text-rose-400 hover:underline"
          >
            Visit Website
          </a>
          <a
            href={attraction.directions}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center text-rose-600 dark:text-rose-400 hover:underline"
          >
            <MapPin size={16} className="mr-1" />
            Directions
          </a>
        </div>
      </div>
    </div>
  );
};

export default ThingsToDoCard;
