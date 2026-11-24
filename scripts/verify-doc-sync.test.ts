import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import {
  checkDocDrift,
  verifyDocSync,
  runDocGeneration,
  main,
  DEFAULT_DOC_FILES,
} from './verify-doc-sync';

describe('verify-doc-sync', () => {
  const repoRoot = process.cwd();
  let tempDir: string;

  function installStubCheckGenerators(
    expectedDocs: Partial<Record<'public/openapi.json' | 'ARCHITECTURE.md' | 'FEATURE_MODULES.md', string>> = {}
  ): void {
    const expectedMap = {
      'public/openapi.json': '{"openapi": "3.0.3"}',
      'ARCHITECTURE.md': '# System Architecture',
      'FEATURE_MODULES.md': '# Feature Modules',
      ...expectedDocs,
    };

    fs.mkdirSync(path.join(tempDir, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'scripts', 'generate-openapi.ts'),
      [
        "import fs from 'fs';",
        "import path from 'path';",
        `const expected = ${JSON.stringify(expectedMap['public/openapi.json'])};`,
        "const outPath = path.join(process.cwd(), 'public', 'openapi.json');",
        "if (process.argv.includes('--check')) {",
        "  const actual = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;",
        '  if (actual !== expected) {',
        "    console.error('Drift detected in public/openapi.json');",
        '    process.exit(1);',
        '  }',
        '  process.exit(0);',
        '}',
        'fs.writeFileSync(outPath, expected);',
      ].join('\n')
    );

    fs.writeFileSync(
      path.join(tempDir, 'scripts', 'generate-docs.ts'),
      [
        "import fs from 'fs';",
        "import path from 'path';",
        `const expectedArch = ${JSON.stringify(expectedMap['ARCHITECTURE.md'])};`,
        `const expectedFeatures = ${JSON.stringify(expectedMap['FEATURE_MODULES.md'])};`,
        "const archPath = path.join(process.cwd(), 'ARCHITECTURE.md');",
        "const featuresPath = path.join(process.cwd(), 'FEATURE_MODULES.md');",
        "if (process.argv.includes('--check')) {",
        '  let hasDrift = false;',
        "  const actualArch = fs.existsSync(archPath) ? fs.readFileSync(archPath, 'utf8') : null;",
        '  if (actualArch !== expectedArch) {',
        "    console.error('Drift detected in ARCHITECTURE.md');",
        '    hasDrift = true;',
        '  }',
        "  const actualFeatures = fs.existsSync(featuresPath) ? fs.readFileSync(featuresPath, 'utf8') : null;",
        '  if (actualFeatures !== expectedFeatures) {',
        "    console.error('Drift detected in FEATURE_MODULES.md');",
        '    hasDrift = true;',
        '  }',
        '  process.exit(hasDrift ? 1 : 0);',
        '}',
        'fs.writeFileSync(archPath, expectedArch);',
        'fs.writeFileSync(featuresPath, expectedFeatures);',
      ].join('\n')
    );
  }

  function withRepoBinPath<T>(fn: () => T): T {
    const prevPath = process.env.PATH;
    process.env.PATH = `${path.join(repoRoot, 'node_modules', '.bin')}${path.delimiter}${prevPath ?? ''}`;
    try {
      return fn();
    } finally {
      process.env.PATH = prevPath;
    }
  }

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
      fs.writeFileSync(path.join(tempDir, 'src', 'index.ts'), 'export const a = 2;');
      fs.writeFileSync(path.join(tempDir, 'unrelated.txt'), 'random change');

      const drifted = checkDocDrift(DEFAULT_DOC_FILES, tempDir);
      expect(drifted).toEqual([]);
    });

    it('allows staged documentation updates (M ) and additions (A ) when working tree matches staged index', () => {
      fs.writeFileSync(path.join(tempDir, 'public', 'openapi.json'), '{"openapi": "3.0.3", "updated": true}');
      fs.writeFileSync(path.join(tempDir, 'NEW_DOC.md'), '# Newly Generated Doc\n');
      execSync('git add public/openapi.json NEW_DOC.md', { cwd: tempDir, stdio: 'ignore' });

      const trackedFiles = [...DEFAULT_DOC_FILES, 'NEW_DOC.md'];
      const porcelain = execSync('git status --porcelain -- public/openapi.json NEW_DOC.md', {
        cwd: tempDir,
        encoding: 'utf8',
      });
      expect(porcelain).toContain('M  public/openapi.json');
      expect(porcelain).toContain('A  NEW_DOC.md');
      expect(checkDocDrift(trackedFiles, tempDir)).toEqual([]);
    });

    it('detects drift for stale staged edits (MM), staged deletions (D ), and untracked files (??)', () => {
      fs.writeFileSync(path.join(tempDir, 'public', 'openapi.json'), '{"openapi": "3.0.3", "updated": true}');
      execSync('git add public/openapi.json', { cwd: tempDir, stdio: 'ignore' });
      fs.writeFileSync(path.join(tempDir, 'public', 'openapi.json'), '{"openapi": "3.0.3", "updated": false}');

      execSync('git rm ARCHITECTURE.md', { cwd: tempDir, stdio: 'ignore' });

      fs.writeFileSync(path.join(tempDir, 'UNTRACKED_DOC.md'), '# Untracked Doc\n');

      const trackedFiles = [...DEFAULT_DOC_FILES, 'UNTRACKED_DOC.md'];
      const drifted = checkDocDrift(trackedFiles, tempDir);
      expect(drifted).toEqual([
        'ARCHITECTURE.md',
        'public/openapi.json',
        'UNTRACKED_DOC.md',
      ]);
    });

    it('deduplicates paths when a staged deletion (D ) is recreated as untracked (??) on disk', () => {
      execSync('git rm ARCHITECTURE.md', { cwd: tempDir, stdio: 'ignore' });
      fs.writeFileSync(path.join(tempDir, 'ARCHITECTURE.md'), '# System Architecture');

      const porcelain = execSync('git status --porcelain -- "ARCHITECTURE.md"', {
        cwd: tempDir,
        encoding: 'utf8',
      });
      expect(porcelain).toContain('D  ARCHITECTURE.md');
      expect(porcelain).toContain('?? ARCHITECTURE.md');

      expect(checkDocDrift(DEFAULT_DOC_FILES, tempDir)).toEqual(['ARCHITECTURE.md']);
    });
  });

  describe('verifyDocSync (read-only --check verification)', () => {
    it('returns success: true when --check generators confirm all DEFAULT_DOC_FILES are in sync without disk writes', () => {
      installStubCheckGenerators();
      execSync('git add scripts && git commit -m "Add stub check generators"', {
        cwd: tempDir,
        stdio: 'ignore',
      });

      const result = withRepoBinPath(() =>
        verifyDocSync({
          cwd: tempDir,
          files: DEFAULT_DOC_FILES,
        })
      );

      expect(result.success).toBe(true);
      expect(result.driftedFiles).toEqual([]);
      expect(result.error).toBeUndefined();
      expect(execSync('git status --porcelain', { cwd: tempDir, encoding: 'utf8' }).trim()).toBe('');
    });

    it('detects drift in ARCHITECTURE.md via --check without modifying files on disk', () => {
      installStubCheckGenerators({
        'ARCHITECTURE.md': '# Architecture with drift',
      });
      execSync('git add scripts && git commit -m "Add drifted architecture stub"', {
        cwd: tempDir,
        stdio: 'ignore',
      });

      const result = withRepoBinPath(() =>
        verifyDocSync({
          cwd: tempDir,
          files: DEFAULT_DOC_FILES,
        })
      );

      expect(result.success).toBe(false);
      expect(result.driftedFiles).toEqual(['ARCHITECTURE.md']);
      expect(result.error).toBeUndefined();
      expect(fs.readFileSync(path.join(tempDir, 'ARCHITECTURE.md'), 'utf8')).toBe(
        '# System Architecture'
      );
      expect(execSync('git status --porcelain', { cwd: tempDir, encoding: 'utf8' }).trim()).toBe('');
    });

    it('detects drift in FEATURE_MODULES.md via --check without modifying files on disk', () => {
      installStubCheckGenerators({
        'FEATURE_MODULES.md': '# Feature modules with drift',
      });
      execSync('git add scripts && git commit -m "Add drifted feature modules stub"', {
        cwd: tempDir,
        stdio: 'ignore',
      });

      const result = withRepoBinPath(() =>
        verifyDocSync({
          cwd: tempDir,
          files: DEFAULT_DOC_FILES,
        })
      );

      expect(result.success).toBe(false);
      expect(result.driftedFiles).toEqual(['FEATURE_MODULES.md']);
      expect(result.error).toBeUndefined();
      expect(fs.readFileSync(path.join(tempDir, 'FEATURE_MODULES.md'), 'utf8')).toBe(
        '# Feature Modules'
      );
      expect(execSync('git status --porcelain', { cwd: tempDir, encoding: 'utf8' }).trim()).toBe('');
    });

    it('detects multiple drifted documentation files in memory while preserving unstaged local drafts on disk', () => {
      installStubCheckGenerators({
        'public/openapi.json': '{"openapi": "3.1.0"}',
        'ARCHITECTURE.md': '# Architecture drift',
        'FEATURE_MODULES.md': '# Feature modules drift',
      });
      execSync('git add scripts && git commit -m "Add multi-drift stubs"', {
        cwd: tempDir,
        stdio: 'ignore',
      });

      // Contributor also holds an unstaged draft edit in ARCHITECTURE.md
      fs.writeFileSync(path.join(tempDir, 'ARCHITECTURE.md'), '# Unstaged local architecture draft');

      const result = withRepoBinPath(() =>
        verifyDocSync({
          cwd: tempDir,
          files: DEFAULT_DOC_FILES,
        })
      );

      expect(result.success).toBe(false);
      expect(result.driftedFiles).toEqual([
        'public/openapi.json',
        'ARCHITECTURE.md',
        'FEATURE_MODULES.md',
      ]);
      expect(result.error).toBeUndefined();

      // Zero tracked files are rewritten by --check; unstaged local draft remains intact
      expect(fs.readFileSync(path.join(tempDir, 'public', 'openapi.json'), 'utf8')).toBe(
        '{"openapi": "3.0.3"}'
      );
      expect(fs.readFileSync(path.join(tempDir, 'ARCHITECTURE.md'), 'utf8')).toBe(
        '# Unstaged local architecture draft'
      );
      expect(fs.readFileSync(path.join(tempDir, 'FEATURE_MODULES.md'), 'utf8')).toBe(
        '# Feature Modules'
      );
    });

    it('ignores uncommitted non-documentation changes during verification', () => {
      installStubCheckGenerators();
      fs.writeFileSync(path.join(tempDir, 'src', 'index.ts'), 'export const modified = true;');

      const result = withRepoBinPath(() =>
        verifyDocSync({
          cwd: tempDir,
          files: DEFAULT_DOC_FILES,
        })
      );

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

    it('returns success: true when staged updates (M ) match --check output', () => {
      installStubCheckGenerators({
        'ARCHITECTURE.md': '# Updated Architecture\n',
      });
      fs.writeFileSync(path.join(tempDir, 'ARCHITECTURE.md'), '# Updated Architecture\n');
      execSync('git add ARCHITECTURE.md', { cwd: tempDir, stdio: 'ignore' });

      const result = withRepoBinPath(() =>
        verifyDocSync({
          cwd: tempDir,
          files: DEFAULT_DOC_FILES,
        })
      );

      expect(result.success).toBe(true);
      expect(result.driftedFiles).toEqual([]);
      expect(result.error).toBeUndefined();
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

    it('exits with code 1 and prints docs:sync remediation when drift is detected', () => {
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
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('npm run docs:sync')
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

  describe('Single-pass OpenAPI generation and --check contract', () => {
    it('invokes generate-openapi.ts --check once in runDocGeneration, passes --skip-openapi --check to generate-docs.ts, and defines docs:sync', () => {
      const counterFile = path.join(tempDir, 'openapi-count.txt');
      const flagsFile = path.join(tempDir, 'flags.log');
      fs.mkdirSync(path.join(tempDir, 'scripts'), { recursive: true });

      fs.writeFileSync(
        path.join(tempDir, 'scripts', 'generate-openapi.ts'),
        [
          "import fs from 'fs';",
          `const p = ${JSON.stringify(counterFile)};`,
          `const f = ${JSON.stringify(flagsFile)};`,
          "fs.appendFileSync(f, 'openapi:' + process.argv.slice(2).join(',') + '\\n');",
          "const prev = fs.existsSync(p) ? Number(fs.readFileSync(p, 'utf8')) : 0;",
          'fs.writeFileSync(p, String(prev + 1));',
        ].join('\n')
      );

      fs.writeFileSync(
        path.join(tempDir, 'scripts', 'generate-docs.ts'),
        [
          "import fs from 'fs';",
          `const p = ${JSON.stringify(counterFile)};`,
          `const f = ${JSON.stringify(flagsFile)};`,
          "fs.appendFileSync(f, 'docs:' + process.argv.slice(2).join(',') + '\\n');",
          "if (!process.argv.includes('--skip-openapi')) {",
          "  const prev = fs.existsSync(p) ? Number(fs.readFileSync(p, 'utf8')) : 0;",
          '  fs.writeFileSync(p, String(prev + 1));',
          '}',
        ].join('\n')
      );

      const drifted = withRepoBinPath(() => runDocGeneration(tempDir));
      expect(drifted).toEqual([]);
      expect(fs.readFileSync(counterFile, 'utf8')).toBe('1');
      expect(fs.readFileSync(flagsFile, 'utf8').trim().split('\n')).toEqual([
        'openapi:--check',
        'docs:--skip-openapi,--check',
      ]);

      const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      };
      expect(pkg.scripts['docs:sync']).toBe(
        'npx tsx scripts/generate-openapi.ts && npx tsx scripts/generate-docs.ts --skip-openapi'
      );

      const ciYaml = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
      expect(ciYaml).toContain('npx tsx scripts/generate-openapi.ts');
      expect(ciYaml).toContain('npx tsx scripts/generate-docs.ts --skip-openapi');

      const generateDocsSource = fs.readFileSync(
        path.join(repoRoot, 'scripts', 'generate-docs.ts'),
        'utf8'
      );
      expect(generateDocsSource).toContain("if (!process.argv.includes('--skip-openapi'))");
      expect(generateDocsSource).toContain('generateOpenApiSpec()');
    });
  });
});
