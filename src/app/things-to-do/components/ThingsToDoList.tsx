'use client';

import React, { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import ThingsToDoCard from './ThingsToDoCard';
import type { VenueMapPin } from './ThingsToDoMap';
import type { AttractionDTO } from '@/features/attractions';
import { useFilter } from '@/hooks/useFilter';
import { CategoryFilter } from '@/components/ui/CategoryFilter';
import EmptyState from '@/components/EmptyState';
import { useOptionalDemo } from '@/components/demo/DemoContext';
import { useStaticDemoPageOverrides } from '@/lib/staticDemo/runtime';

interface ThingsToDoListProps {
  attractions: AttractionDTO[];
  defaultCenter?: [number, number];
  venue?: VenueMapPin | null;
}

const ThingsToDoMap = dynamic(() => import('./ThingsToDoMap'), {
  ssr: false,
  loading: () => <div className="bg-gray-200 dark:bg-gray-800 animate-pulse w-full h-full" />,
});

const ThingsToDoList: React.FC<ThingsToDoListProps> = ({
  attractions: initialAttractions,
  defaultCenter,
  venue,
}) => {
  const demo = useOptionalDemo();
  const demoOverrides = useStaticDemoPageOverrides();
  const [draftAttractions, setDraftAttractions] = useState<AttractionDTO[] | null>(null);
  const attractions =
    draftAttractions ??
    (demo?.isDemoMode
      ? demo.activeDataset.attractions
      : (demoOverrides?.attractions ?? initialAttractions));

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
          setDraftAttractions(event.data.draftData);
        }
      };
      window.addEventListener('message', handleMessage);
      return () => window.removeEventListener('message', handleMessage);
    }
  }, []);

  let effectiveCenter = defaultCenter;
  let effectiveVenue = venue;
  if (demo?.isDemoMode) {
    const overrideLat = demo.configOverrides.latitude;
    const overrideLng = demo.configOverrides.longitude;
    if (
      typeof overrideLat === 'number' &&
      typeof overrideLng === 'number' &&
      Number.isFinite(overrideLat) &&
      Number.isFinite(overrideLng) &&
      (overrideLat !== 0 || overrideLng !== 0)
    ) {
      effectiveCenter = [overrideLat, overrideLng];
      effectiveVenue = {
        name: demo.configOverrides.venueName?.trim() || venue?.name || 'Wedding Venue',
        address: demo.configOverrides.venueAddress?.trim() || venue?.address || '',
        latitude: overrideLat,
        longitude: overrideLng,
      };
    } else if (demo.archetype === 'destination') {
      effectiveCenter = [25.7743, -80.1304];
      effectiveVenue = {
        name: 'Oceanview Palms Beachfront Pavilion',
        address: '450 Ocean Drive, Miami Beach, FL 33139',
        latitude: 25.7743,
        longitude: -80.1304,
      };
    } else if (demo.archetype === 'romantic') {
      effectiveCenter = [38.2975, -122.2869];
      effectiveVenue = {
        name: 'Willow Creek Botanical Arbor',
        address: '1120 Silverado Trail, Napa, CA 94558',
        latitude: 38.2975,
        longitude: -122.2869,
      };
    }
  } else if (
    demoOverrides?.config &&
    Number.isFinite(demoOverrides.config.latitude) &&
    Number.isFinite(demoOverrides.config.longitude) &&
    (demoOverrides.config.latitude !== 0 || demoOverrides.config.longitude !== 0)
  ) {
    effectiveCenter = [demoOverrides.config.latitude, demoOverrides.config.longitude];
    effectiveVenue = {
      name: demoOverrides.config.venueName?.trim() || venue?.name || 'Wedding Venue',
      address: demoOverrides.config.venueAddress?.trim() || venue?.address || '',
      latitude: demoOverrides.config.latitude,
      longitude: demoOverrides.config.longitude,
    };
  }

  const venueCoords = effectiveVenue
    ? { latitude: effectiveVenue.latitude, longitude: effectiveVenue.longitude }
    : effectiveCenter
      ? { latitude: effectiveCenter[0], longitude: effectiveCenter[1] }
      : undefined;

  return (
    <div>
      <div className="flex justify-center gap-2 mb-8 flex-wrap print:hidden">
        <CategoryFilter
          categories={categories}
          selected={selectedCategories}
          onChange={setSelectedCategories}
          label="Filter attractions by category"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8" style={{ minHeight: '600px' }}>
        <div className="relative h-96 lg:h-full rounded-lg overflow-hidden shadow-lg print:hidden">
          <ThingsToDoMap
            attractions={filteredAttractions}
            defaultCenter={effectiveCenter}
            venue={effectiveVenue}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 print:grid-cols-2 print:overflow-visible">
          {filteredAttractions.length === 0 ? (
            <div className="col-span-full">
              <EmptyState
                message={
                  selectedCategories.length > 0
                    ? 'No attractions match the selected categories.'
                    : 'No attractions have been added yet. Please check back later!'
                }
                onAction={selectedCategories.length > 0 ? () => setSelectedCategories([]) : undefined}
                actionLabel={selectedCategories.length > 0 ? 'Clear filters' : undefined}
              />
            </div>
          ) : (
            filteredAttractions.map((attraction) => (
              <ThingsToDoCard
                key={attraction.id || attraction.name}
                attraction={attraction}
                venueCoords={venueCoords}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default ThingsToDoList;
