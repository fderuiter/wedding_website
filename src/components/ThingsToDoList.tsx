'use client'

import React, { useState } from 'react';
import { attractions } from '@/data/things-to-do';
import ThingsToDoCard from './ThingsToDoCard';

const categories = ['all', 'food', 'coffee', 'park', 'museum'] as const;
type Category = typeof categories[number];

const ThingsToDoList: React.FC = () => {
  const [filter, setFilter] = useState<Category>('all');

  const filteredAttractions =
    filter === 'all'
      ? attractions
      : attractions.filter((attraction) => attraction.category === filter);

  return (
    <div>
      <div className="flex justify-center gap-2 mb-8">
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {filteredAttractions.map((attraction) => (
          <ThingsToDoCard key={attraction.name} attraction={attraction} />
        ))}
      </div>
    </div>
  );
};

export default ThingsToDoList;
