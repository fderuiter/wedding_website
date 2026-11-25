import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { a11yConfig } from '../src/a11y-config';
import { seedGuestAuthCookies } from './helpers/auth';

test.describe('Responsive Slideshow Dock & Pausable Countdown A11y', { tag: '@a11y' }, () => {
  test('keeps slideshow dock controls inside small viewports, protects Gallery focus, and honors shortcut toggle and reduced-motion timers', async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await seedGuestAuthCookies(context);
    const page = await context.newPage();

    try {
      // 1. Verify / starts with Countdown paused and zero aria-label timer mutations under prefers-reduced-motion: reduce
      await page.addInitScript(() => {
        const baseMs = new Date('2026-08-15T12:00:00Z').getTime();
        Date.now = () => baseMs + Math.floor(performance.now());
      });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      const timer = page.getByRole('timer');
      await expect(timer).toBeVisible();
      await expect(timer).not.toHaveAttribute('tabindex');
      await expect(timer).not.toHaveAttribute('aria-label');
      const resumeBtn = page.getByRole('button', { name: 'Resume countdown' });
      await expect(resumeBtn).toHaveAttribute('aria-pressed', 'true');
      const initialTimerText = await timer.textContent();
      await page.waitForTimeout(1500);
      await expect(timer).toHaveText(initialTimerText ?? '');
      await resumeBtn.click();
      await expect(page.getByRole('button', { name: 'Pause countdown' })).toHaveAttribute(
        'aria-pressed',
        'false'
      );
      await expect(timer).not.toHaveAttribute('aria-label');

      // 2. Verify /photos/slideshow starts paused under prefers-reduced-motion: reduce and fits 320x256, 375x667, and 390x844
      for (const viewport of [
        { width: 320, height: 256 },
        { width: 375, height: 667 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto('/photos/slideshow', { waitUntil: 'domcontentloaded' });

        const playPauseBtn = page.getByTestId('slideshow-play-pause-btn');
        const fullscreenBtn = page.getByTestId('slideshow-fullscreen-btn');
        const qrChipBtn = page.getByTestId('slideshow-qr-chip-btn');

        await expect(playPauseBtn).toHaveAttribute('aria-label', 'Play slideshow');
        await expect(fullscreenBtn).toBeVisible();
        await expect(qrChipBtn).toBeVisible();

        for (const locator of [playPauseBtn, fullscreenBtn, qrChipBtn]) {
          const box = await locator.boundingBox();
          expect(box).not.toBeNull();
          if (box) {
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.y).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
            expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
          }
        }

        if (viewport.width === 320 && viewport.height === 256) {
          const galleryLink = page.getByTestId('slideshow-back-link');
          await galleryLink.focus();

          const countVisibleHitPoints = async () =>
            galleryLink.evaluate((el) => {
              const rect = el.getBoundingClientRect();
              const insetX = Math.max(4, Math.ceil(rect.height * 0.35));
              const insetY = Math.max(2, Math.ceil(rect.height * 0.2));
              const points = [
                [rect.left + rect.width / 2, rect.top + rect.height / 2],
                [rect.left + insetX, rect.top + insetY],
                [rect.right - insetX, rect.top + insetY],
                [rect.left + insetX, rect.bottom - insetY],
                [rect.right - insetX, rect.bottom - insetY],
              ];
              return points.filter(([x, y]) => {
                const hit = document.elementFromPoint(x, y);
                return Boolean(hit && (hit === el || el.contains(hit)));
              }).length;
            });

          expect(await countVisibleHitPoints()).toBe(5);

          // Expand QR card on 320x256 -> focus transfers to Dismiss QR code overlay and Gallery stays unobstructed
          await qrChipBtn.click();
          const closeQrBtn = page.getByTestId('slideshow-qr-close-btn');
          await expect(closeQrBtn).toBeVisible();
          await expect(closeQrBtn).toBeFocused();
          const closeBox = await closeQrBtn.boundingBox();
          expect(closeBox).not.toBeNull();
          if (closeBox) {
            expect(closeBox.x).toBeGreaterThanOrEqual(0);
            expect(closeBox.y).toBeGreaterThanOrEqual(0);
            expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(viewport.width);
            expect(closeBox.y + closeBox.height).toBeLessThanOrEqual(viewport.height);
          }

          await galleryLink.focus();
          expect(await countVisibleHitPoints()).toBe(5);

          const axeResults = await new AxeBuilder({ page })
            .withTags(a11yConfig.runOnly.values)
            .options({
              rules: {
                ...a11yConfig.rules,
                'label-content-name-mismatch': { enabled: true },
              },
            })
            .analyze();
          expect(axeResults.violations).toEqual([]);

          // Dismissing while focused on close button restores focus cleanly to toolbar QR toggle
          await closeQrBtn.focus();
          await closeQrBtn.click();
          await expect(page.getByTestId('slideshow-qr-overlay')).toBeHidden();
          await expect(page.getByTestId('slideshow-qr-toggle-btn')).toBeFocused();
        }
      }

      // 3. Verify disabling slideshow-shortcuts-toggle-btn blocks ArrowLeft, ArrowRight, Space, F, and Q
      const shortcutsBtn = page.getByTestId('slideshow-shortcuts-toggle-btn');
      await expect(shortcutsBtn).toHaveAttribute('aria-pressed', 'true');
      await shortcutsBtn.click();
      await expect(shortcutsBtn).toHaveAttribute('aria-pressed', 'false');
      await page.locator('main#main-content').focus();

      const liveTextBefore = await page.getByTestId('slideshow-live-region').textContent();
      for (const key of ['ArrowRight', 'ArrowLeft', ' ', 'f', 'q']) {
        await page.keyboard.press(key);
      }
      await expect(page.getByTestId('slideshow-play-pause-btn')).toHaveAttribute(
        'aria-label',
        'Play slideshow'
      );
      await expect(page.getByTestId('slideshow-qr-overlay')).toBeVisible();
      await expect(page.getByTestId('slideshow-live-region')).toHaveText(liveTextBefore ?? '');
    } finally {
      await context.close();
    }
  });
});
