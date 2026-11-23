import { act, render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'jest-axe';
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
});
