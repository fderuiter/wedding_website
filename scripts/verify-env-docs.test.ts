import fs from 'fs';
import os from 'os';
import path from 'path';
import { getKeysFromSource, validateEnvDocContent, verifyEnvDocs } from './verify-env-docs';

describe('verify-env-docs section-aware validation', () => {
  const sampleKeys = [
    'NODE_ENV',
    'DATABASE_URL',
    'ADMIN_PASSWORD',
    'ALLOWED_HOSTS',
    'GUEST_SESSION_SECRET',
    'STRIPE_SECRET_KEY',
  ];

  it('passes when a markdown guide has a single complete environment variable reference section', () => {
    const markdown = [
      '# Deployment Guide',
      '',
      '## Overview',
      'Ensure `DATABASE_URL` and `ADMIN_PASSWORD` are configured.',
      '',
      '## Environment Variables Reference',
      '- `NODE_ENV`: Environment mode.',
      '- `DATABASE_URL`: PostgreSQL URL.',
      '- `ADMIN_PASSWORD`: Scrypt password hash.',
      '- `ALLOWED_HOSTS`: Allowed hostnames.',
      '- `GUEST_SESSION_SECRET`: HMAC session secret.',
      '- `STRIPE_SECRET_KEY`: Optional Stripe key.',
      '',
      '## Setup and Secrets',
      '| Secret | Purpose |',
      '|---|---|',
      '| `DATABASE_URL` | Migration secret |',
      '| `GCP_SA_KEY` | Cloud Run auth |',
    ].join('\n');

    expect(validateEnvDocContent('DEPLOYMENT.md', markdown, sampleKeys)).toEqual([]);
  });

  it('passes when a markdown guide uses table formatting inside its single env section', () => {
    const markdown = [
      '# Cloud Run Guide',
      '',
      '## 2. Required Environment Variables',
      '| Variable | Required |',
      '|---|---|',
      '| `NODE_ENV` | Yes |',
      '| `DATABASE_URL` | Yes |',
      '| `ADMIN_PASSWORD` | Yes |',
      '| `ALLOWED_HOSTS` | Yes |',
      '| `GUEST_SESSION_SECRET` | Yes |',
      '| `STRIPE_SECRET_KEY` | No |',
    ].join('\n');

    expect(validateEnvDocContent('docs/deployment/gcp-cloud-run.md', markdown, sampleKeys)).toEqual([]);
  });

  it('rejects a partial duplicate environment variable list in the same document', () => {
    const markdown = [
      '# Deployment Guide',
      '',
      '## Environment Variables Reference',
      '- `NODE_ENV`: Mode.',
      '- `DATABASE_URL`: Database.',
      '- `ADMIN_PASSWORD`: Admin hash.',
      '- `ALLOWED_HOSTS`: Hosts.',
      '- `GUEST_SESSION_SECRET`: Session secret.',
      '- `STRIPE_SECRET_KEY`: Stripe key.',
      '',
      '## 💻 Environment Variables',
      '- `NODE_ENV`: Mode.',
      '- `DATABASE_URL`: Database.',
      '- `ADMIN_PASSWORD`: Admin hash.',
      '- `ALLOWED_HOSTS`: Hosts.',
      '- `GUEST_SESSION_SECRET`: Session secret.',
    ].join('\n');

    const errors = validateEnvDocContent('DEPLOYMENT.md', markdown, sampleKeys);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Duplicate environment variable reference sections in DEPLOYMENT.md'),
        expect.stringContaining('Missing variable STRIPE_SECRET_KEY in section "## 💻 Environment Variables" of DEPLOYMENT.md'),
      ])
    );
  });

  it('rejects an unlabelled duplicate variable table even without "Environment Variables" in its heading', () => {
    const markdown = [
      '# Deployment Guide',
      '',
      '## Environment Variables Reference',
      '- `NODE_ENV`: Mode.',
      '- `DATABASE_URL`: Database.',
      '- `ADMIN_PASSWORD`: Admin hash.',
      '- `ALLOWED_HOSTS`: Hosts.',
      '- `GUEST_SESSION_SECRET`: Session secret.',
      '- `STRIPE_SECRET_KEY`: Stripe key.',
      '',
      '## Quick Config Appendix',
      '| Variable | Notes |',
      '|---|---|',
      '| `NODE_ENV` | Mode |',
      '| `DATABASE_URL` | DB |',
      '| `ADMIN_PASSWORD` | Hash |',
      '| `ALLOWED_HOSTS` | Hosts |',
    ].join('\n');

    const errors = validateEnvDocContent('DEPLOYMENT.md', markdown, sampleKeys);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Duplicate environment variable reference sections in DEPLOYMENT.md'),
        expect.stringContaining('Missing variable STRIPE_SECRET_KEY in section "## Quick Config Appendix" of DEPLOYMENT.md'),
      ])
    );
  });

  it('ignores level-2 headings and variable bullets inside fenced code blocks', () => {
    const markdown = [
      '# Deployment Guide',
      '',
      '## Environment Variables Reference',
      '- `NODE_ENV`: Mode.',
      '- `DATABASE_URL`: Database.',
      '- `ADMIN_PASSWORD`: Admin hash.',
      '- `ALLOWED_HOSTS`: Hosts.',
      '- `GUEST_SESSION_SECRET`: Session secret.',
      '- `STRIPE_SECRET_KEY`: Stripe key.',
      '',
      '## CLI Examples',
      '```markdown',
      '## Environment Variables',
      '- `NODE_ENV`: Ignored inside fenced block',
      '```',
    ].join('\n');

    expect(validateEnvDocContent('DEPLOYMENT.md', markdown, sampleKeys)).toEqual([]);
  });

  it('validates .env.example active and commented assignments and rejects missing or duplicate keys', () => {
    const validEnvExample = [
      'NODE_ENV=development',
      'DATABASE_URL="postgresql://localhost:5432/db"',
      'ADMIN_PASSWORD="scrypt:aa:bb"',
      'ALLOWED_HOSTS="localhost"',
      'GUEST_SESSION_SECRET="secret"',
      '# STRIPE_SECRET_KEY="sk_live_example"',
    ].join('\n');

    expect(validateEnvDocContent('.env.example', validEnvExample, sampleKeys)).toEqual([]);

    const brokenEnvExample = [
      'NODE_ENV=development',
      'NODE_ENV=production',
      'DATABASE_URL="postgresql://localhost:5432/db"',
      'ADMIN_PASSWORD="scrypt:aa:bb"',
      'ALLOWED_HOSTS="localhost"',
    ].join('\n');

    const errors = validateEnvDocContent('.env.example', brokenEnvExample, sampleKeys);
    expect(errors).toEqual(
      expect.arrayContaining([
        'Duplicate variable NODE_ENV in .env.example',
        'Missing variable GUEST_SESSION_SECRET in .env.example',
        'Missing variable STRIPE_SECRET_KEY in .env.example',
      ])
    );
  });

  it('validates all live repository documentation files against src/env.ts', () => {
    const repoRoot = process.cwd();
    const envKeys = getKeysFromSource(fs.readFileSync(path.join(repoRoot, 'src/env.ts'), 'utf8'));
    expect(envKeys.length).toBeGreaterThanOrEqual(20);

    const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    const mockErr = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => verifyEnvDocs(repoRoot)).not.toThrow();
      expect(mockErr).not.toHaveBeenCalled();
    } finally {
      mockLog.mockRestore();
      mockErr.mockRestore();
    }
  });

  it('exits 1 when verifyEnvDocs encounters drift in a workspace copy', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-env-docs-'));
    const mockExit = jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit: ${code}`);
    });
    const mockErr = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'src/env.ts'),
        "import { z } from 'zod'; const envSchema = z.object({ NODE_ENV: z.string(), DATABASE_URL: z.string() });"
      );
      fs.writeFileSync(
        path.join(tempDir, 'DEPLOYMENT.md'),
        '## Environment Variables Reference\n- `NODE_ENV`: mode\n\n## Environment Variables\n- `NODE_ENV`: duplicate\n'
      );

      expect(() => verifyEnvDocs(tempDir)).toThrow('process.exit: 1');
    } finally {
      mockExit.mockRestore();
      mockErr.mockRestore();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
