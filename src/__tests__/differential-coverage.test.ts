import { shouldCheckFile, parseDiff, parseLcov } from '../../scripts/differential-coverage.mjs';
import fs from 'fs';
import path from 'path';

describe('Dynamic New-Code Differential Coverage Guard', () => {
  describe('File Filtering Criteria (shouldCheckFile)', () => {
    it('accepts standard ts/tsx files in src', () => {
      expect(shouldCheckFile('src/utils/math.ts')).toBe(true);
      expect(shouldCheckFile('src/components/Button.tsx')).toBe(true);
    });

    it('rejects files outside src', () => {
      expect(shouldCheckFile('scripts/generate-docs.ts')).toBe(false);
      expect(shouldCheckFile('package.json')).toBe(false);
    });

    it('rejects type definition files', () => {
      expect(shouldCheckFile('src/types/index.ts')).toBe(false);
      expect(shouldCheckFile('src/components/button.d.ts')).toBe(false);
    });

    it('rejects layout and route files', () => {
      expect(shouldCheckFile('src/app/layout.tsx')).toBe(false);
      expect(shouldCheckFile('src/app/api/admin/route.ts')).toBe(false);
    });

    it('rejects styles folder and types folder', () => {
      expect(shouldCheckFile('src/styles/globals.css')).toBe(false);
      expect(shouldCheckFile('src/types/auth.ts')).toBe(false);
    });

    it('rejects test and spec files', () => {
      expect(shouldCheckFile('src/utils/__tests__/math.test.ts')).toBe(false);
      expect(shouldCheckFile('src/components/Button.spec.tsx')).toBe(false);
    });
  });

  describe('Git Diff Parsing (parseDiff)', () => {
    it('correctly parses empty diff output', () => {
      expect(parseDiff('')).toEqual({});
    });

    it('correctly parses added/modified lines in a single file', () => {
      const diffOutput = [
        'diff --git a/src/utils/math.ts b/src/utils/math.ts',
        'index 123456..789012 100644',
        '--- a/src/utils/math.ts',
        '+++ b/src/utils/math.ts',
        '@@ -5,2 +8,3 @@',
        '-old_line1',
        '-old_line2',
        '+new_line1',
        '+new_line2',
        '+new_line3',
      ].join('\n');

      const result = parseDiff(diffOutput);
      expect(result).toHaveProperty(['src/utils/math.ts']);
      expect(Array.from(result['src/utils/math.ts'])).toEqual([8, 9, 10]);
    });

    it('handles multiple files and hunks', () => {
      const diffOutput = [
        'diff --git a/src/utils/math.ts b/src/utils/math.ts',
        'index 123456..789012 100644',
        '--- a/src/utils/math.ts',
        '+++ b/src/utils/math.ts',
        '@@ -1,2 +1,3 @@',
        '+added_line_1',
        '@@ -10 +12,2 @@',
        '+added_line_2',
        '+added_line_3',
        'diff --git a/src/components/Button.tsx b/src/components/Button.tsx',
        'index abcdef..ffffff 100644',
        '--- a/src/components/Button.tsx',
        '+++ b/src/components/Button.tsx',
        '@@ -5,2 +5,1 @@',
        '-removed',
        '+modified_button',
      ].join('\n');

      const result = parseDiff(diffOutput);
      expect(result).toHaveProperty(['src/utils/math.ts']);
      expect(result).toHaveProperty(['src/components/Button.tsx']);
      expect(Array.from(result['src/utils/math.ts'])).toEqual([1, 12, 13]);
      expect(Array.from(result['src/components/Button.tsx'])).toEqual([5]);
    });
  });

  describe('LCOV Parsing (parseLcov)', () => {
    const tempLcovPath = path.join(process.cwd(), 'temp-test-lcov.info');

    afterEach(() => {
      if (fs.existsSync(tempLcovPath)) {
        fs.unlinkSync(tempLcovPath);
      }
    });

    it('returns null if file does not exist', () => {
      expect(parseLcov('non-existent-file.info')).toBeNull();
    });

    it('correctly parses valid LCOV file', () => {
      const lcovContent = [
        'TN:',
        'SF:src/utils/math.ts',
        'DA:1,1',
        'DA:2,0',
        'DA:3,10',
        'end_of_record',
        'TN:',
        'SF:/app/src/components/Button.tsx',
        'DA:10,2',
        'DA:15,0',
        'end_of_record'
      ].join('\n');

      fs.writeFileSync(tempLcovPath, lcovContent, 'utf8');

      const result = parseLcov(tempLcovPath);
      expect(result).not.toBeNull();
      expect(result).toHaveProperty(['src/utils/math.ts']);
      expect(result).toHaveProperty(['src/components/Button.tsx']);
      expect(result!['src/utils/math.ts']).toEqual({ 1: 1, 2: 0, 3: 10 });
      expect(result!['src/components/Button.tsx']).toEqual({ 10: 2, 15: 0 });
    });
  });
});
