import path from 'path';
import fs from 'fs';
import { runSASTScan } from '../../scripts/sast-scan';

describe('SAST Scan', () => {
  const tempDir = path.join(process.cwd(), '.tmp-sast-test');

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
    const findings = runSASTScan(tempDir);
    expect(findings).toHaveLength(0);
  });

  it('detects eval code injection', () => {
    const evalFile = path.join(tempDir, 'vulnerable.ts');
    fs.writeFileSync(evalFile, 'const code = "console.log(1)";\neval(code);');
    const findings = runSASTScan(tempDir);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].rule).toContain('SAST-001');
  });

  it('detects unsafe raw SQL query', () => {
    const sqlFile = path.join(tempDir, 'query.ts');
    fs.writeFileSync(sqlFile, 'const userInput = "1 OR 1=1";\nprisma.$queryRawUnsafe(`SELECT * FROM users WHERE id = ${userInput}`);');
    const findings = runSASTScan(tempDir);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].rule).toContain('SAST-002');
  });
});
