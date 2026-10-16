'use client';

import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import type { AttractionDTO } from '@/features/attractions';
import { resolveDirectionsUrl } from '@/utils/maps';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconRetina from 'leaflet/dist/images/marker-icon-2x.png';
import shadow from 'leaflet/dist/images/marker-shadow.png';

// Fix for default icon issue with webpack
// We use local imports instead of unpkg URLs to ensure stability and version consistency.
L.Icon.Default.mergeOptions({
  iconRetinaUrl: typeof iconRetina === 'string' ? iconRetina : iconRetina.src || (iconRetina as any).default,
  iconUrl: typeof icon === 'string' ? icon : icon.src || (icon as any).default,
  shadowUrl: typeof shadow === 'string' ? shadow : shadow.src || (shadow as any).default,
});

/**
 * Calculates geographic bounds and centroid from valid attraction coordinates.
 */
export function calculateBoundsAndCentroid(
  attractions: AttractionDTO[],
  defaultCenter: [number, number] = [0.0, 0.0]
) {
  const validAttractions = attractions.filter(
    (a) =>
      typeof a.latitude === 'number' &&
      typeof a.longitude === 'number' &&
      !isNaN(a.latitude) &&
      !isNaN(a.longitude)
  );

  if (validAttractions.length === 0) {
    return {
      bounds: null,
      centroid: defaultCenter,
      count: 0,
      validAttractions,
    };
  }

  if (validAttractions.length === 1) {
    const single = validAttractions[0];
    const point: [number, number] = [single.latitude, single.longitude];
    return {
      bounds: [point, point] as [[number, number], [number, number]],
      centroid: point,
      count: 1,
      validAttractions,
    };
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const a of validAttractions) {
    if (a.latitude < minLat) minLat = a.latitude;
    if (a.latitude > maxLat) maxLat = a.latitude;
    if (a.longitude < minLng) minLng = a.longitude;
    if (a.longitude > maxLng) maxLng = a.longitude;
  }

  const bounds: [[number, number], [number, number]] = [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
  const centroid: [number, number] = [(minLat + maxLat) / 2, (minLng + maxLng) / 2];

  return {
    bounds,
    centroid,
    count: validAttractions.length,
    validAttractions,
  };
}

interface MapControllerProps {
  attractions: AttractionDTO[];
  defaultCenter: [number, number];
}

const MapController: React.FC<MapControllerProps> = ({ attractions, defaultCenter }) => {
  const map = useMap();
  const defaultLat = defaultCenter[0];
  const defaultLng = defaultCenter[1];

  useEffect(() => {
    if (!map) return;
    const center: [number, number] = [defaultLat, defaultLng];
    const { bounds, centroid, count } = calculateBoundsAndCentroid(attractions, center);

    if (count === 0) {
      map.setView(center, 13);
    } else if (count === 1 && centroid) {
      map.setView(centroid, 14);
    } else if (bounds) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [map, attractions, defaultLat, defaultLng]);

  return null;
};

/**
 * @interface ThingsToDoMapProps
 * @description Defines the props for the ThingsToDoMap component.
 * @property {AttractionDTO[]} attractions - An array of attraction objects to be displayed as markers on the map.
 * @property {[number, number]} [defaultCenter] - Default center coordinates [latitude, longitude] fallback.
 */
interface ThingsToDoMapProps {
  attractions: AttractionDTO[];
  defaultCenter?: [number, number];
}

/**
 * @function ThingsToDoMap
 * @description A React component that displays a Leaflet map with markers for attractions.
 * This component is client-side only and will not render on the server.
 * @param {ThingsToDoMapProps} props - The props for the component.
 * @returns {JSX.Element | null} The rendered ThingsToDoMap component, or null if on the server.
 */
const ThingsToDoMap: React.FC<ThingsToDoMapProps> = ({ attractions, defaultCenter = [0.0, 0.0] }) => {
  if (typeof window === 'undefined') {
    return null;
  }

  return (
    <MapContainer center={defaultCenter} zoom={13} style={{ height: '100%', width: '100%' }}>
      <MapController attractions={attractions} defaultCenter={defaultCenter} />
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      {attractions.map((attraction) => {
        const directionsUrl = resolveDirectionsUrl(attraction);

        return (
          <Marker key={attraction.name} position={[attraction.latitude, attraction.longitude]}>
            <Popup>
              <b>{attraction.name}</b>
              {directionsUrl && (
                <>
                  <br />
                  <a href={directionsUrl} target="_blank" rel="noopener noreferrer">
                    Directions
                  </a>
                </>
              )}
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
};

export default ThingsToDoMap;
