import fs from 'node:fs/promises';
import sharp from 'sharp';
import { test, expect } from '@playwright/test';
import { seedAdminAndGuestAuthCookies, seedGuestAuthCookies } from './helpers/auth';

async function createSampleReceptionJpeg(): Promise<Buffer> {
  const svg = `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#7c2d12"/>
        <stop offset="50%" stop-color="#b45309"/>
        <stop offset="100%" stop-color="#fef3c7"/>
      </linearGradient>
    </defs>
    <rect width="800" height="600" fill="url(#bg)"/>
    <circle cx="400" cy="260" r="110" fill="#fffbeb" fill-opacity="0.25"/>
    <text x="400" y="275" font-family="Georgia, serif" font-size="42" fill="#ffffff" text-anchor="middle">Reception Sparkler Toast</text>
    <text x="400" y="335" font-family="sans-serif" font-size="22" fill="#fde68a" text-anchor="middle">Shared via Table QR Upload</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

test.describe('Scoped QR Photo Uploads, Auto-Approval, Print Modal & Token Rotation', () => {
  test('exchanges signed QR link for scoped cookie, isolates non-photo routes, auto-approves live uploads, and invalidates rotated links', async ({
    browser,
  }) => {
    const validJpegBuffer = await createSampleReceptionJpeg();
    const adminContext = await browser.newContext();
    await seedAdminAndGuestAuthCookies(adminContext);
    const adminPage = await adminContext.newPage();
    const uploadedNodeIds: string[] = [];

    try {
      // Ensure baseline autoApproveGuestPhotos starts false via admin API
      const resetRes = await adminPage.request.post('/api/admin/photos/qr', {
        data: { autoApproveGuestPhotos: false },
      });
      expect(resetRes.ok()).toBe(true);

      // 1. Open Admin Media Dashboard, inspect QR Modal, download 512x512 PNG, preview print cards, and enable Auto-Approve
      await adminPage.goto('/admin/dashboard/media', { waitUntil: 'domcontentloaded' });

      const qrModalBtn = adminPage.getByTestId('open-photo-qr-modal-btn');
      await expect(qrModalBtn).toBeVisible({ timeout: 15000 });
      await qrModalBtn.click();

      const urlInput = adminPage.getByTestId('photo-qr-signed-url-input');
      await expect(urlInput).toBeVisible();
      const initialSignedUrl = await urlInput.inputValue();
      expect(initialSignedUrl).toContain('/photos?qr=');

      // Verify 512x512 PNG download
      const downloadPromise = adminPage.waitForEvent('download');
      await adminPage.getByTestId('download-photo-qr-png-btn').click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/\.png$/);
      const downloadedPath = await download.path();
      expect(downloadedPath).toBeTruthy();
      if (downloadedPath) {
        const pngBytes = await fs.readFile(downloadedPath);
        // PNG IHDR width (bytes 16..19) and height (bytes 20..23) big-endian = 512
        expect(pngBytes.subarray(0, 8)).toEqual(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        );
        expect(pngBytes.readUInt32BE(16)).toBe(512);
        expect(pngBytes.readUInt32BE(20)).toBe(512);
      }

      // Switch to Print Table Cards & Labels view and capture admin modal screenshot
      await adminPage.getByTestId('switch-photo-qr-print-view-btn').click();
      await expect(adminPage.getByTestId('qr-print-sheet')).toBeVisible();
      await adminPage.screenshot({
        path: '/tmp/admin-media-qr-modal.png',
        animations: 'disabled',
      });

      // Close modal via Done button, then toggle Auto-Approve Guest Uploads ON
      await adminPage.getByTestId('close-photo-qr-modal-btn').click();
      await expect(adminPage.getByTestId('close-photo-qr-modal-btn')).toBeHidden();
      const autoApproveToggle = adminPage.getByTestId('auto-approve-guest-photos-toggle');
      await expect(autoApproveToggle).toHaveAttribute('aria-checked', 'false');
      await autoApproveToggle.click();
      await expect(autoApproveToggle).toHaveAttribute('aria-checked', 'true');

      // 2. Unauthenticated phone browser scans the signed QR link
      const qrGuestContext = await browser.newContext();
      const qrGuestPage = await qrGuestContext.newPage();

      // Verify raw HTTP 303 redirect and HttpOnly cookie attributes first using APIRequestContext without following redirects
      const targetPathAndQuery =
        new URL(initialSignedUrl).pathname + new URL(initialSignedUrl).search;
      const exchangeCheck = await qrGuestPage.request.get(targetPathAndQuery, {
        maxRedirects: 0,
      });
      expect(exchangeCheck.status()).toBe(303);
      expect(exchangeCheck.headers()['location']).toContain('/photos?tab=guest');
      expect(exchangeCheck.headers()['set-cookie'] ?? '').toMatch(/guest_photo_session=.*HttpOnly/i);

      // Navigate in the browser and confirm landing on /photos?tab=guest with GuestPhotoDropzone visible
      await qrGuestPage.goto(targetPathAndQuery, { waitUntil: 'domcontentloaded' });
      await expect(qrGuestPage).toHaveURL(/\/photos\?tab=guest$/);
      await expect(qrGuestPage.locator('[data-hydrated="true"]')).toBeAttached({ timeout: 15000 });
      await expect(qrGuestPage.getByTestId('guest-photo-dropzone')).toBeVisible();

      // Verify HttpOnly cookie is stored in browser context and inaccessible to document.cookie
      const cookies = await qrGuestContext.cookies();
      const photoCookie = cookies.find((c) => c.name === 'guest_photo_session');
      expect(photoCookie).toBeDefined();
      expect(photoCookie?.httpOnly).toBe(true);
      const docCookie = await qrGuestPage.evaluate(() => document.cookie);
      expect(docCookie).not.toContain('guest_photo_session');

      // 3. Verify strict scope isolation on non-photo pages and APIs
      for (const restrictedPath of ['/', '/guest', '/registry']) {
        const restrictedRes = await qrGuestPage.request.get(restrictedPath, { maxRedirects: 0 });
        expect(restrictedRes.status()).toBe(303);
        expect(restrictedRes.headers()['location']).toContain('/guest/login');
      }
      const rsvpApiRes = await qrGuestPage.request.post('/api/rsvp', {
        data: { invitationCode: 'TEST', attending: true },
      });
      expect(rsvpApiRes.status()).toBe(401);

      // 4. Upload a photo as the QR-scoped visitor while Auto-Approve is enabled -> 201 APPROVED + immediate render
      const uniqueCaption = `QR Reception Toast ${Date.now()}`;
      await qrGuestPage.getByTestId('guest-photo-uploader-name').fill('Table 7 Guest');
      await qrGuestPage.getByTestId('guest-photo-caption').fill(uniqueCaption);

      const uploadResponsePromise = qrGuestPage.waitForResponse(
        (res) => res.url().includes('/api/guest/photos/upload') && res.request().method() === 'POST'
      );
      await qrGuestPage.getByTestId('guest-photo-file-input').setInputFiles({
        name: 'table7-toast.jpg',
        mimeType: 'image/jpeg',
        buffer: validJpegBuffer,
      });
      await qrGuestPage.getByTestId('confirm-upload-btn').click();

      const uploadRes = await uploadResponsePromise;
      expect(uploadRes.status()).toBe(201);
      const uploadJson = await uploadRes.json();
      const firstUploaded = Array.isArray(uploadJson.data) ? uploadJson.data[0] : uploadJson.data;
      if (firstUploaded?.nodeId || firstUploaded?.id) {
        uploadedNodeIds.push(String(firstUploaded.nodeId ?? firstUploaded.id));
      }
      expect(firstUploaded.status).toBe('APPROVED');
      expect(firstUploaded.isVisible).toBe(true);

      await expect(qrGuestPage.getByTestId('upload-live-notice')).toBeVisible();
      await expect(qrGuestPage.getByText(uniqueCaption)).toBeVisible();
      await qrGuestPage.screenshot({
        path: '/tmp/qr-scoped-upload-dropzone.png',
        animations: 'disabled',
      });

      // 5. Verify /photos/slideshow embeds a signed ?qr= link and displays the auto-approved photo
      await qrGuestPage.goto('/photos/slideshow', { waitUntil: 'domcontentloaded' });
      await expect(qrGuestPage.getByTestId('slideshow-qr-overlay')).toBeVisible({ timeout: 15000 });
      await expect(qrGuestPage.getByTestId('slideshow-photo-title')).toHaveText(uniqueCaption, {
        timeout: 15000,
      });
      await qrGuestPage.screenshot({
        path: '/tmp/live-slideshow-qr-upload.png',
        animations: 'disabled',
      });

      // 6. Rotate QR token from Admin Media Dashboard -> invalidates old QR link and existing scoped session while preserving full guest & admin access
      await adminPage.getByTestId('open-photo-qr-modal-btn').click();
      await adminPage.getByTestId('rotate-photo-qr-token-btn').click();
      // Confirm accessible danger alertdialog
      await adminPage.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();

      await expect(urlInput).not.toHaveValue(initialSignedUrl);

      // Previously issued guest_photo_session cookie is rejected on upload (401) and /photos (redirects to /guest/login)
      const staleUploadRes = await qrGuestPage.request.post('/api/guest/photos/upload', {
        multipart: {
          files: {
            name: 'stale.jpg',
            mimeType: 'image/jpeg',
            buffer: validJpegBuffer,
          },
        },
      });
      expect(staleUploadRes.status()).toBe(401);

      await qrGuestPage.goto('/photos', { waitUntil: 'domcontentloaded' });
      await expect(qrGuestPage).toHaveURL(/\/guest\/login/);
      await qrGuestContext.close();

      // Old QR link redirects to /guest/login in a fresh unauthenticated context
      const postRotateAnonContext = await browser.newContext();
      try {
        const postRotateAnonPage = await postRotateAnonContext.newPage();
        await postRotateAnonPage.goto(targetPathAndQuery, { waitUntil: 'domcontentloaded' });
        await expect(postRotateAnonPage).toHaveURL(/\/guest\/login/);
      } finally {
        await postRotateAnonContext.close();
      }

      // Authenticated guest and admin retain uninterrupted access
      const fullGuestContext = await browser.newContext();
      try {
        await seedGuestAuthCookies(fullGuestContext);
        const fullGuestPage = await fullGuestContext.newPage();
        await fullGuestPage.goto('/photos', { waitUntil: 'domcontentloaded' });
        await expect(fullGuestPage).toHaveURL(/\/photos$/);
      } finally {
        await fullGuestContext.close();
      }
    } finally {
      for (const nodeId of uploadedNodeIds) {
        await adminPage.request.patch('/api/admin/photos/moderation', {
          data: { id: nodeId, action: 'reject' },
        });
      }
      // Restore autoApproveGuestPhotos to false so subsequent tests start cleanly
      await adminPage.request.post('/api/admin/photos/qr', {
        data: { autoApproveGuestPhotos: false },
      });
      await adminContext.close();
    }
  });
});
