import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { a11yConfig } from '../src/a11y-config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function generateGuestCookieValue() {
  const secret = process.env.GUEST_PASSCODE || 'wedding2026';
  const payload = {
    guest: true,
    iat: Date.now(),
    exp: Date.now() + 8 * 60 * 60 * 1000,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64url');
  return `${data}.${signature}`;
}

test.describe('UI Verification', () => {
  test('should show the main content on visit and be accessible', async ({ context, page }) => {
    const guestCookieValue = generateGuestCookieValue();
    await context.addCookies([
      {
        name: 'guest_auth',
        value: guestCookieValue,
        url: 'http://127.0.0.1:3000',
      }
    ]);

    await page.goto('/');

    // The main content should be visible
    const mainContent = page.locator('main#main-content');
    await expect(mainContent).toBeVisible();

    // Run accessibility audit
    const axeBuilder = new AxeBuilder({ page }).withTags(a11yConfig.runOnly.values);
    if (a11yConfig.rules) {
      axeBuilder.options({ rules: a11yConfig.rules });
    }
    const accessibilityScanResults = await axeBuilder.analyze();
      
    const reportDir = path.join(process.cwd(), 'test-results');
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
    const reportFile = path.join(reportDir, 'playwright-a11y-violations.json');
    let existingViolations = [];
    if (fs.existsSync(reportFile)) {
      existingViolations = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    }
    fs.writeFileSync(reportFile, JSON.stringify([...existingViolations, ...accessibilityScanResults.violations], null, 2));

    // Assert no violations
    expect(accessibilityScanResults.violations).toEqual([]);
  });
});
