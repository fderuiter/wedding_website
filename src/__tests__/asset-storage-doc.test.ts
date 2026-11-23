/** @jest-environment node */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkLinksInFile, type LinkError } from '../../scripts/check-doc-links';
import {
  ARCHITECTURAL_DOCS,
  escapeVueMustache,
  rewriteMarkdownLinks,
} from '../../scripts/generate-portal';
import { verifySpecContracts } from '../../scripts/verify-spec-contracts';

describe('docs/ASSET_STORAGE.md Contract & Portal Staging Suite', () => {
  const rootDir = process.cwd();
  const docRelPath = 'docs/ASSET_STORAGE.md';
  const docAbsPath = path.join(rootDir, docRelPath);
  const docContent = fs.readFileSync(docAbsPath, 'utf8');

  it('passes checkLinksInFile with zero broken links and contains no brittle #L line-range anchors', () => {
    const errors: LinkError[] = [];
    checkLinksInFile(docAbsPath, errors, rootDir);
    expect(errors).toEqual([]);
    expect(docContent).not.toMatch(/#L\d+/);
    expect(docContent).not.toMatch(/\(L\d+[-–—]L\d+\)/);
  });

  it('percent-encodes bracketed Next.js route links so checkLinksInFile resolves [id] and [...path] routes', () => {
    expect(docContent).toContain('src/app/api/media/%5Bid%5D/route.ts');
    expect(docContent).toContain('src/app/api/uploads/%5B...path%5D/route.ts');
    expect(docContent).not.toMatch(
      /https:\/\/github\.com\/fderuiter\/wedding_website\/blob\/HEAD\/[^\s)]*\[[^\s)]*\]/,
    );
  });

  it('verifies getStorageProvider and all referenced routes and source symbols via verifySpecContracts without depending on line offsets', () => {
    const result = verifySpecContracts(rootDir, { specFiles: [docRelPath] });
    expect(result.errors).toEqual([]);
    expect(result.checkedRoutes).toBeGreaterThanOrEqual(4);
    expect(result.checkedSymbols).toBeGreaterThanOrEqual(25);

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-storage-doc-shift-'));
    try {
      for (const relPath of [
        docRelPath,
        'src/env.ts',
        'src/middleware.ts',
        'src/lib/basePath.ts',
        'src/utils/storage.ts',
        'src/utils/pathContainment.ts',
        'src/utils/validationPrimitives.ts',
        'src/utils/validation.ts',
        'src/utils/imageProcessor.ts',
        'src/utils/imageProcessorWorker.ts',
        'src/utils/image-metadata.ts',
        'src/app/metadata.ts',
        'src/app/api/admin/upload/route.ts',
        'src/app/api/guest/photos/upload/route.ts',
        'src/app/api/media/[id]/route.ts',
        'src/app/api/media/export/route.ts',
        'src/app/api/uploads/[...path]/route.ts',
        'src/features/content/service.ts',
        'src/features/media/repository.ts',
      ]) {
        const srcPath = path.join(rootDir, relPath);
        const destPath = path.join(tmpRoot, relPath);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
      }

      const storageCopyPath = path.join(tmpRoot, 'src/utils/storage.ts');
      const originalStorage = fs.readFileSync(storageCopyPath, 'utf8');
      const shiftedStorage = originalStorage.replace(
        'export function getStorageProvider(): StorageProvider',
        [
          '// Synthetic comment line 1 inserted above getStorageProvider',
          '// Synthetic comment line 2 inserted above getStorageProvider',
          'export function getStorageProvider(): StorageProvider',
        ].join('\n'),
      );
      expect(shiftedStorage).not.toBe(originalStorage);
      fs.writeFileSync(storageCopyPath, shiftedStorage, 'utf8');

      const linkErrors: LinkError[] = [];
      checkLinksInFile(path.join(tmpRoot, docRelPath), linkErrors, tmpRoot);
      expect(linkErrors).toEqual([]);

      const shiftedResult = verifySpecContracts(tmpRoot, { specFiles: [docRelPath] });
      expect(shiftedResult.errors).toEqual([]);
      expect(shiftedResult.checkedSymbols).toBe(result.checkedSymbols);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('documents all required storage, containment, R2, URL guard, moderation, deletion, export, and metadata contracts', () => {
    const requiredSymbolsAndTerms = [
      // Storage interface & containment
      'StorageUploadInputObject',
      'StorageUploadInput',
      'StorageValidationResult',
      'getStorageProvider',
      'LocalStorageProvider',
      'S3StorageProvider',
      'public/uploads',
      'resolveContainedWritePath',
      'resolveContainedExistingPath',
      'PathContainmentError',
      // R2, S3 URL fallback, validateConfig, and local MIME metadata
      'Cloudflare R2',
      'S3_PUBLIC_URL',
      'S3_ENDPOINT',
      'forcePathStyle',
      'validateConfig',
      'getMetadata',
      'getLocalUploadMimeType',
      'application/octet-stream',
      '.webp',
      // Upload caps & URL guards
      'GuestPhotoUploadSchema',
      '10 photos',
      'decodeUrlPathSafely',
      'isSafeLocalPathUrl',
      'isSafeConfigAssetUrl',
      'isSafeMediaOrPhotoUrl',
      // Upload persistence, moderation, deletion, export & image headers
      '/api/admin/upload',
      '/api/guest/photos/upload',
      'uploads/photos',
      'PENDING',
      'ContentNode',
      'moderatePhoto',
      '/api/media/[id]',
      'deleteMedia',
      'orphan',
      '/api/media/export',
      'wedding-photos.zip',
      'CONCURRENCY_LIMIT = 8',
      'safeFetch',
      'getLocalImageDimensions',
    ];

    for (const symbol of requiredSymbolsAndTerms) {
      expect(docContent).toContain(symbol);
    }
  });

  it('maps to features/asset-storage.md and transforms cleanly in memory via rewriteMarkdownLinks and escapeVueMustache', () => {
    const portalMapping = ARCHITECTURAL_DOCS.find((doc) => doc.src === docRelPath);
    expect(portalMapping).toEqual({
      src: 'docs/ASSET_STORAGE.md',
      dest: 'features/asset-storage.md',
      category: 'Features',
      title: 'Asset Storage',
    });

    const rewritten = rewriteMarkdownLinks(docContent, docRelPath, rootDir);
    const stagedInMemory = escapeVueMustache(rewritten);

    expect(stagedInMemory).toContain('# Asset Storage System');
    expect(stagedInMemory).toContain('`${endpoint}/${bucket}`');
    expect(stagedInMemory).toContain('`${S3_ENDPOINT}/${S3_BUCKET}`');
    expect(stagedInMemory).not.toContain('&#123;&#123;');
  });
});
