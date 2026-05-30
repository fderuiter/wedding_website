import { test, expect } from '@playwright/test';

test('verify heart interaction', async ({ page }) => {
  // 1. Navigate to the heart page.
  await page.goto('/heart');

  // Give the page a moment to load the 3D scene
  await page.waitForTimeout(2000);

  // 2. Find the canvas for the drag interaction.
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();

  // 3. Get the bounding box of the canvas to calculate coordinates
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('Canvas bounding box not found');
  }

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  // 4. Simulate a drag and fling gesture
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  // Move quickly to the top right to create a fling
  await page.mouse.move(centerX + 200, centerY - 200, { steps: 5 });
  await page.mouse.up();

  // 5. Wait for the heart to reform
  // The animation takes 3 seconds to reset
  await page.waitForTimeout(4000); // Wait a bit longer to be safe

  // 6. Take a screenshot for visual verification.
  await page.screenshot({ path: 'test-results/verification/heart_reformed.png' });
});
