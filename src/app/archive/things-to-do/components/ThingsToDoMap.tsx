'use client';

import React from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { Attraction } from '@/data/things-to-do';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconRetina from 'leaflet/dist/images/marker-icon-2x.png';
import shadow from 'leaflet/dist/images/marker-shadow.png';

// Fix for default icon issue with webpack
// We use local imports instead of unpkg URLs to ensure stability and version consistency.
L.Icon.Default.mergeOptions({
  iconRetinaUrl: iconRetina.src,
  iconUrl: icon.src,
  shadowUrl: shadow.src,
});

/**
 * @interface ThingsToDoMapProps
 * @description Defines the props for the ThingsToDoMap component.
 * @property {Attraction[]} attractions - An array of attraction objects to be displayed as markers on the map.
 */
interface ThingsToDoMapProps {
  attractions: Attraction[];
}

/**
 * @function ThingsToDoMap
 * @description A React component that displays a Leaflet map with markers for attractions.
 * This component is client-side only and will not render on the server.
 * @param {ThingsToDoMapProps} props - The props for the component.
 * @returns {JSX.Element | null} The rendered ThingsToDoMap component, or null if on the server.
 */
const ThingsToDoMap: React.FC<ThingsToDoMapProps> = ({ attractions }) => {
  if (typeof window === 'undefined') {
    return null;
  }

  return (
    <MapContainer center={[44.0232, -92.4679]} zoom={13} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      {attractions.map((attraction) => (
        <Marker key={attraction.name} position={[attraction.latitude, attraction.longitude]}>
          <Popup>
            <b>{attraction.name}</b>
            <br />
            <a href={attraction.directions} target="_blank" rel="noopener noreferrer">
              Directions
            </a>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
};

export default ThingsToDoMap;
