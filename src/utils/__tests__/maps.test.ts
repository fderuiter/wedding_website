import { resolveDirectionsUrl } from '../maps';

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
});
