import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import {
  checkDocDrift,
  verifyDocSync,
  main,
  DEFAULT_DOC_FILES,
} from './verify-doc-sync';

describe('verify-doc-sync', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-sync-test-'));
    // Initialize temporary git repo
    execSync('git init -b main', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "Test Runner"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'ignore' });

    // Create baseline files matching DEFAULT_DOC_FILES
    fs.mkdirSync(path.join(tempDir, 'public'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'public', 'openapi.json'), '{"openapi": "3.0.3"}');
    fs.writeFileSync(path.join(tempDir, 'ARCHITECTURE.md'), '# System Architecture');
    fs.writeFileSync(path.join(tempDir, 'FEATURE_MODULES.md'), '# Feature Modules');

    // Create an unrelated file
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'src', 'index.ts'), 'export const a = 1;');

    // Commit baseline
    execSync('git add .', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "Initial commit"', { cwd: tempDir, stdio: 'ignore' });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('checkDocDrift', () => {
    it('tracks public/openapi.json, ARCHITECTURE.md, and FEATURE_MODULES.md in DEFAULT_DOC_FILES', () => {
      expect(DEFAULT_DOC_FILES).toEqual([
        'public/openapi.json',
        'ARCHITECTURE.md',
        'FEATURE_MODULES.md',
      ]);
    });

    it('returns empty array when git working directory has no documentation drift', () => {
      const drifted = checkDocDrift(DEFAULT_DOC_FILES, tempDir);
      expect(drifted).toEqual([]);
    });

    it('detects modifications in ARCHITECTURE.md', () => {
      fs.writeFileSync(path.join(tempDir, 'ARCHITECTURE.md'), '# Updated Architecture Content');
      const drifted = checkDocDrift(DEFAULT_DOC_FILES, tempDir);
      expect(drifted).toEqual(['ARCHITECTURE.md']);
    });

    it('detects modifications in FEATURE_MODULES.md', () => {
      fs.writeFileSync(path.join(tempDir, 'FEATURE_MODULES.md'), '# Updated Feature Modules Content');
      const drifted = checkDocDrift(DEFAULT_DOC_FILES, tempDir);
      expect(drifted).toEqual(['FEATURE_MODULES.md']);
    });

    it('detects modifications in public/openapi.json', () => {
      fs.writeFileSync(path.join(tempDir, 'public', 'openapi.json'), '{"openapi": "3.1.0"}');
      const drifted = checkDocDrift(DEFAULT_DOC_FILES, tempDir);
      expect(drifted).toEqual(['public/openapi.json']);
    });

    it('detects untracked or deleted documentation files', () => {
      fs.unlinkSync(path.join(tempDir, 'ARCHITECTURE.md'));
      fs.unlinkSync(path.join(tempDir, 'FEATURE_MODULES.md'));
      const drifted = checkDocDrift(DEFAULT_DOC_FILES, tempDir);
      expect(drifted).toEqual(['ARCHITECTURE.md', 'FEATURE_MODULES.md']);
    });

    it('ignores non-documentation file changes to prevent false positives', () => {
      // Modify an unrelated source file
      fs.writeFileSync(path.join(tempDir, 'src', 'index.ts'), 'export const a = 2;');
      // Add a new untracked file outside the documentation scope
      fs.writeFileSync(path.join(tempDir, 'unrelated.txt'), 'random change');

      const drifted = checkDocDrift(DEFAULT_DOC_FILES, tempDir);
      expect(drifted).toEqual([]);
    });
  });

  describe('verifyDocSync', () => {
    it('returns success: true when generator runs cleanly without producing drift', () => {
      let generatorCalled = false;
      const result = verifyDocSync({
        cwd: tempDir,
        files: DEFAULT_DOC_FILES,
        generateDocs: () => {
          generatorCalled = true;
          // Generator does not modify files beyond what is committed
        },
      });

      expect(generatorCalled).toBe(true);
      expect(result.success).toBe(true);
      expect(result.driftedFiles).toEqual([]);
      expect(result.error).toBeUndefined();
    });

    it('detects drift when generator modifies documentation files', () => {
      const result = verifyDocSync({
        cwd: tempDir,
        files: DEFAULT_DOC_FILES,
        generateDocs: () => {
          // Generator writes changes that differ from git HEAD
          fs.writeFileSync(
            path.join(tempDir, 'ARCHITECTURE.md'),
            '# Architecture with drift'
          );
        },
      });

      expect(result.success).toBe(false);
      expect(result.driftedFiles).toContain('ARCHITECTURE.md');
      expect(result.error).toBeUndefined();
    });

    it('detects drift when generator modifies FEATURE_MODULES.md', () => {
      const result = verifyDocSync({
        cwd: tempDir,
        files: DEFAULT_DOC_FILES,
        generateDocs: () => {
          fs.writeFileSync(
            path.join(tempDir, 'FEATURE_MODULES.md'),
            '# Feature modules with drift'
          );
        },
      });

      expect(result.success).toBe(false);
      expect(result.driftedFiles).toEqual(['FEATURE_MODULES.md']);
      expect(result.error).toBeUndefined();
    });

    it('detects multiple drifted documentation files', () => {
      const result = verifyDocSync({
        cwd: tempDir,
        files: DEFAULT_DOC_FILES,
        generateDocs: () => {
          fs.writeFileSync(
            path.join(tempDir, 'ARCHITECTURE.md'),
            '# Architecture drift'
          );
          fs.writeFileSync(
            path.join(tempDir, 'FEATURE_MODULES.md'),
            '# Feature modules drift'
          );
          fs.writeFileSync(
            path.join(tempDir, 'public', 'openapi.json'),
            '{"openapi": "drift"}'
          );
        },
      });

      expect(result.success).toBe(false);
      expect(result.driftedFiles).toHaveLength(3);
      expect(result.driftedFiles).toContain('ARCHITECTURE.md');
      expect(result.driftedFiles).toContain('FEATURE_MODULES.md');
      expect(result.driftedFiles).toContain('public/openapi.json');
    });

    it('ignores uncommitted non-documentation changes during verification', () => {
      // Developer has uncommitted feature changes in src/
      fs.writeFileSync(path.join(tempDir, 'src', 'index.ts'), 'export const modified = true;');

      const result = verifyDocSync({
        cwd: tempDir,
        files: DEFAULT_DOC_FILES,
        generateDocs: () => {
          // Generator keeps docs clean
        },
      });

      expect(result.success).toBe(true);
      expect(result.driftedFiles).toEqual([]);
    });

    it('captures errors when generator throws an exception', () => {
      const result = verifyDocSync({
        cwd: tempDir,
        files: DEFAULT_DOC_FILES,
        generateDocs: () => {
          throw new Error('Missing schema definition for endpoint');
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Documentation generation failed: Missing schema definition for endpoint');
      expect(result.driftedFiles).toEqual([]);
    });

    it('handles skipGeneration option cleanly', () => {
      const result = verifyDocSync({
        cwd: tempDir,
        files: DEFAULT_DOC_FILES,
        skipGeneration: true,
      });

      expect(result.success).toBe(true);
      expect(result.driftedFiles).toEqual([]);
    });
  });

  describe('main CLI runner', () => {
    let mockExit: jest.SpyInstance;
    let mockConsoleLog: jest.SpyInstance;
    let mockConsoleError: jest.SpyInstance;

    beforeEach(() => {
      mockExit = jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`process.exit: ${code}`);
      });
      mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
      mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      mockExit.mockRestore();
      mockConsoleLog.mockRestore();
      mockConsoleError.mockRestore();
    });

    it('exits with code 0 on clean pass', () => {
      expect(() => {
        main({
          cwd: tempDir,
          files: DEFAULT_DOC_FILES,
          skipGeneration: true,
        });
      }).toThrow('process.exit: 0');
    });

    it('exits with code 1 and prints remediation when drift is detected', () => {
      fs.writeFileSync(path.join(tempDir, 'ARCHITECTURE.md'), '# Drifted');
      expect(() => {
        main({
          cwd: tempDir,
          files: DEFAULT_DOC_FILES,
          skipGeneration: true,
        });
      }).toThrow('process.exit: 1');

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Documentation Drift Detected!')
      );
    });

    it('exits with code 1 and prints remediation when generation fails', () => {
      expect(() => {
        main({
          cwd: tempDir,
          files: DEFAULT_DOC_FILES,
          generateDocs: () => {
            throw new Error('Build error');
          },
        });
      }).toThrow('process.exit: 1');

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Documentation Generation Failed!')
      );
    });
  });
});
