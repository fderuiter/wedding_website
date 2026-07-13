'use client'

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import ThingsToDoCard from './ThingsToDoCard';
import type { AttractionDTO } from '@/features/attractions/schemas';
import { useFilter } from '@/hooks/useFilter';
import { CategoryFilter } from '@/components/ui/CategoryFilter';

const getSafeUrl = (url: string | undefined): string => {
  if (!url) return '#';
  try {
    const parsed = new URL(url);
    if (['http:', 'https:'].includes(parsed.protocol)) {
      let safeUrl = parsed.href;
      if (!url.endsWith('/') && safeUrl.endsWith('/')) {
        safeUrl = safeUrl.slice(0, -1);
      }
      return safeUrl;
    }
    return '#';
  } catch {
    return '#';
  }
};

interface ThingsToDoListProps {
  attractions: AttractionDTO[];
}

const ThingsToDoList: React.FC<ThingsToDoListProps> = ({ attractions: initialAttractions }) => {
  const [attractions, setAttractions] = useState(initialAttractions);

  const {
    categories,
    selectedCategories,
    setSelectedCategories,
    filteredItems: filteredAttractions,
  } = useFilter(attractions, useCallback((attraction: AttractionDTO) => attraction.category, []));

  useEffect(() => {
    if (typeof window !== 'undefined' && window !== window.parent) {
      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'DRAFT_UPDATE' && event.data.draftType === 'attractions') {
          setAttractions(event.data.draftData);
        }
      };
      window.addEventListener('message', handleMessage);
      return () => window.removeEventListener('message', handleMessage);
    }
  }, []);

  const ThingsToDoMap = useMemo(() => dynamic(() => import('./ThingsToDoMap'), {
    ssr: false,
    loading: () => <div className="bg-gray-200 dark:bg-gray-800 animate-pulse w-full h-full" />,
  }), []);

  return (
    <div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {filteredAttractions.length} attraction{filteredAttractions.length === 1 ? '' : 's'} available.
      </div>

      <div className="flex justify-center gap-2 mb-8 flex-wrap print:hidden">
        <CategoryFilter
          categories={categories}
          selected={selectedCategories}
          onChange={setSelectedCategories}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8" style={{ minHeight: '600px' }}>
        <div className="relative h-96 lg:h-full rounded-lg overflow-hidden shadow-lg print:hidden" aria-hidden="true">
          <ThingsToDoMap attractions={filteredAttractions} />
        </div>

        <div className="sr-only" role="grid" aria-label="Attractions Grid Alternative">
          <div role="rowgroup">
            <div role="row">
              <span role="columnheader">Name</span>
              <span role="columnheader">Category</span>
              <span role="columnheader">Directions</span>
            </div>
          </div>
          <div role="rowgroup">
            {filteredAttractions.map((attraction) => (
              <div key={attraction.id || attraction.name} role="row">
                <span role="gridcell">{attraction.name}</span>
                <span role="gridcell">{attraction.category}</span>
                <span role="gridcell">
                  <a href={getSafeUrl(attraction.directions)} target="_blank" rel="noopener noreferrer" tabIndex={-1}>
                    Directions to {attraction.name}
                  </a>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 print:grid-cols-2 print:overflow-visible">
          {filteredAttractions.map((attraction) => (
            <ThingsToDoCard key={attraction.id || attraction.name} attraction={attraction} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default ThingsToDoList;
