'use client'

import React, { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { attractions } from '@/data/things-to-do';
import ThingsToDoCard from './ThingsToDoCard';

/**
 * An array of possible categories for attractions.
 * @type {readonly string[]}
 */
const categories = ['all', 'food', 'coffee', 'park', 'museum', 'hotel', 'venue'] as const;

/**
 * A type representing a single category.
 * @typedef {'all' | 'food' | 'coffee' | 'park' | 'museum' | 'hotel' | 'venue'} Category
 */
type Category = typeof categories[number];

/**
 * @function ThingsToDoList
 * @description A React component that displays a list of "things to do" or attractions.
 * It includes a category filter and a map showing the locations of the attractions.
 * @returns {JSX.Element} The rendered ThingsToDoList component.
 */
const ThingsToDoList: React.FC = () => {
  const [filter, setFilter] = useState<Category>('all');

  const ThingsToDoMap = useMemo(() => dynamic(() => import('./ThingsToDoMap'), {
    ssr: false,
    loading: () => <div className="bg-gray-200 dark:bg-gray-800 animate-pulse w-full h-full" />,
  }), []);

  const filteredAttractions =
    filter === 'all'
      ? attractions
      : attractions.filter((attraction) => attraction.category === filter);

  return (
    <div>
      <div className="flex justify-center gap-2 mb-8 flex-wrap print:hidden">
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => setFilter(category)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              filter === category
                ? 'bg-rose-700 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-rose-200 dark:hover:bg-rose-800'
            }`}
          >
            {category.charAt(0).toUpperCase() + category.slice(1)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8" style={{ minHeight: '600px' }}>
        <div className="relative h-96 lg:h-full rounded-lg overflow-hidden shadow-lg print:hidden">
          <ThingsToDoMap attractions={filteredAttractions} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 print:grid-cols-2 print:overflow-visible">
          {filteredAttractions.map((attraction) => (
            <ThingsToDoCard key={attraction.name} attraction={attraction} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default ThingsToDoList;
