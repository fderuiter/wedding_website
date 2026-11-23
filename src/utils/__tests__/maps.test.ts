import {
  resolveDirectionsUrl,
  hasValidCoordinates,
  isNonPlaceholderVenueText,
  formatVenueStreetAddress,
  formatFullVenueLocation,
  joinEventLocations,
  calculateDistanceMiles,
  formatDistanceFromVenue,
  type VenueAddressParts,
  type LatLonCoordinates,
} from '../maps';

describe('resolveDirectionsUrl', () => {
  it('returns undefined when location is null or undefined', () => {
    expect(resolveDirectionsUrl(null)).toBeUndefined();
    expect(resolveDirectionsUrl(undefined)).toBeUndefined();
  });

  it('returns custom directions URL if it is valid and safe', () => {
    const location = {
      directions: 'https://maps.google.com/custom',
      latitude: 45.0,
      longitude: -90.0,
    };
    expect(resolveDirectionsUrl(location)).toBe('https://maps.google.com/custom');
  });

  it('maps plain text address directions to a Google Maps destination URL', () => {
    const location = {
      directions: '500 Floral Way',
      latitude: 0,
      longitude: 0,
    };
    expect(resolveDirectionsUrl(location)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=500%20Floral%20Way'
    );
  });

  it('falls back to Google Maps directions URL when directions is missing but coordinates are valid', () => {
    const location = {
      directions: '',
      latitude: 45.0,
      longitude: -90.0,
    };
    expect(resolveDirectionsUrl(location)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=45,-90'
    );
  });

  it('falls back to Google Maps directions URL when directions is null', () => {
    const location = {
      directions: null,
      latitude: 45.1234,
      longitude: -90.5678,
    };
    expect(resolveDirectionsUrl(location)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=45.1234,-90.5678'
    );
  });

  it('falls back to Google Maps directions URL when directions URL is invalid or unsafe', () => {
    const location = {
      directions: 'javascript:alert(1)',
      latitude: 45.0,
      longitude: -90.0,
    };
    expect(resolveDirectionsUrl(location)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=45,-90'
    );
  });

  it('returns undefined for zero coordinates (0, 0)', () => {
    const location = {
      directions: '',
      latitude: 0,
      longitude: 0,
    };
    expect(resolveDirectionsUrl(location)).toBeUndefined();
  });

  it('handles zero latitude with non-zero longitude', () => {
    const location = {
      directions: null,
      latitude: 0,
      longitude: -92.4679,
    };
    expect(resolveDirectionsUrl(location)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=0,-92.4679'
    );
  });

  it('handles non-zero latitude with zero longitude', () => {
    const location = {
      directions: null,
      latitude: 51.4778,
      longitude: 0,
    };
    expect(resolveDirectionsUrl(location)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=51.4778,0'
    );
  });

  it('returns undefined when coordinates are missing or non-numeric', () => {
    expect(
      resolveDirectionsUrl({ directions: '', latitude: NaN, longitude: -90.0 })
    ).toBeUndefined();
    expect(
      resolveDirectionsUrl({ directions: null, latitude: 45.0, longitude: null })
    ).toBeUndefined();
    expect(
      resolveDirectionsUrl({ directions: '', latitude: undefined, longitude: undefined })
    ).toBeUndefined();
    expect(
      resolveDirectionsUrl({ directions: '', latitude: '45.0' as unknown as number, longitude: -90.0 })
    ).toBeUndefined();
  });

  it('returns undefined when coordinates are out of bounds or infinite', () => {
    expect(
      resolveDirectionsUrl({ directions: '', latitude: 95.0, longitude: -90.0 })
    ).toBeUndefined();
    expect(
      resolveDirectionsUrl({ directions: '', latitude: 45.0, longitude: -200.0 })
    ).toBeUndefined();
    expect(
      resolveDirectionsUrl({ directions: '', latitude: Infinity, longitude: -90.0 })
    ).toBeUndefined();
  });

  it('formats Google Maps URL for plain text street addresses without coordinates', () => {
    expect(
      resolveDirectionsUrl({ directions: '500 Floral Way', latitude: 0, longitude: 0 })
    ).toBe('https://www.google.com/maps/dir/?api=1&destination=500%20Floral%20Way');
  });

  it('uses coordinates when available even if plain text address is provided', () => {
    expect(
      resolveDirectionsUrl({ directions: '500 Floral Way', latitude: 37.7749, longitude: -122.4194 })
    ).toBe('https://www.google.com/maps/dir/?api=1&destination=37.7749,-122.4194');
  });

  it('ignores placeholder TBD strings when coordinates are (0, 0)', () => {
    expect(resolveDirectionsUrl({ directions: 'TBD', latitude: 0, longitude: 0 })).toBeUndefined();
  });
});

describe('coordinate, venue formatting, and distance helpers', () => {
  it('validates coordinates and rejects (0, 0), NaN, and out-of-range values', () => {
    const valid: LatLonCoordinates = { latitude: 41.8781, longitude: -87.6298 };
    expect(hasValidCoordinates(valid.latitude, valid.longitude)).toBe(true);
    expect(hasValidCoordinates(0, 0)).toBe(false);
    expect(hasValidCoordinates(0, -87.6)).toBe(true);
    expect(hasValidCoordinates(NaN, -87.6)).toBe(false);
    expect(hasValidCoordinates(91, 0)).toBe(false);
    expect(hasValidCoordinates(0, -181)).toBe(false);
  });

  it('formats street and full venue locations while filtering placeholder values', () => {
    expect(isNonPlaceholderVenueText('TBD')).toBe(false);
    expect(isNonPlaceholderVenueText('N/A')).toBe(false);
    expect(isNonPlaceholderVenueText('500 Floral Way')).toBe(true);

    const fullParts: VenueAddressParts = {
      venueName: 'Botanic Conservatory',
      venueAddress: '500 Floral Way',
      venueCity: 'Chicago',
      venueState: 'IL',
      venueZip: '60611',
    };
    expect(formatVenueStreetAddress(fullParts)).toBe('500 Floral Way, Chicago, IL 60611');
    expect(formatFullVenueLocation(fullParts)).toBe(
      'Botanic Conservatory, 500 Floral Way, Chicago, IL 60611'
    );

    const placeholderParts: VenueAddressParts = {
      venueName: 'TBD',
      venueAddress: 'TBD',
      venueCity: 'Austin',
      venueState: 'TX',
      venueZip: 'TBD',
    };
    expect(formatVenueStreetAddress(placeholderParts)).toBe('Austin, TX');
    expect(formatFullVenueLocation(placeholderParts)).toBe('Austin, TX');
  });

  it('joins sub-event locationName and street location cleanly', () => {
    expect(joinEventLocations('Grace Church', '123 Church St')).toBe('Grace Church, 123 Church St');
    expect(joinEventLocations('Grace Church, 123 Church St', '123 Church St')).toBe(
      'Grace Church, 123 Church St'
    );
    expect(joinEventLocations('TBD', '123 Church St')).toBe('123 Church St');
    expect(joinEventLocations(null, undefined)).toBe('');
  });

  it('computes Haversine miles and formats readable venue distances', () => {
    const venue = { latitude: 41.8796, longitude: -87.6237 };
    const nearbyHotel = { latitude: 41.8998, longitude: -87.6233 };
    const adjacentSpot = { latitude: 41.88, longitude: -87.6238 };

    expect(
      calculateDistanceMiles(venue.latitude, venue.longitude, nearbyHotel.latitude, nearbyHotel.longitude)
    ).toBeCloseTo(1.395, 2);
    expect(formatDistanceFromVenue(venue, nearbyHotel)).toBe('1.4 mi from venue');
    expect(formatDistanceFromVenue(venue, adjacentSpot)).toBe('< 0.1 mi from venue');
    expect(formatDistanceFromVenue({ latitude: 0, longitude: 0 }, nearbyHotel)).toBeNull();
  });
});
