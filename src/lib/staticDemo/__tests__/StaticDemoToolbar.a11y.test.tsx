import { act, render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'jest-axe';
import { installDemoFetchInterceptor } from '@/lib/demo/demoApiHandler';
import {
  resetDemoState,
  setDemoArchetype,
  setDemoPersona,
  setDemoRuntimeActive,
  setDemoThemePreset,
} from '@/lib/demo/demoStore';
import { StaticDemoToolbar } from '../StaticDemoToolbar';
import { createDemoStore } from '../store';
import { installStaticDemoFetchRouter } from '../runtime';

describe('StaticDemoToolbar accessibility and interactive controls', () => {
  it('has zero axe accessibility violations in both light and dark modes (expanded and minimized)', async () => {
    const store = createDemoStore({ storage: null, initialArchetype: 'classic' });

    const { container, unmount } = render(<StaticDemoToolbar store={store} />);
    expect(await axe(container)).toHaveNoViolations();

    // Test minimized state in dark mode
    document.documentElement.classList.add('dark');
    fireEvent.click(screen.getByRole('button', { name: /minimize demo controls/i }));
    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(screen.getByRole('button', { name: /expand demo controls/i }));
    expect(await axe(container)).toHaveNoViolations();

    document.documentElement.classList.remove('dark');
    unmount();
  });

  it('switches archetypes, toggles setup wizard preview, and resets modified state', () => {
    const store = createDemoStore({ storage: null, initialArchetype: 'classic' });
    render(<StaticDemoToolbar store={store} />);

    const select = screen.getByLabelText(/^preset$/i);
    fireEvent.change(select, { target: { value: 'destination' } });
    expect(store.getSnapshot().activeArchetype).toBe('destination');
    expect(store.getSnapshot().appConfig[0].venueCity).toBe('Key Biscayne');

    // Toggle Setup Wizard preview on and off
    const setupBtn = screen.getByRole('button', { name: /setup wizard/i });
    fireEvent.click(setupBtn);
    expect(store.getSnapshot().isSetupMode).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /exit setup/i }));
    expect(store.getSnapshot().isSetupMode).toBe(false);

    // Mutate state and verify Reset Demo restores clean destination preset
    act(() => {
      store.mutate((draft) => {
        draft.appConfig[0].venueName = 'Edited Custom Venue';
      });
    });
    expect(store.getSnapshot().appConfig[0].venueName).toBe('Edited Custom Venue');

    fireEvent.click(screen.getByRole('button', { name: /reset demo/i }));
    expect(store.getSnapshot().appConfig[0].venueName).toBe(
      'Oceanview Palms Resort & Spa',
    );
  });

  it('synchronously intercepts window.fetch under hosted subpath and cleanly uninstalls', async () => {
    const store = createDemoStore({ storage: null, initialArchetype: 'classic' });
    const installed = installStaticDemoFetchRouter({
      store,
      basePath: '/wedding_website/demo',
    });
    expect(installed).toBe(store);

    try {
      const response = await window.fetch(
        `${window.location.origin}/wedding_website/demo/api/health`,
      );
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.status ?? payload.data?.status).toBe('healthy');
    } finally {
      window.__STATIC_DEMO_INSTALLED__?.uninstall();
    }
    expect(window.__STATIC_DEMO_INSTALLED__).toBeUndefined();
  });

  it('bridges DemoStore mutations and delegates extended OpenAPI routes when both DemoApiHandler and staticDemo router are active', async () => {
    const store = createDemoStore({ storage: null, initialArchetype: 'classic' });
    installStaticDemoFetchRouter({ store });
    resetDemoState();
    setDemoRuntimeActive(true);
    const uninstallDemoInterceptor = installDemoFetchInterceptor();

    try {
      setDemoArchetype('destination');
      setDemoPersona('admin');
      setDemoThemePreset('editorial');

      expect(store.getSnapshot().activeArchetype).toBe('destination');
      expect(store.getSnapshot().isAdminAuthenticated).toBe(true);
      expect(store.getSnapshot().appConfig[0].themePreset).toBe('editorial');

      // Extended OpenAPI routes delegate cleanly to staticDemo instead of 404/empty stubs
      const scheduleRes = await window.fetch(`${window.location.origin}/api/schedule`);
      expect(scheduleRes.status).toBe(200);
      const scheduleJson = await scheduleRes.json();
      expect(Array.isArray(scheduleJson.data ?? scheduleJson)).toBe(true);

      const photosRes = await window.fetch(`${window.location.origin}/api/photos`);
      expect(photosRes.status).toBe(200);

      const subEventsRes = await window.fetch(`${window.location.origin}/api/admin/sub-events`);
      expect(subEventsRes.status).toBe(200);
      const subEventsJson = await subEventsRes.json();
      expect((subEventsJson.data ?? subEventsJson).length).toBeGreaterThan(0);

      // Cross-archetype seeded registry item resolves under DemoApiHandler too
      const seededItemRes = await window.fetch(
        `${window.location.origin}/api/registry/items/sample-registry-classic-1`,
      );
      expect(seededItemRes.status).toBe(200);

      resetDemoState();
      expect(store.getSnapshot().activeArchetype).toBe('classic');
      expect(store.getSnapshot().isAdminAuthenticated).toBe(false);
    } finally {
      uninstallDemoInterceptor();
      setDemoRuntimeActive(false);
      resetDemoState();
      window.__STATIC_DEMO_INSTALLED__?.uninstall();
    }
  });
});
