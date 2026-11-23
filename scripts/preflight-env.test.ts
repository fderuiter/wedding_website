import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  type CliRunResult,
  extractComposeRequiredGuards,
  formatPreflightReport,
  isValidProductionScryptHash,
  type ParsedDotenvEntry,
  parseDotenvContent,
  type PreflightIssue,
  type PreflightResult,
  type PreflightTarget,
  type PreflightValidationOptions,
  runEnvPreflightFile,
  runPreflightCli,
  validateOperatorEnv,
} from './preflight-env';

function generateValidAdminScryptHash(password: string = 'test-strong-operator-password'): string {
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt:${salt.toString('base64')}:${derivedKey.toString('base64')}`;
}

describe('scripts/preflight-env.ts', () => {
  const repoRoot = process.cwd();
  const liveComposeRaw = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-env-test-'));
    fs.copyFileSync(path.join(repoRoot, 'docker-compose.yml'), path.join(tempDir, 'docker-compose.yml'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('parses .env assignments with comments, export prefixes, single/double quotes, and inline comments', () => {
    const parsed: Map<string, ParsedDotenvEntry> = parseDotenvContent([
      '# Header comment',
      'export NODE_ENV=production # trailing comment',
      'GUEST_PASSCODE="celebrate-together-2027"',
      'GUEST_SESSION_SECRET=\'literal-$not-interpolated-secret-value-32chars\'',
    ].join('\n'));

    expect(parsed.get('NODE_ENV')?.value).toBe('production');
    expect(parsed.get('GUEST_PASSCODE')?.quoteStyle).toBe('double');
    expect(parsed.get('GUEST_SESSION_SECRET')?.quoteStyle).toBe('single');
    expect(parsed.get('GUEST_SESSION_SECRET')?.value).toBe('literal-$not-interpolated-secret-value-32chars');
  });

  it('extracts all mandatory :? secret guards from live docker-compose.yml', () => {
    const guards = extractComposeRequiredGuards(liveComposeRaw);
    expect(guards).toEqual(
      expect.arrayContaining([
        'DB_PASSWORD',
        'ADMIN_PASSWORD',
        'GUEST_PASSCODE',
        'GUEST_SESSION_SECRET',
      ])
    );
  });

  it('exits 0 when a .env file satisfies all production and Docker Compose secret rules', () => {
    const validHash = generateValidAdminScryptHash();
    expect(isValidProductionScryptHash(validHash)).toBe(true);

    const envPath = path.join(tempDir, '.env');
    fs.writeFileSync(
      envPath,
      [
        'DB_USER=wedding',
        'DB_PASSWORD=a9f3e71b24c80d6512ab98cd34ef56789012abcd3456ef78',
        'DB_NAME=wedding',
        `ADMIN_PASSWORD="${validHash}"`,
        'ALLOWED_HOSTS="wedding.example.com,localhost,127.0.0.1"',
        'GUEST_PASSCODE="autumn-orchard-celebration-2027"',
        'GUEST_SESSION_SECRET="8f4a2e9c1d7b3a6f0e5c8d2a9b4f7e1c3d6a8b0e2f4c6d8a1b3e5f7a9c0d2e4f"',
        'TRUST_PROXY=true',
        'E2E_TEST=false',
      ].join('\n'),
      'utf8'
    );

    const cliRes: CliRunResult = runPreflightCli(['--env-file', envPath], tempDir);
    expect(cliRes.exitCode).toBe(0);
    expect(cliRes.stderr).toBe('');
    expect(cliRes.stdout).toContain('Environment preflight passed');
    expect(cliRes.stdout).toContain('DB_PASSWORD');
  });

  it('supports --no-compose / --target host when DATABASE_URL is set without DB_PASSWORD', () => {
    const validHash = generateValidAdminScryptHash();
    const envPath = path.join(tempDir, '.env.host');
    const target: PreflightTarget = 'host';
    fs.writeFileSync(
      envPath,
      [
        'NODE_ENV=production',
        'DATABASE_URL="postgresql://wedding_app:9a8b7c6d5e4f3a2b1c0d@db.internal:5432/wedding?schema=public"',
        `ADMIN_PASSWORD="${validHash}"`,
        'ALLOWED_HOSTS="wedding.example.com,localhost"',
        'GUEST_PASSCODE="harbor-lights-2027"',
        'GUEST_SESSION_SECRET="1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b"',
      ].join('\n'),
      'utf8'
    );

    const fileResult: PreflightResult = runEnvPreflightFile({
      cwd: tempDir,
      envFile: '.env.host',
      target,
    });
    expect(fileResult.ok).toBe(true);
    expect(formatPreflightReport(fileResult)).toContain('[target=host]');

    const noComposeCli = runPreflightCli(['--no-compose', envPath], tempDir);
    expect(noComposeCli.exitCode).toBe(0);
  });

  it('exits non-zero for .env.example defaults, legacy 32-byte/4-byte scrypt hashes, short session secrets, unpaired Stripe keys, incomplete S3 keys, and missing :? guards', () => {
    const legacy32ByteKey = Buffer.alloc(32, 7).toString('base64');
    const valid16ByteSalt = Buffer.alloc(16, 3).toString('base64');
    const legacy32ByteScrypt = `scrypt:${valid16ByteSalt}:${legacy32ByteKey}`;
    expect(isValidProductionScryptHash(legacy32ByteScrypt)).toBe(false);

    const envPath = path.join(tempDir, '.env');
    fs.writeFileSync(
      envPath,
      [
        'DATABASE_URL="postgresql://wedding:wedding123@localhost:5432/wedding?schema=public"',
        `ADMIN_PASSWORD="${legacy32ByteScrypt}"`,
        'GUEST_PASSCODE="wedding2026"',
        'GUEST_SESSION_SECRET="too-short-secret"',
        'STRIPE_SECRET_KEY="sk_live_valid_looking_unpaired"',
        'S3_BUCKET="partial-bucket-only"',
        'E2E_TEST=true',
      ].join('\n'),
      'utf8'
    );

    const cliRes = runPreflightCli(['--env-file', envPath], tempDir);
    expect(cliRes.exitCode).toBe(1);
    expect(cliRes.stdout).toBe('');
    expect(cliRes.stderr).toContain('[DB_PASSWORD]');
    expect(cliRes.stderr).toContain('[ADMIN_PASSWORD]');
    expect(cliRes.stderr).toContain('[GUEST_PASSCODE]');
    expect(cliRes.stderr).toContain('[GUEST_SESSION_SECRET]');
    expect(cliRes.stderr).toContain('[NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY]');
    expect(cliRes.stderr).toContain('[S3_REGION]');
    expect(cliRes.stderr).toContain('[E2E_TEST]');
  });

  it('rejects repository .env.example and .env.ci out of the box because placeholder secrets and disposable DB_PASSWORD defaults are not production-ready', () => {
    const exampleCopy = path.join(tempDir, '.env');
    fs.copyFileSync(path.join(repoRoot, '.env.example'), exampleCopy);

    const cliRes = runPreflightCli(['--env-file', exampleCopy], tempDir);
    expect(cliRes.exitCode).toBe(1);
    expect(cliRes.stderr).toContain('[DB_PASSWORD]');
    expect(cliRes.stderr).toContain('[ADMIN_PASSWORD]');
    expect(cliRes.stderr).toContain('[GUEST_PASSCODE]');
    expect(cliRes.stderr).toContain('[GUEST_SESSION_SECRET]');

    const ciCopy = path.join(tempDir, '.env.ci.copy');
    fs.copyFileSync(path.join(repoRoot, '.env.ci'), ciCopy);
    const ciCliRes = runPreflightCli(['--env-file', ciCopy], tempDir);
    expect(ciCliRes.exitCode).toBe(1);
    expect(ciCliRes.stderr).toContain('[DB_PASSWORD]');
    expect(ciCliRes.stderr).toContain('[ADMIN_PASSWORD]');
    expect(ciCliRes.stderr).toContain('[GUEST_PASSCODE]');
    expect(ciCliRes.stderr).toContain('[GUEST_SESSION_SECRET]');
    expect(ciCliRes.stderr).toContain('[E2E_TEST]');
  });

  it('validates CONTAINER_DATABASE_URL overrides in compose mode without leaking credentials', () => {
    const validHash = generateValidAdminScryptHash();
    const canaryPw = 'CANARY_CONTAINER_DB_PW_556677';
    const invalidEntries = parseDotenvContent([
      'DB_PASSWORD=a9f3e71b24c80d6512ab98cd34ef56789012abcd3456ef78',
      `CONTAINER_DATABASE_URL="mysql://wedding:${canaryPw}@external-db:3306/wedding"`,
      `ADMIN_PASSWORD="${validHash}"`,
      'GUEST_PASSCODE="autumn-orchard-celebration-2027"',
      'GUEST_SESSION_SECRET="8f4a2e9c1d7b3a6f0e5c8d2a9b4f7e1c3d6a8b0e2f4c6d8a1b3e5f7a9c0d2e4f"',
    ].join('\n'));

    const invalidRes = validateOperatorEnv(invalidEntries, {
      target: 'compose',
      composeContent: liveComposeRaw,
    });
    expect(invalidRes.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'CONTAINER_DATABASE_URL',
          rule: 'invalid-container-database-url',
        }),
      ])
    );
    expect(JSON.stringify(invalidRes.issues)).not.toContain(canaryPw);
  });

  it('never leaks raw secret values, password hashes, database credentials, or API keys in stdout, stderr, or issue objects', () => {
    const canaries = [
      'CANARY_DB_PW_998877',
      'CANARY_URL_PW_665544',
      'CANARY_PLAINTEXT_ADMIN_112233',
      'CANARY_SHORT_SESSION_445566',
      'sk_NotValidPrefix_CANARY_778899',
      'whsec_missing_CANARY_001122',
      'CANARY_DOLLAR$INTERPOLATION_334455',
    ];

    const entries = parseDotenvContent([
      `DB_PASSWORD="${canaries[0]}@broken/uri"`,
      `DATABASE_URL="mysql://admin:${canaries[1]}@localhost:3306/wedding"`,
      `ADMIN_PASSWORD="${canaries[2]}"`,
      `GUEST_PASSCODE="${canaries[3]}"`,
      `GUEST_SESSION_SECRET="${canaries[3]}"`,
      `STRIPE_SECRET_KEY="${canaries[4]}"`,
      `STRIPE_WEBHOOK_SECRET="invalid_${canaries[5]}"`,
      `CRON_SECRET="${canaries[6]}"`,
    ].join('\n'));

    const opts: PreflightValidationOptions = {
      target: 'compose',
      composeContent: liveComposeRaw,
    };
    const { issues }: { issues: PreflightIssue[] } = validateOperatorEnv(entries, opts);
    expect(issues.length).toBeGreaterThanOrEqual(6);

    const envPath = path.join(tempDir, '.env.canary');
    fs.writeFileSync(
      envPath,
      [
        `DB_PASSWORD="${canaries[0]}@broken/uri"`,
        `DATABASE_URL="mysql://admin:${canaries[1]}@localhost:3306/wedding"`,
        `ADMIN_PASSWORD="${canaries[2]}"`,
        `GUEST_PASSCODE="${canaries[3]}"`,
        `GUEST_SESSION_SECRET="${canaries[3]}"`,
        `STRIPE_SECRET_KEY="${canaries[4]}"`,
        `STRIPE_WEBHOOK_SECRET="invalid_${canaries[5]}"`,
        `CRON_SECRET="${canaries[6]}"`,
      ].join('\n'),
      'utf8'
    );

    const cliRes = runPreflightCli([envPath], tempDir);
    expect(cliRes.exitCode).toBe(1);

    const combinedOutput = `${cliRes.stdout}\n${cliRes.stderr}\n${JSON.stringify(issues)}`;
    for (const canary of canaries) {
      expect(combinedOutput).not.toContain(canary);
    }
    expect(combinedOutput).not.toContain('c2FsdA==');
    expect(combinedOutput).not.toContain('AAAAAAAAAAAAAAAAAAAAAA==');
  });

  it('rejects Cloudflare R2 S3_REGION=auto without S3_ENDPOINT and private *.r2.cloudflarestorage.com endpoints without S3_PUBLIC_URL without leaking account IDs', () => {
    const validHash = generateValidAdminScryptHash();
    const canaryAccountId = 'CANARY_R2_ACCOUNT_987654';

    const missingEndpointEntries = parseDotenvContent([
      'DB_PASSWORD=a9f3e71b24c80d6512ab98cd34ef56789012abcd3456ef78',
      `ADMIN_PASSWORD="${validHash}"`,
      'GUEST_PASSCODE="autumn-orchard-celebration-2027"',
      'GUEST_SESSION_SECRET="8f4a2e9c1d7b3a6f0e5c8d2a9b4f7e1c3d6a8b0e2f4c6d8a1b3e5f7a9c0d2e4f"',
      'S3_BUCKET=wedding-assets',
      'S3_REGION=auto',
      'S3_ACCESS_KEY_ID=r2-access-key',
      'S3_SECRET_ACCESS_KEY=r2-secret-key',
    ].join('\n'));

    const missingEndpointRes = validateOperatorEnv(missingEndpointEntries, {
      target: 'compose',
      composeContent: liveComposeRaw,
    });
    expect(missingEndpointRes.issues).toEqual([
      expect.objectContaining({
        key: 'S3_ENDPOINT',
        rule: 'missing-r2-s3-endpoint',
      }),
    ]);

    const missingPublicUrlEntries = parseDotenvContent([
      'DB_PASSWORD=a9f3e71b24c80d6512ab98cd34ef56789012abcd3456ef78',
      `ADMIN_PASSWORD="${validHash}"`,
      'GUEST_PASSCODE="autumn-orchard-celebration-2027"',
      'GUEST_SESSION_SECRET="8f4a2e9c1d7b3a6f0e5c8d2a9b4f7e1c3d6a8b0e2f4c6d8a1b3e5f7a9c0d2e4f"',
      'S3_BUCKET=wedding-assets',
      'S3_REGION=auto',
      'S3_ACCESS_KEY_ID=r2-access-key',
      'S3_SECRET_ACCESS_KEY=r2-secret-key',
      `S3_ENDPOINT=https://${canaryAccountId}.r2.cloudflarestorage.com`,
    ].join('\n'));

    const missingPublicUrlRes = validateOperatorEnv(missingPublicUrlEntries, {
      target: 'compose',
      composeContent: liveComposeRaw,
    });
    expect(missingPublicUrlRes.issues).toEqual([
      expect.objectContaining({
        key: 'S3_PUBLIC_URL',
        rule: 'missing-r2-s3-public-url',
      }),
    ]);
    expect(JSON.stringify(missingPublicUrlRes.issues)).not.toContain(canaryAccountId);

    const validR2Entries = parseDotenvContent([
      'DB_PASSWORD=a9f3e71b24c80d6512ab98cd34ef56789012abcd3456ef78',
      `ADMIN_PASSWORD="${validHash}"`,
      'GUEST_PASSCODE="autumn-orchard-celebration-2027"',
      'GUEST_SESSION_SECRET="8f4a2e9c1d7b3a6f0e5c8d2a9b4f7e1c3d6a8b0e2f4c6d8a1b3e5f7a9c0d2e4f"',
      'S3_BUCKET=wedding-assets',
      'S3_REGION=auto',
      'S3_ACCESS_KEY_ID=r2-access-key',
      'S3_SECRET_ACCESS_KEY=r2-secret-key',
      `S3_ENDPOINT=https://${canaryAccountId}.r2.cloudflarestorage.com`,
      'S3_PUBLIC_URL=https://assets.wedding.example.com',
    ].join('\n'));

    const validR2Res = validateOperatorEnv(validR2Entries, {
      target: 'compose',
      composeContent: liveComposeRaw,
    });
    expect(validR2Res.issues).toEqual([]);
  });

  it('handles --help and missing .env files cleanly', () => {
    const helpRes = runPreflightCli(['--help'], tempDir);
    expect(helpRes.exitCode).toBe(0);
    expect(helpRes.stdout).toContain('Usage: npx tsx scripts/preflight-env.ts');

    const missingRes = runPreflightCli(['--env-file', 'does-not-exist.env'], tempDir);
    expect(missingRes.exitCode).toBe(1);
    expect(missingRes.stderr).toContain('[ENV_FILE]');
  });
});
