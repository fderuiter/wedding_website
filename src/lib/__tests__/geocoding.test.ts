import {
  geocodeSearch,
  geocodeBestMatch,
  resetGeocodeStateForTesting,
  type GeocodeCandidate,
} from '../geocoding';
import { safeFetch } from '@/utils/safeFetch';

jest.mock('@/utils/safeFetch', () => ({
  safeFetch: jest.fn(),
}));

const mockSafeFetch = safeFetch as jest.MockedFunction<typeof safeFetch>;

describe('src/lib/geocoding', () => {
  beforeEach(() => {
    resetGeocodeStateForTesting();
    mockSafeFetch.mockReset();
  });

  it('skips short or placeholder queries without calling safeFetch', async () => {
    expect(await geocodeSearch('')).toEqual([]);
    expect(await geocodeSearch('a')).toEqual([]);
    expect(await geocodeSearch('TBD')).toEqual([]);
    expect(await geocodeSearch('N/A')).toEqual([]);
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it('fetches via safeFetch with AbortSignal timeout, normalizes candidates, and filters (0, 0)', async () => {
    mockSafeFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            name: 'Chicago Botanic Garden',
            display_name: 'Chicago Botanic Garden, 1000 Lake Cook Road, Glencoe, Cook County, Illinois, 60022, United States',
            lat: '42.1489123',
            lon: '-87.7896543',
            address: {
              house_number: '1000',
              road: 'Lake Cook Road',
              village: 'Glencoe',
              state: 'Illinois',
              postcode: '60022',
              country: 'United States',
            },
          },
          {
            name: 'Null Island Sentinel',
            display_name: 'Null Island',
            lat: '0',
            lon: '0',
            address: {},
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const results: GeocodeCandidate[] = await geocodeSearch('1000 Lake Cook Rd Glencoe', 5);

    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockSafeFetch.mock.calls[0];
    expect(calledUrl).toContain('https://nominatim.openstreetmap.org/search?');
    expect(calledUrl).toContain('q=1000%20Lake%20Cook%20Rd%20Glencoe');
    expect(calledInit?.signal).toBeDefined();

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      displayName:
        'Chicago Botanic Garden, 1000 Lake Cook Road, Glencoe, Cook County, Illinois, 60022, United States',
      name: 'Chicago Botanic Garden',
      streetAddress: '1000 Lake Cook Road',
      city: 'Glencoe',
      state: 'Illinois',
      zip: '60022',
      country: 'United States',
      latitude: 42.148912,
      longitude: -87.789654,
    });
  });

  it('serves repeated queries from LRU cache without issuing duplicate outbound requests', async () => {
    mockSafeFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            name: 'The Glasshouse',
            display_name: 'The Glasshouse, 660 12th Ave, New York, NY 10019, USA',
            lat: '40.7654',
            lon: '-73.9965',
            address: {
              house_number: '660',
              road: '12th Ave',
              city: 'New York',
              state: 'NY',
              postcode: '10019',
              country: 'USA',
            },
          },
        ]),
        { status: 200 }
      )
    );

    const first = await geocodeSearch('  The Glasshouse   NYC ', 5);
    const second = await geocodeSearch('the glasshouse nyc', 5);

    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list gracefully when safeFetch rejects, times out, or returns non-200', async () => {
    mockSafeFetch.mockRejectedValueOnce(new Error('TimeoutError: The operation was aborted'));
    expect(await geocodeSearch('Timeout Venue')).toEqual([]);

    mockSafeFetch.mockResolvedValueOnce(new Response('Service Unavailable', { status: 503 }));
    expect(await geocodeSearch('Unavailable Venue')).toEqual([]);
  });

  it('enforces outbound rate limiting of 30 requests per 60-second window', async () => {
    mockSafeFetch.mockImplementation(async () => new Response(JSON.stringify([]), { status: 200 }));

    for (let i = 0; i < 30; i++) {
      await geocodeSearch(`Unique Query Number ${i}`);
    }
    expect(mockSafeFetch).toHaveBeenCalledTimes(30);

    // 31st uncached request within the same window is suppressed cleanly
    const suppressed = await geocodeSearch('Unique Query Number 31');
    expect(suppressed).toEqual([]);
    expect(mockSafeFetch).toHaveBeenCalledTimes(30);
  });

  it('geocodeBestMatch falls back to street/city segments when custom venue name yields zero results', async () => {
    mockSafeFetch
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              name: '500 Floral Way',
              display_name: '500 Floral Way, Napa, California, 94558, USA',
              lat: '38.2975',
              lon: '-122.2869',
              address: {
                house_number: '500',
                road: 'Floral Way',
                city: 'Napa',
                state: 'CA',
                postcode: '94558',
                country: 'USA',
              },
            },
          ]),
          { status: 200 }
        )
      );

    const match = await geocodeBestMatch([
      'Bespoke Private Barn Name',
      '500 Floral Way',
      'Napa',
      'CA',
      'TBD',
    ]);

    expect(mockSafeFetch).toHaveBeenCalledTimes(2);
    expect(match).not.toBeNull();
    expect(match?.latitude).toBe(38.2975);
    expect(match?.longitude).toBe(-122.2869);
  });
});
