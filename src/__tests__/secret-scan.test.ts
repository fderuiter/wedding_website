import path from 'path';
import fs from 'fs';
import { runSecretScan } from '../../scripts/secret-scan';

describe('Secret Scan', () => {
  const tempDir = path.join(process.cwd(), '.tmp-secret-test');

  beforeEach(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('passes on clean files', () => {
    const cleanFile = path.join(tempDir, 'clean.ts');
    fs.writeFileSync(cleanFile, 'const x = 123;\nconsole.log(x);');
    const findings = runSecretScan(tempDir);
    expect(findings).toHaveLength(0);
  });

  it('detects AWS Access Key ID', () => {
    const secretFile = path.join(tempDir, 'aws.ts');
    fs.writeFileSync(secretFile, 'const awsKey = "AKIAIOSFODNN7EXAMPLE";');
    const findings = runSecretScan(tempDir);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].rule).toBe('AWS Access Key ID');
  });

  it('detects Private Key', () => {
    const keyFile = path.join(tempDir, 'key.pem');
    fs.writeFileSync(keyFile, '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----');
    const findings = runSecretScan(tempDir);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].rule).toBe('Private Key');
  });
});
