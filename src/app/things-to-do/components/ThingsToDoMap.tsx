'use client';

import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import type { AttractionDTO } from '@/features/attractions';
import { resolveDirectionsUrl } from '@/utils/maps';
import { useTheme } from '@/components/ThemeProvider';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

function escapeHtml(str: string) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function createMapMarkerIcon(title: string) {
  const safeTitle = escapeHtml(title);
  return L.divIcon({
    className: 'custom-map-pin',
    html: `<div class="map-marker-wrapper" role="img" aria-label="${safeTitle}" style="width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; cursor: pointer;"><svg width="32" height="42" viewBox="0 0 32 42" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px var(--map-marker-shadow-color, rgba(0, 0, 0, 0.3)));"><path d="M16 0C7.163 0 0 7.163 0 16c0 12 16 26 16 26s16-14 16-26C32 7.163 24.837 0 16 0z" fill="var(--map-marker-pin-color, var(--color-primary, #B91C1C))" stroke="var(--map-marker-border-color, #ffffff)" stroke-width="2"/><circle cx="16" cy="16" r="6" fill="var(--map-marker-border-color, #ffffff)"/></svg></div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 44],
    popupAnchor: [0, -42],
  });
}

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
  const { resolvedTheme } = useTheme();

  if (typeof window === 'undefined') {
    return null;
  }

  const tileUrl = resolvedTheme === 'dark'
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

  const tileAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

  return (
    <MapContainer center={defaultCenter} zoom={13} style={{ height: '100%', width: '100%' }}>
      <MapController attractions={attractions} defaultCenter={defaultCenter} />
      <TileLayer
        url={tileUrl}
        attribution={tileAttribution}
      />
      {attractions.map((attraction) => {
        const directionsUrl = resolveDirectionsUrl(attraction);
        const icon = createMapMarkerIcon(attraction.name);

        return (
          <Marker key={attraction.name} position={[attraction.latitude, attraction.longitude]} icon={icon}>
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
