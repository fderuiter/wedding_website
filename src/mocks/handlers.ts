import { http, HttpResponse, passthrough } from 'msw';
import { createDemoStore } from '@/lib/staticDemo/store';
import { createStaticDemoRouter } from '@/lib/staticDemo/router';

// 1x1 transparent PNG to mock map tile requests without network access
const TRANSPARENT_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const mswDemoStore = createDemoStore({
  storage: null,
  initialArchetype: 'classic',
});

const routeMswDemoRequest = createStaticDemoRouter({
  store: mswDemoStore,
  mode: 'msw',
});

/**
 * Resets the shared in-memory MSW demo store between Jest tests or Storybook stories.
 */
export function resetMswDemoState(): void {
  mswDemoStore.reset('classic');
}

export const handlers = [
  http.all('*/api/*', async ({ request }) => {
    const g = globalThis as {
      __TEST_PREMOCKED_FETCH__?: boolean;
      fetch?: { _isMockFunction?: boolean };
    };
    if (g.__TEST_PREMOCKED_FETCH__ === true || g.fetch?._isMockFunction === true) {
      return passthrough();
    }
    const response = await routeMswDemoRequest(request);
    if (response) {
      return response;
    }
    return passthrough();
  }),

  // Mock Leaflet tiles for ThingsToDoMap (CartoDB / OpenStreetMap)
  http.get('https://*.basemaps.cartocdn.com/*', () => {
    return new HttpResponse(TRANSPARENT_PNG, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }),

  http.get('https://*.tile.openstreetmap.org/*', () => {
    return new HttpResponse(TRANSPARENT_PNG, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }),
];

export const defaultHandlers = handlers;
