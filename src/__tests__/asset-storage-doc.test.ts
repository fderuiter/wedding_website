/** @jest-environment node */

import fs from 'fs';
import path from 'path';
import { checkLinksInFile, type LinkError } from '../../scripts/check-doc-links';
import {
  ARCHITECTURAL_DOCS,
  escapeVueMustache,
  rewriteMarkdownLinks,
} from '../../scripts/generate-portal';

describe('docs/ASSET_STORAGE.md Contract & Portal Staging Suite', () => {
  const rootDir = process.cwd();
  const docRelPath = 'docs/ASSET_STORAGE.md';
  const docAbsPath = path.join(rootDir, docRelPath);
  const docContent = fs.readFileSync(docAbsPath, 'utf8');

  function sliceFileLines(relFilePath: string, startLine: number, endLine: number): string {
    const absPath = path.join(rootDir, relFilePath);
    const lines = fs.readFileSync(absPath, 'utf8').split(/\r?\n/);
    return lines.slice(startLine - 1, endLine).join('\n');
  }

  function extractRepoBlobAnchors(markdown: string): Array<{
    relPath: string;
    rawPath: string;
    startLine: number;
    endLine: number;
  }> {
    const re =
      /https:\/\/github\.com\/fderuiter\/wedding_website\/blob\/HEAD\/([^)#?]+)#L(\d+)(?:-L(\d+))?/g;
    const results: Array<{
      relPath: string;
      rawPath: string;
      startLine: number;
      endLine: number;
    }> = [];
    let match: RegExpExecArray | null;
    while ((match = re.exec(markdown)) !== null) {
      const rawPath = match[1];
      const relPath = decodeURIComponent(rawPath);
      const startLine = Number.parseInt(match[2], 10);
      const endLine = match[3] ? Number.parseInt(match[3], 10) : startLine;
      results.push({ relPath, rawPath, startLine, endLine });
    }
    return results;
  }

  it('passes checkLinksInFile with zero broken links or out-of-range line fragments', () => {
    const errors: LinkError[] = [];
    checkLinksInFile(docAbsPath, errors, rootDir);
    expect(errors).toEqual([]);
  });

  it('percent-encodes bracketed Next.js route links so checkLinksInFile resolves [id] and [...path] routes', () => {
    expect(docContent).toContain('src/app/api/media/%5Bid%5D/route.ts#L32-L43');
    expect(docContent).toContain('src/app/api/uploads/%5B...path%5D/route.ts#L68-L126');
    expect(docContent).not.toMatch(
      /https:\/\/github\.com\/fderuiter\/wedding_website\/blob\/HEAD\/[^\s)]*\[[^\s)]*\]/
    );
  });

  it('anchors getStorageProvider and all referenced source symbols to their exact live line ranges', () => {
    const anchors = extractRepoBlobAnchors(docContent);
    expect(anchors.length).toBeGreaterThanOrEqual(20);

    const expectedSymbolByTarget: Array<{
      relPath: string;
      symbolPattern: RegExp;
    }> = [
      {
        relPath: 'src/utils/storage.ts',
        symbolPattern: /export function getStorageProvider\(\): StorageProvider/,
      },
      {
        relPath: 'src/utils/storage.ts',
        symbolPattern: /export interface StorageUploadInputObject[\s\S]*export interface StorageValidationResult/,
      },
      {
        relPath: 'src/utils/storage.ts',
        symbolPattern: /function getLocalUploadMimeType\(/,
      },
      {
        relPath: 'src/utils/storage.ts',
        symbolPattern: /async getMetadata\(keyOrUrl: string\): Promise<StorageObject \| null>/,
      },
      {
        relPath: 'src/utils/storage.ts',
        symbolPattern: /forcePathStyle:\s*endpoint\s*\?\s*true\s*:\s*undefined/,
      },
      {
        relPath: 'src/utils/storage.ts',
        symbolPattern: /async validateConfig\(\): Promise<StorageValidationResult>[\s\S]*Incomplete S3 storage credentials/,
      },
      {
        relPath: 'src/utils/pathContainment.ts',
        symbolPattern: /export class PathContainmentError extends Error/,
      },
      {
        relPath: 'src/utils/pathContainment.ts',
        symbolPattern: /export async function resolveContainedExistingPath[\s\S]*export async function resolveContainedWritePath/,
      },
      {
        relPath: 'src/utils/validationPrimitives.ts',
        symbolPattern: /export function decodeUrlPathSafely[\s\S]*export function isSafeConfigAssetUrl[\s\S]*export function isSafeMediaOrPhotoUrl/,
      },
      {
        relPath: 'src/utils/validation.ts',
        symbolPattern: /export const GuestPhotoUploadSchema[\s\S]*Maximum 10 photos allowed per upload/,
      },
      {
        relPath: 'src/utils/validation.ts',
        symbolPattern: /export const AdminUploadSchema/,
      },
      {
        relPath: 'src/app/api/admin/upload/route.ts',
        symbolPattern: /getStorageProvider\(\)\.upload\(sanitizedFile\)/,
      },
      {
        relPath: 'src/app/api/guest/photos/upload/route.ts',
        symbolPattern: /folder:\s*'uploads\/photos'[\s\S]*mediaRepository\.createMedia[\s\S]*status:\s*'PENDING'/,
      },
      {
        relPath: 'src/features/content/service.ts',
        symbolPattern: /else if \(action === 'reject'\)[\s\S]*getStorageProvider\(\)\.delete\(data\.url\)[\s\S]*mediaRepository\.deleteMedia\(data\.mediaId\)/,
      },
      {
        relPath: 'src/app/api/media/[id]/route.ts',
        symbolPattern: /export const DELETE[\s\S]*mediaRepository\.deleteMedia\(id\)/,
      },
      {
        relPath: 'src/features/media/repository.ts',
        symbolPattern: /async deleteMedia\(/,
      },
      {
        relPath: 'src/app/api/media/export/route.ts',
        symbolPattern: /CONCURRENCY_LIMIT = 8[\s\S]*safeFetch[\s\S]*resolveContainedExistingPath[\s\S]*wedding-photos\.zip/,
      },
      {
        relPath: 'src/utils/image-metadata.ts',
        symbolPattern: /export async function getLocalImageDimensions/,
      },
      {
        relPath: 'src/app/metadata.ts',
        symbolPattern: /getLocalImageDimensions\(ogImageUrl\)/,
      },
    ];

    for (const expected of expectedSymbolByTarget) {
      const matchingAnchors = anchors.filter((a) => a.relPath === expected.relPath);
      expect(matchingAnchors.length).toBeGreaterThan(0);

      const matched = matchingAnchors.some((anchor) => {
        const snippet = sliceFileLines(anchor.relPath, anchor.startLine, anchor.endLine);
        return expected.symbolPattern.test(snippet);
      });
      expect(matched).toBe(true);
    }

    // Specifically verify getStorageProvider anchor bounds match exact function declaration..closing brace
    const storageLines = fs.readFileSync(path.join(rootDir, 'src/utils/storage.ts'), 'utf8').split(/\r?\n/);
    const factoryStartLine =
      storageLines.findIndex((line) => line.startsWith('export function getStorageProvider(): StorageProvider')) + 1;
    expect(factoryStartLine).toBeGreaterThan(0);
    let factoryEndLine = factoryStartLine;
    while (factoryEndLine <= storageLines.length && storageLines[factoryEndLine - 1] !== '}') {
      factoryEndLine++;
    }

    const factoryAnchors = anchors.filter(
      (a) => a.relPath === 'src/utils/storage.ts' && a.startLine === factoryStartLine && a.endLine === factoryEndLine
    );
    expect(factoryAnchors.length).toBeGreaterThanOrEqual(1);
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
    // Ensure no unescaped Vue mustache interpolations leak into prose
    expect(stagedInMemory).not.toContain('&#123;&#123;');
  });
});
