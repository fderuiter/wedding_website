import {
  getBasePath,
  getPortalBaseUrl,
  stripBasePath,
  withBasePath,
} from '@/utils/basePath';
import {
  DEMO_STATE_STORAGE_KEY,
  getDemoState,
  resetDemoState,
  setSetupWizardPreview,
  subscribeDemoState,
  switchDemoArchetype,
  updateDemoState,
} from '@/lib/demo/store';
import { routeDemoApiRequest } from '@/lib/demo/apiRouter';
import { handleDemoFetch, installDemoBrowserRuntime } from '@/lib/demo/runtime';

describe('basePath utilities', () => {
  const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;

  afterEach(() => {
    if (originalBasePath === undefined) {
      delete process.env.NEXT_PUBLIC_BASE_PATH;
    } else {
      process.env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
    }
  });

  it('prefixes and strips subpath-mounted asset and API URLs idempotently', () => {
    process.env.NEXT_PUBLIC_BASE_PATH = '/wedding_website/demo/';

    expect(getBasePath()).toBe('/wedding_website/demo');
    expect(withBasePath('/images/sample-photo-ceremony.jpg')).toBe(
      '/wedding_website/demo/images/sample-photo-ceremony.jpg'
    );
    expect(withBasePath('/wedding_website/demo/images/sample-photo-ceremony.jpg')).toBe(
      '/wedding_website/demo/images/sample-photo-ceremony.jpg'
    );
    expect(withBasePath('https://example.com/photo.jpg')).toBe('https://example.com/photo.jpg');
    expect(withBasePath('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(stripBasePath('/wedding_website/demo/api/registry/items')).toBe('/api/registry/items');
    expect(stripBasePath('/wedding_website/demo')).toBe('/');
    expect(getPortalBaseUrl()).toBe('/wedding_website/');
  });

  it('handles root basePath cleanly', () => {
    process.env.NEXT_PUBLIC_BASE_PATH = '';
    expect(getBasePath()).toBe('');
    expect(withBasePath('/assets/favicon.png')).toBe('/assets/favicon.png');
    expect(stripBasePath('/api/health')).toBe('/api/health');
    expect(getPortalBaseUrl()).toBe('/');
  });
});

describe('stateful demo store & API router', () => {
  const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_BASE_PATH = '/wedding_website/demo';
    window.sessionStorage.clear();
    window.localStorage.clear();
    resetDemoState('classic');
  });

  afterAll(() => {
    if (originalBasePath === undefined) {
      delete process.env.NEXT_PUBLIC_BASE_PATH;
    } else {
      process.env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
    }
  });

  it('persists mutations to sessionStorage, notifies subscribers, switches archetypes, and resets cleanly', () => {
    const snapshots: string[] = [];
    const unsubscribe = subscribeDemoState((s) => {
      snapshots.push(s.activeArchetype ?? 'none');
    });

    const initial = getDemoState();
    expect(initial.activeArchetype).toBe('classic');
    expect(initial.registryItems.length).toBeGreaterThan(0);

    updateDemoState((draft) => {
      draft.config.venueName = 'Custom Demo Venue';
    });
    expect(JSON.parse(window.sessionStorage.getItem(DEMO_STATE_STORAGE_KEY) || '{}').config.venueName).toBe(
      'Custom Demo Venue'
    );

    const dest = switchDemoArchetype('destination');
    expect(dest.activeArchetype).toBe('destination');
    expect(dest.config.venueCity).toBe('Carmel');

    const romantic = switchDemoArchetype('romantic');
    expect(romantic.activeArchetype).toBe('romantic');
    expect(romantic.config.venueCity).toBe('Sonoma');

    setSetupWizardPreview(true);
    expect(getDemoState().setupWizardPreview).toBe(true);

    const reset = resetDemoState('classic');
    expect(reset.setupWizardPreview).toBe(false);
    expect(reset.config.venueName).toBe('The Grand Botanical Conservatory');
    expect(snapshots.length).toBeGreaterThanOrEqual(4);

    unsubscribe();
  });

  it('routes subpath-prefixed guest, registry, claim, schedule, RSVP, and weather endpoints', async () => {
    const capRes = await routeDemoApiRequest('http://localhost/wedding_website/demo/api/registry/capabilities');
    expect(capRes?.status).toBe(200);
    const capJson = await capRes!.json();
    expect(capJson.data.cardCheckoutEnabled).toBe(false);
    expect(capJson.data.defaultPaymentHandle).toBe('@alex-taylor-wedding');

    const regRes = await routeDemoApiRequest('http://localhost/wedding_website/demo/api/registry/items');
    const regJson = await regRes!.json();
    expect(regJson.items.length).toBeGreaterThan(0);
    const targetItem = regJson.items[0];

    const contribRes = await routeDemoApiRequest(
      'http://localhost/wedding_website/demo/api/registry/contribute',
      {
        method: 'POST',
        body: JSON.stringify({
          itemId: targetItem.id,
          name: 'Taylor Friend',
          email: 'friend@example.com',
          amount: 75,
          isReservation: true,
        }),
      }
    );
    expect(contribRes?.status).toBe(200);
    const contribJson = await contribRes!.json();
    expect(contribJson.claimActions.confirmToken).toMatch(/^demo-confirm-/);

    const claimPreview = await routeDemoApiRequest(
      `http://localhost/wedding_website/demo/api/registry/claim?token=${contribJson.claimActions.confirmToken}`
    );
    expect((await claimPreview!.json()).status).toBe('RESERVED');

    const claimConfirm = await routeDemoApiRequest(
      'http://localhost/wedding_website/demo/api/registry/claim',
      {
        method: 'POST',
        body: JSON.stringify({ token: contribJson.claimActions.confirmToken }),
      }
    );
    expect((await claimConfirm!.json()).status).toBe('CONFIRMED');

    const weatherRes = await routeDemoApiRequest('http://localhost/wedding_website/demo/api/weather');
    const weatherJson = await weatherRes!.json();
    expect(weatherJson.daily.temperature_2m_max.length).toBe(1);

    const schedRes = await routeDemoApiRequest('http://localhost/wedding_website/demo/api/schedule');
    const schedJson = await schedRes!.json();
    expect(schedJson.success).toBe(true);
    expect(schedJson.data.length).toBeGreaterThan(0);

    const icsRes = await routeDemoApiRequest(
      `http://localhost/wedding_website/demo/api/schedule/${schedJson.data[0].id}/ics`
    );
    expect(await icsRes!.text()).toContain('BEGIN:VCALENDAR');

    const rsvpRes = await routeDemoApiRequest('http://localhost/wedding_website/demo/api/rsvp', {
      method: 'POST',
      body: JSON.stringify({
        subEventId: schedJson.data[0].id,
        status: 'attending',
        plusOneCount: 1,
      }),
    });
    expect((await rsvpRes!.json()).success).toBe(true);
  });

  it('routes all 14 admin dashboard module APIs and mutations statefully', async () => {
    // 1. Health, Milestones, Site Sections & Sample Data
    const readyRes = await routeDemoApiRequest('http://localhost/wedding_website/demo/api/ready');
    expect((await readyRes!.json()).ready).toBe(true);

    const featRes = await routeDemoApiRequest('http://localhost/api/admin/features');
    const featList = await featRes!.json();
    expect(Array.isArray(featList)).toBe(true);
    expect(featList[0]).toMatchObject({ id: 'story', title: 'Our Story', visible: true });

    const featUpdateRes = await routeDemoApiRequest('http://localhost/api/admin/features', {
      method: 'PUT',
      body: JSON.stringify({
        features: featList.map((f: { id: string; visible: boolean }) =>
          f.id === 'story' ? { ...f, visible: false } : f
        ),
      }),
    });
    expect((await featUpdateRes!.json()).features[0].visible).toBe(false);

    const msRes = await routeDemoApiRequest('http://localhost/api/admin/onboarding-milestones');
    expect((await msRes!.json()).allComplete).toBe(true);

    const sdRes = await routeDemoApiRequest('http://localhost/api/admin/sample-data');
    expect((await sdRes!.json()).hasSampleData).toBe(true);

    // 2. Settings & Setup
    const setRes = await routeDemoApiRequest('http://localhost/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({ partner1Name: 'Sam', partner2Name: 'Riley' }),
    });
    const setJson = await setRes!.json();
    expect(setJson.partner1Name).toBe('Sam');
    expect(setJson.partner2Name).toBe('Riley');

    const setupRes = await routeDemoApiRequest('http://localhost/api/admin/setup', {
      method: 'POST',
      body: JSON.stringify({
        partner1Name: 'Alex',
        partner2Name: 'Taylor',
        venueName: 'Conservatory Hall',
      }),
    });
    expect((await setupRes!.json()).success).toBe(true);

    // 3. Seating Chart (tables, assign, auto-assign, export)
    const tablesRes = await routeDemoApiRequest('http://localhost/api/admin/seating-tables');
    expect(tablesRes?.headers.get('X-Total-Count')).toBeTruthy();
    const tables = await tablesRes!.json();
    expect(Array.isArray(tables)).toBe(true);

    const autoRes = await routeDemoApiRequest('http://localhost/api/admin/seating/auto-assign', {
      method: 'POST',
      body: JSON.stringify({ includePending: true }),
    });
    const autoJson = await autoRes!.json();
    expect(autoJson.assignedCount).toBeGreaterThanOrEqual(1);

    // 4. Invitation Codes & Sub-Events Matrix
    const catRes = await routeDemoApiRequest('http://localhost/api/admin/invitation-codes/catalog');
    const catJson = await catRes!.json();
    expect(catJson.items.length).toBeGreaterThan(0);

    const sumRes = await routeDemoApiRequest('http://localhost/api/admin/sub-events/rsvp-summary');
    expect((await sumRes!.json()).data.global.totalInvitations).toBe(catJson.total);

    const accRes = await routeDemoApiRequest('http://localhost/api/admin/sub-events/access');
    expect((await accRes!.json()).data.subEvents.length).toBeGreaterThan(0);

    // 5. Thank-You Notes, Media Moderation, Broadcasts, History & Maintenance
    const tyRes = await routeDemoApiRequest('http://localhost/api/admin/thank-you-notes');
    const tyJson = await tyRes!.json();
    expect(tyJson.items.length).toBeGreaterThan(0);

    const modRes = await routeDemoApiRequest('http://localhost/api/admin/photos/moderation');
    const modJson = await modRes!.json();
    expect(modJson.photos.length).toBeGreaterThan(0);

    await routeDemoApiRequest('http://localhost/api/admin/photos/moderation', {
      method: 'PATCH',
      body: JSON.stringify({ id: modJson.photos[0].id, action: 'approve' }),
    });
    const modAfter = await (
      await routeDemoApiRequest('http://localhost/api/admin/photos/moderation')
    )!.json();
    expect(modAfter.photos.length).toBe(modJson.photos.length - 1);

    const bcastSend = await routeDemoApiRequest('http://localhost/api/admin/broadcast/send', {
      method: 'POST',
      body: JSON.stringify({
        channel: 'EMAIL',
        subject: 'Weekend Shuttle Info',
        body: '<p>See you Friday!</p>',
      }),
    });
    expect((await bcastSend!.json()).success).toBe(true);

    const verRes = await routeDemoApiRequest('http://localhost/api/admin/versions');
    const verJson = await verRes!.json();
    expect(verJson.items.length).toBeGreaterThan(0);

    const backupRes = await routeDemoApiRequest('http://localhost/api/admin/maintenance/export');
    const backupJson = await backupRes!.json();
    expect(backupJson.version).toBe('2.0');

    const importRes = await routeDemoApiRequest('http://localhost/api/admin/maintenance/import', {
      method: 'POST',
      body: JSON.stringify(backupJson),
    });
    expect((await importRes!.json()).success).toBe(true);
  });

  it('installs browser runtime, registers subpath Service Worker, and passes non-API fetches through', async () => {
    const registerMock = jest.fn().mockResolvedValue({});
    Object.defineProperty(window.navigator, 'serviceWorker', {
      configurable: true,
      value: { register: registerMock },
    });

    installDemoBrowserRuntime();
    expect(document.documentElement.dataset.staticDemo).toBe('true');
    expect(registerMock).toHaveBeenCalledWith('/wedding_website/demo/mockServiceWorker.js', {
      scope: '/wedding_website/demo/',
    });

    const passthroughFetch = jest.fn().mockResolvedValue(new Response('external-ok', { status: 200 }));
    const nonApi = await handleDemoFetch('https://example.com/asset.txt', undefined, passthroughFetch);
    expect(await nonApi.text()).toBe('external-ok');
    expect(passthroughFetch).toHaveBeenCalledTimes(1);
  });
});
