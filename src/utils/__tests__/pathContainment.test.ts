/** @jest-environment node */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  PathContainmentError,
  resolveContainedExistingPath,
  resolveContainedWritePath,
} from '../pathContainment';
import { LocalStorageProvider } from '../storage';

describe('Shared Root Containment & LocalStorageProvider Real Filesystem Guards', () => {
  let sandboxDir: string;
  let publicDir: string;
  let uploadsDir: string;
  let outsideDir: string;

  beforeEach(async () => {
    sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'containment-test-'));
    publicDir = path.join(sandboxDir, 'public');
    uploadsDir = path.join(publicDir, 'uploads');
    outsideDir = path.join(sandboxDir, 'outside');
    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.mkdir(path.join(publicDir, 'images'), { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });
  });

  afterEach(async () => {
    if (sandboxDir) {
      await fs.rm(sandboxDir, { recursive: true, force: true });
    }
  });

  describe('resolveContainedExistingPath & resolveContainedWritePath', () => {
    it('resolves valid paths inside root and rejects parent, encoded, backslash, and null-byte escapes', async () => {
      const validFile = path.join(uploadsDir, 'photo.jpg');
      await fs.writeFile(validFile, 'img-bytes');

      const res = await resolveContainedExistingPath('/uploads/photo.jpg', {
        baseDir: publicDir,
        containmentRoot: uploadsDir,
      });
      expect(res.exists).toBe(true);
      if (res.exists) {
        expect(res.realPath).toBe(await fs.realpath(validFile));
      }

      const badInputs = [
        '/../outside/secret.txt',
        '/%2e%2e/outside/secret.txt',
        '/%252e%252e/outside/secret.txt',
        '/%2525252e%2525252e/outside/secret.txt',
        '/uploads/../../outside/secret.txt',
        '/uploads\\photo.jpg',
        '/uploads/%5cphoto.jpg',
        '/uploads/photo.jpg\0.png',
        '/uploads/photo.jpg%00.png',
        '/images/static.png',
      ];

      for (const bad of badInputs) {
        await expect(
          resolveContainedExistingPath(bad, { baseDir: publicDir, containmentRoot: uploadsDir })
        ).rejects.toThrow(PathContainmentError);

        await expect(
          resolveContainedWritePath(bad, { baseDir: publicDir, containmentRoot: uploadsDir })
        ).rejects.toThrow(PathContainmentError);
      }
    });

    it('rejects symlinks escaping root on read/delete and symlinked parent/file targets on write', async () => {
      const canaryPath = path.join(outsideDir, 'canary.txt');
      await fs.writeFile(canaryPath, 'CANARY_INTACT', 'utf8');

      const fileSymlink = path.join(uploadsDir, 'escape-file.txt');
      await fs.symlink(canaryPath, fileSymlink);

      const dirSymlink = path.join(uploadsDir, 'escape-dir');
      await fs.symlink(outsideDir, dirSymlink);

      const danglingSymlink = path.join(uploadsDir, 'dangling-file.txt');
      await fs.symlink(path.join(outsideDir, 'nonexistent.txt'), danglingSymlink);

      await expect(
        resolveContainedExistingPath('uploads/escape-file.txt', {
          baseDir: publicDir,
          containmentRoot: uploadsDir,
        })
      ).rejects.toThrow(PathContainmentError);

      await expect(
        resolveContainedExistingPath('uploads/dangling-file.txt', {
          baseDir: publicDir,
          containmentRoot: uploadsDir,
        })
      ).rejects.toThrow(PathContainmentError);

      await expect(
        resolveContainedWritePath('uploads/escape-dir/nested/pwn.txt', {
          baseDir: publicDir,
          containmentRoot: uploadsDir,
        })
      ).rejects.toThrow(PathContainmentError);

      await expect(
        resolveContainedWritePath('uploads/escape-file.txt', {
          baseDir: publicDir,
          containmentRoot: uploadsDir,
        })
      ).rejects.toThrow(PathContainmentError);

      // Verify nested directory inside outsideDir was never created and canary is untouched
      await expect(fs.stat(path.join(outsideDir, 'nested'))).rejects.toThrow();
      expect(await fs.readFile(canaryPath, 'utf8')).toBe('CANARY_INTACT');
    });

    it('reuses a pre-resolved canonicalRoot to execute a single fs.realpath per existing target while preserving all containment guards', async () => {
      const fileA = path.join(uploadsDir, 'a.jpg');
      const fileB = path.join(uploadsDir, 'b.png');
      const canaryPath = path.join(outsideDir, 'secret.txt');
      await fs.writeFile(fileA, 'bytes-a');
      await fs.writeFile(fileB, 'bytes-b');
      await fs.writeFile(canaryPath, 'secret');

      const escapeSymlink = path.join(uploadsDir, 'escape-link.jpg');
      await fs.symlink(canaryPath, escapeSymlink);
      const danglingSymlink = path.join(uploadsDir, 'dangling-link.jpg');
      await fs.symlink(path.join(outsideDir, 'missing.jpg'), danglingSymlink);

      const canonicalPublicRoot = await fs.realpath(publicDir);
      const realpathSpy = jest.spyOn(fs, 'realpath');

      try {
        const resA = await resolveContainedExistingPath('/uploads/a.jpg', {
          baseDir: publicDir,
          containmentRoot: publicDir,
          canonicalRoot: canonicalPublicRoot,
        });
        const resB = await resolveContainedExistingPath('/uploads/b.png', {
          baseDir: publicDir,
          containmentRoot: publicDir,
          canonicalRoot: canonicalPublicRoot,
        });

        expect(resA.exists).toBe(true);
        expect(resB.exists).toBe(true);
        // Only 1 fs.realpath call per existing target (none for baseDir or containmentRoot)
        expect(realpathSpy).toHaveBeenCalledTimes(2);

        // Missing file directly under publicDir does not re-run fs.realpath on publicDir
        realpathSpy.mockClear();
        const missingRootFile = await resolveContainedExistingPath('/missing-top-level.jpg', {
          baseDir: publicDir,
          containmentRoot: publicDir,
          canonicalRoot: canonicalPublicRoot,
        });
        expect(missingRootFile.exists).toBe(false);
        expect(realpathSpy).toHaveBeenCalledTimes(1);

        // Security guards remain enforced when canonicalRoot is provided
        for (const bad of [
          '/../outside/secret.txt',
          '/%2e%2e/outside/secret.txt',
          '/uploads\\a.jpg',
          '/uploads/a.jpg\0.png',
          '/uploads/escape-link.jpg',
          '/uploads/dangling-link.jpg',
        ]) {
          await expect(
            resolveContainedExistingPath(bad, {
              baseDir: publicDir,
              containmentRoot: publicDir,
              canonicalRoot: canonicalPublicRoot,
            })
          ).rejects.toThrow(PathContainmentError);
        }
      } finally {
        realpathSpy.mockRestore();
      }
    });
  });

  describe('LocalStorageProvider real filesystem containment', () => {
    it('confines upload, delete, and getMetadata to public/uploads without touching out-of-root or static files', async () => {
      const provider = new LocalStorageProvider(publicDir);

      const canaryPath = path.join(sandboxDir, 'canary-outside-public.txt');
      const staticAssetPath = path.join(publicDir, 'images', 'placeholder.png');
      await fs.writeFile(canaryPath, 'HARMLESS_CANARY_OUTSIDE_PUBLIC\n', 'utf8');
      await fs.writeFile(staticAssetPath, 'BUNDLED_STATIC_ASSET', 'utf8');

      const symlinkInUploads = path.join(uploadsDir, 'symlink-canary.txt');
      await fs.symlink(canaryPath, symlinkInUploads);

      const symlinkDirInUploads = path.join(uploadsDir, 'symlink-outside');
      await fs.symlink(outsideDir, symlinkDirInUploads);

      // Valid upload inside public/uploads succeeds
      const uploaded = await provider.upload(
        { buffer: Buffer.from('hello'), filename: 'cover.png', mimeType: 'image/png' },
        { folder: 'uploads/photos' }
      );
      expect(uploaded.url).toMatch(/^\/uploads\/photos\/[a-f0-9]{16}\.png$/);

      const meta = await provider.getMetadata(uploaded.url);
      expect(meta).not.toBeNull();
      expect(meta?.size).toBe(5);

      // Out-of-root & symlink uploads fail without writing outside public/uploads
      await expect(
        provider.upload(
          { buffer: Buffer.from('pwn'), filename: 'x.txt', mimeType: 'text/plain' },
          { key: '/../canary-outside-public.txt' }
        )
      ).rejects.toThrow(PathContainmentError);

      await expect(
        provider.upload(
          { buffer: Buffer.from('pwn'), filename: 'x.txt', mimeType: 'text/plain' },
          { key: 'uploads/symlink-outside/pwn.txt' }
        )
      ).rejects.toThrow(PathContainmentError);

      await expect(
        provider.upload(
          { buffer: Buffer.from('pwn'), filename: 'x.txt', mimeType: 'text/plain' },
          { key: 'uploads/symlink-canary.txt' }
        )
      ).rejects.toThrow(PathContainmentError);

      // Out-of-root & symlink deletes fail without unlinking canary or static files
      await expect(provider.delete('/../canary-outside-public.txt')).rejects.toThrow(PathContainmentError);
      await expect(provider.delete('/%2e%2e/canary-outside-public.txt')).rejects.toThrow(PathContainmentError);
      await expect(provider.delete('/images/placeholder.png')).rejects.toThrow(PathContainmentError);
      await expect(provider.delete('/uploads/symlink-canary.txt')).rejects.toThrow(PathContainmentError);

      // Out-of-root & symlink metadata probes fail
      await expect(provider.getMetadata('/../canary-outside-public.txt')).rejects.toThrow(PathContainmentError);
      await expect(provider.getMetadata('/images/placeholder.png')).rejects.toThrow(PathContainmentError);
      await expect(provider.getMetadata('/uploads/symlink-canary.txt')).rejects.toThrow(PathContainmentError);

      // Valid delete removes uploaded file while canary and static asset remain intact
      await provider.delete(uploaded.url);
      expect(await provider.getMetadata(uploaded.url)).toBeNull();
      expect(await fs.readFile(canaryPath, 'utf8')).toBe('HARMLESS_CANARY_OUTSIDE_PUBLIC\n');
      expect(await fs.readFile(staticAssetPath, 'utf8')).toBe('BUNDLED_STATIC_ASSET');
    });
  });
});
