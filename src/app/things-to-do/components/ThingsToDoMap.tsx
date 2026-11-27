'use client';

import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import type { AttractionDTO } from '@/features/attractions';
import {
  resolveDirectionsUrl,
  hasValidCoordinates,
  isNonPlaceholderVenueText,
} from '@/utils/maps';
import { useTheme } from '@/components/ThemeProvider';
import { AccessibleExternalLink } from '@/components/ui/AccessibleExternalLink';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

declare module 'react-leaflet' {
  interface MapContainerProps {
    role?: string;
    'aria-label'?: string;
  }
}

export interface VenueMapPin {
  name?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

const TEMPERATE_FALLBACK_CENTER: [number, number] = [40.7128, -74.006];

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

export function createVenueMarkerIcon(title: string) {
  const safeTitle = escapeHtml(title);
  return L.divIcon({
    className: 'custom-venue-map-pin',
    html: `<div class="map-marker-wrapper" role="img" aria-label="${safeTitle}" style="width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; cursor: pointer;"><svg width="34" height="44" viewBox="0 0 34 44" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 5px var(--map-marker-shadow-color, rgba(0, 0, 0, 0.35)));"><path d="M17 1C8.716 1 2 7.716 2 16c0 11.5 15 26 15 26s15-14.5 15-26C32 7.716 25.284 1 17 1z" fill="var(--color-secondary, #B45309)" stroke="var(--map-marker-border-color, #ffffff)" stroke-width="2.5"/><path d="M17 9.5l2.12 4.3 4.74.69-3.43 3.34.81 4.72L17 20.32l-4.24 2.23.81-4.72-3.43-3.34 4.74-.69L17 9.5z" fill="var(--map-marker-border-color, #ffffff)"/></svg></div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 44],
    popupAnchor: [0, -42],
  });
}

/**
 * Calculates geographic bounds and centroid from valid non-zero attraction and venue coordinates.
 */
export function calculateBoundsAndCentroid(
  attractions: AttractionDTO[],
  defaultCenter: [number, number] = [0.0, 0.0],
  venue?: VenueMapPin | null
) {
  const validAttractions = attractions.filter((a) =>
    hasValidCoordinates(a.latitude, a.longitude)
  );

  const points: Array<[number, number]> = validAttractions.map((a) => [
    a.latitude,
    a.longitude,
  ]);

  if (venue && hasValidCoordinates(venue.latitude, venue.longitude)) {
    points.push([venue.latitude as number, venue.longitude as number]);
  }

  const safeFallbackCenter: [number, number] = hasValidCoordinates(
    defaultCenter?.[0],
    defaultCenter?.[1]
  )
    ? [defaultCenter[0], defaultCenter[1]]
    : TEMPERATE_FALLBACK_CENTER;

  if (points.length === 0) {
    return {
      bounds: null,
      centroid: safeFallbackCenter,
      count: 0,
      validAttractions,
    };
  }

  if (points.length === 1) {
    const point = points[0];
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

  for (const [lat, lng] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }

  const bounds: [[number, number], [number, number]] = [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
  const centroid: [number, number] = [(minLat + maxLat) / 2, (minLng + maxLng) / 2];

  return {
    bounds,
    centroid,
    count: points.length,
    validAttractions,
  };
}

interface MapControllerProps {
  attractions: AttractionDTO[];
  defaultCenter: [number, number];
  venue?: VenueMapPin | null;
}

const MapController: React.FC<MapControllerProps> = ({ attractions, defaultCenter, venue }) => {
  const map = useMap();
  const defaultLat = defaultCenter[0];
  const defaultLng = defaultCenter[1];
  const venueLat = venue?.latitude;
  const venueLng = venue?.longitude;

  useEffect(() => {
    if (!map) return;
    const center: [number, number] = [defaultLat, defaultLng];
    const venuePin =
      hasValidCoordinates(venueLat, venueLng)
        ? { latitude: venueLat, longitude: venueLng }
        : null;
    const { bounds, centroid, count } = calculateBoundsAndCentroid(attractions, center, venuePin);

    if (count === 0) {
      map.setView(centroid, 13);
    } else if (count === 1 && centroid) {
      map.setView(centroid, 14);
    } else if (bounds) {
      const isSingleIdenticalLocation =
        bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1];
      if (isSingleIdenticalLocation && centroid) {
        map.setView(centroid, 14);
      } else {
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    }
  }, [map, attractions, defaultLat, defaultLng, venueLat, venueLng]);

  useEffect(() => {
    if (!map || typeof map.on !== 'function' || typeof map.off !== 'function') {
      return;
    }

    type PopupWithSource = L.Popup & {
      _source?: {
        getElement?: () => HTMLElement | null;
      };
    };

    let activePopupInstance: L.Popup | null = null;
    let activeOriginMarker: HTMLElement | null = null;
    let pendingCloseFocusFrame: number | null = null;
    let activePopupCleanups: Array<() => void> = [];

    const clearPopupListeners = () => {
      for (const cleanup of activePopupCleanups) {
        cleanup();
      }
      activePopupCleanups = [];
    };

    const focusPopupElement = (popup: L.Popup) => {
      const popupEl = popup.getElement?.() ?? null;
      if (!popupEl) return;

      const interactiveTarget = popupEl.querySelector<HTMLElement>(
        '.leaflet-popup-content a[href], .leaflet-popup-content button:not(:disabled), .leaflet-popup-content [tabindex]:not([tabindex="-1"]), .leaflet-popup-close-button'
      );
      if (interactiveTarget) {
        interactiveTarget.focus();
        return;
      }

      const contentWrapper =
        popupEl.querySelector<HTMLElement>('.leaflet-popup-content') ?? popupEl;
      if (!contentWrapper.hasAttribute('tabindex')) {
        contentWrapper.setAttribute('tabindex', '-1');
      }
      contentWrapper.focus();
    };

    const handlePopupOpen = (event: L.PopupEvent) => {
      if (event.popup === activePopupInstance) {
        return;
      }
      activePopupInstance = event.popup;

      if (pendingCloseFocusFrame !== null) {
        cancelAnimationFrame(pendingCloseFocusFrame);
        pendingCloseFocusFrame = null;
      }
      clearPopupListeners();

      const sourceMarker = (event.popup as PopupWithSource)?._source?.getElement?.() ?? null;
      const fallbackActiveMarker =
        document.activeElement instanceof HTMLElement &&
        document.activeElement.classList.contains('leaflet-marker-icon')
          ? document.activeElement
          : null;

      activeOriginMarker = sourceMarker ?? fallbackActiveMarker ?? activeOriginMarker;

      const popupEl = event.popup.getElement?.() ?? null;
      if (popupEl) {
        const handlePopupKeyDown = (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (typeof map.closePopup === 'function') {
              map.closePopup(event.popup);
            }
          }
        };
        popupEl.addEventListener('keydown', handlePopupKeyDown);
        activePopupCleanups.push(() => {
          popupEl.removeEventListener('keydown', handlePopupKeyDown);
        });
      }

      const ensurePopupFocus = (preferPrimaryContentControl: boolean): boolean => {
        const currentPopupEl = event.popup.getElement?.() ?? null;
        if (!currentPopupEl || !currentPopupEl.isConnected) {
          return false;
        }

        const primaryContentControl = currentPopupEl.querySelector<HTMLElement>(
          '.leaflet-popup-content a[href], .leaflet-popup-content button:not(:disabled), .leaflet-popup-content [tabindex]:not([tabindex="-1"])'
        );
        if (preferPrimaryContentControl && primaryContentControl) {
          if (document.activeElement !== primaryContentControl) {
            primaryContentControl.focus();
          }
          return document.activeElement === primaryContentControl;
        }

        if (!currentPopupEl.contains(document.activeElement)) {
          focusPopupElement(event.popup);
        }
        return currentPopupEl.contains(document.activeElement);
      };

      const isFocusStillUnclaimed = () => {
        const activeEl = document.activeElement;
        return (
          !activeEl ||
          activeEl === document.body ||
          activeEl === document.documentElement ||
          activeEl === activeOriginMarker
        );
      };

      focusPopupElement(event.popup);

      let initialPortalUpgradeDone = false;
      if (popupEl && typeof MutationObserver !== 'undefined') {
        const observer = new MutationObserver(() => {
          if (!popupEl.isConnected) {
            return;
          }
          const activeEl = document.activeElement;
          const unclaimed = isFocusStillUnclaimed();

          if (!initialPortalUpgradeDone) {
            const hasPrimaryControl = Boolean(
              popupEl.querySelector(
                '.leaflet-popup-content a[href], .leaflet-popup-content button:not(:disabled)'
              )
            );
            if (hasPrimaryControl && (unclaimed || popupEl.contains(activeEl))) {
              if (ensurePopupFocus(true)) {
                initialPortalUpgradeDone = true;
              }
              return;
            }
          }

          if (unclaimed) {
            ensurePopupFocus(true);
          }
        });

        observer.observe(popupEl, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['style'],
        });
        activePopupCleanups.push(() => observer.disconnect());
      }

      let rafId: number | null = null;
      let attempts = 0;
      const maxAttempts = 40;

      const pollUntilFocused = () => {
        rafId = null;
        const currentPopupEl = event.popup.getElement?.() ?? null;
        if (!currentPopupEl || !currentPopupEl.isConnected) {
          return;
        }

        const hasPrimaryControl = Boolean(
          currentPopupEl.querySelector(
            '.leaflet-popup-content a[href], .leaflet-popup-content button:not(:disabled)'
          )
        );

        if (isFocusStillUnclaimed() || (hasPrimaryControl && !initialPortalUpgradeDone && currentPopupEl.contains(document.activeElement))) {
          const focused = ensurePopupFocus(true);
          if (focused && (hasPrimaryControl || attempts >= 3)) {
            if (hasPrimaryControl) {
              initialPortalUpgradeDone = true;
            }
            return;
          }
        } else if (currentPopupEl.contains(document.activeElement)) {
          return;
        } else {
          // Focus explicitly moved elsewhere by user
          return;
        }

        attempts += 1;
        if (attempts < maxAttempts) {
          rafId = requestAnimationFrame(pollUntilFocused);
        }
      };

      rafId = requestAnimationFrame(pollUntilFocused);

      const handleMapSettle = () => {
        if (isFocusStillUnclaimed()) {
          ensurePopupFocus(true);
        }
      };
      map.on('zoomend', handleMapSettle);
      map.on('moveend', handleMapSettle);

      activePopupCleanups.push(() => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (typeof map.off === 'function') {
          map.off('zoomend', handleMapSettle);
          map.off('moveend', handleMapSettle);
        }
      });
    };

    const handlePopupClose = (event: L.PopupEvent) => {
      if (activePopupInstance === event.popup) {
        activePopupInstance = null;
      }
      clearPopupListeners();
      const closingPopupEl = event.popup.getElement?.() ?? null;
      const sourceMarker =
        (event.popup as PopupWithSource)?._source?.getElement?.() ?? activeOriginMarker;
      activeOriginMarker = null;

      if (!sourceMarker) return;

      const restoreFocusIfAppropriate = () => {
        if (!sourceMarker.isConnected) return;
        const activeEl = document.activeElement;
        const activePopupEl =
          activeEl instanceof HTMLElement ? activeEl.closest('.leaflet-popup') : null;
        const movedToAnotherMarkerOrPopup =
          activeEl instanceof HTMLElement &&
          activeEl !== sourceMarker &&
          (activeEl.classList.contains('leaflet-marker-icon') ||
            Boolean(activePopupEl && activePopupEl !== closingPopupEl));
        if (!movedToAnotherMarkerOrPopup) {
          sourceMarker.focus();
        }
      };

      restoreFocusIfAppropriate();
      if (pendingCloseFocusFrame !== null) {
        cancelAnimationFrame(pendingCloseFocusFrame);
      }
      pendingCloseFocusFrame = requestAnimationFrame(() => {
        pendingCloseFocusFrame = null;
        restoreFocusIfAppropriate();
      });
    };

    map.on('popupopen', handlePopupOpen);
    map.on('popupclose', handlePopupClose);

    return () => {
      if (pendingCloseFocusFrame !== null) {
        cancelAnimationFrame(pendingCloseFocusFrame);
      }
      clearPopupListeners();
      if (typeof map.off === 'function') {
        map.off('popupopen', handlePopupOpen);
        map.off('popupclose', handlePopupClose);
      }
    };
  }, [map]);

  return null;
};

/**
 * @interface ThingsToDoMapProps
 * @description Defines the props for the ThingsToDoMap component.
 * @property {AttractionDTO[]} attractions - An array of attraction objects to be displayed as markers on the map.
 * @property {[number, number]} [defaultCenter] - Default center coordinates [latitude, longitude] fallback.
 * @property {VenueMapPin | null} [venue] - Optional primary wedding venue marker details.
 */
interface ThingsToDoMapProps {
  attractions: AttractionDTO[];
  defaultCenter?: [number, number];
  venue?: VenueMapPin | null;
}

/**
 * @function ThingsToDoMap
 * @description A React component that displays a Leaflet map with markers for the wedding venue and attractions.
 * Filters out invalid (0, 0) coordinates and renders an empty placeholder when no valid coordinates exist.
 */
const ThingsToDoMap: React.FC<ThingsToDoMapProps> = ({
  attractions,
  defaultCenter = [0.0, 0.0],
  venue,
}) => {
  const { resolvedTheme } = useTheme();

  if (typeof window === 'undefined') {
    return null;
  }

  const hasValidDefaultCenter = hasValidCoordinates(defaultCenter?.[0], defaultCenter?.[1]);
  const hasValidVenue = Boolean(venue && hasValidCoordinates(venue.latitude, venue.longitude));
  const { validAttractions, centroid } = calculateBoundsAndCentroid(
    attractions,
    defaultCenter,
    venue
  );

  if (validAttractions.length === 0 && !hasValidVenue && !hasValidDefaultCenter) {
    return (
      <div
        role="region"
        aria-label="Things to do map"
        data-testid="map-empty-placeholder"
        className="h-full w-full min-h-[24rem] flex flex-col items-center justify-center p-6 text-center bg-gray-100 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-lg"
      >
        <p className="text-base font-semibold text-gray-800 dark:text-gray-100">
          Map locations coming soon
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-sm">
          Interactive pins will appear here once venue or local attraction coordinates are configured.
        </p>
      </div>
    );
  }

  const initialCenter: [number, number] = hasValidDefaultCenter
    ? [defaultCenter[0], defaultCenter[1]]
    : centroid;

  const isStaticDemo =
    typeof document !== 'undefined' && document.documentElement.dataset.staticDemo === 'true';

  const offlineLightTile =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" fill="#F1F5F9"/><path d="M0 64H256M0 128H256M0 192H256M64 0V256M128 0V256M192 0V256" stroke="#CBD5E1" stroke-width="1"/><path d="M0 24L256 216M36 256L228 0" stroke="#E2E8F0" stroke-width="4"/></svg>'
    );
  const offlineDarkTile =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" fill="#1E293B"/><path d="M0 64H256M0 128H256M0 192H256M64 0V256M128 0V256M192 0V256" stroke="#334155" stroke-width="1"/><path d="M0 24L256 216M36 256L228 0" stroke="#0F172A" stroke-width="4"/></svg>'
    );

  const tileUrl = isStaticDemo
    ? resolvedTheme === 'dark'
      ? offlineDarkTile
      : offlineLightTile
    : resolvedTheme === 'dark'
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

  const tileAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

  const venueTitle =
    venue && isNonPlaceholderVenueText(venue.name) ? venue.name!.trim() : 'Wedding Venue';
  const venueDirectionsUrl = hasValidVenue
    ? resolveDirectionsUrl({
      latitude: venue!.latitude,
      longitude: venue!.longitude,
      directions: venue?.address || venueTitle,
    })
    : undefined;

  return (
    <MapContainer
      center={initialCenter}
      zoom={13}
      style={{ height: '100%', width: '100%' }}
      role="region"
      aria-label="Things to do map"
    >
      <MapController attractions={attractions} defaultCenter={initialCenter} venue={venue} />
      <TileLayer
        url={tileUrl}
        attribution={tileAttribution}
      />
      {hasValidVenue && (
        <Marker
          key="__wedding_venue_pin__"
          position={[venue!.latitude as number, venue!.longitude as number]}
          icon={createVenueMarkerIcon(`Wedding Venue: ${venueTitle}`)}
        >
          <Popup>
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-secondary">
                Wedding Venue
              </div>
              <b>{venueTitle}</b>
              {venue?.address && isNonPlaceholderVenueText(venue.address) && (
                <div>{venue.address}</div>
              )}
              {venueDirectionsUrl && (
                <div>
                  <AccessibleExternalLink
                    href={venueDirectionsUrl}
                    srContext={`to ${venueTitle}`}
                  >
                    Directions
                  </AccessibleExternalLink>
                </div>
              )}
            </div>
          </Popup>
        </Marker>
      )}
      {validAttractions.map((attraction) => {
        const directionsUrl = resolveDirectionsUrl(attraction);
        const icon = createMapMarkerIcon(attraction.name);

        return (
          <Marker
            key={attraction.id || attraction.name}
            position={[attraction.latitude, attraction.longitude]}
            icon={icon}
          >
            <Popup>
              <b>{attraction.name}</b>
              {directionsUrl && (
                <>
                  <br />
                  <AccessibleExternalLink
                    href={directionsUrl}
                    aria-label={`Directions to ${attraction.name}`}
                  >
                    Directions
                  </AccessibleExternalLink>
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
