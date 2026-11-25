import { execSync, spawnSync } from 'child_process';

export const DEFAULT_DOC_FILES = [
  'public/openapi.json',
  'ARCHITECTURE.md',
  'FEATURE_MODULES.md',
];

export interface DocSyncOptions {
  cwd?: string;
  files?: string[];
  generateDocs?: () => void | string[];
  skipGeneration?: boolean;
}

export interface DocSyncResult {
  success: boolean;
  driftedFiles: string[];
  error?: string;
}

const DRIFT_LINE_REGEX = /^Drift detected in (.+)$/gm;

function extractReportedDriftFiles(output: string): string[] {
  const reported: string[] = [];
  let match: RegExpExecArray | null;
  DRIFT_LINE_REGEX.lastIndex = 0;
  while ((match = DRIFT_LINE_REGEX.exec(output)) !== null) {
    const file = match[1].trim();
    if (file && !reported.includes(file)) {
      reported.push(file);
    }
  }
  return reported;
}

/**
 * Checks git status strictly for the designated documentation files.
 * Restricting to specific files ensures uncommitted non-documentation changes
 * in the working tree do not trigger false positive drift detections.
 */
export function checkDocDrift(
  files: string[] = DEFAULT_DOC_FILES,
  cwd: string = process.cwd()
): string[] {
  try {
    const filesArg = files.map(f => `"${f}"`).join(' ');
    const output = execSync(`git status --porcelain -- ${filesArg}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (!output.trim()) {
      return [];
    }

    const driftedFiles: string[] = [];
    const seen = new Set<string>();
    const lines = output.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      // In porcelain v1 ('XY path'), Y === ' ' means the working tree matches the staged index
      // after doc generation ran, so staged updates/additions are in sync unless deleted ('D ').
      if (line.length >= 2 && line[1] === ' ' && line[0] !== 'D') continue;
      // git status --porcelain formats: 'XY <filename>' or 'XY <old> -> <new>'
      // Strip porcelain 1-2 character status indicators followed by whitespace
      const pathPart = line.replace(/^[ ?MADRCU!]{1,2}\s+/, '').trim();
      const targetFile = pathPart.includes('->')
        ? pathPart.split('->')[1].trim()
        : pathPart;
      if (!seen.has(targetFile)) {
        seen.add(targetFile);
        driftedFiles.push(targetFile);
      }
    }
    return driftedFiles;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to check git status for doc drift: ${errorMsg}`);
  }
}

const PARALLEL_DOC_CHECK_COORDINATOR = `
const { spawn } = require('child_process');
const commands = JSON.parse(process.argv[1]);
const isWin = process.platform === 'win32';
Promise.all(
  commands.map(
    (cmd) =>
      new Promise((resolve) => {
        const stdoutChunks = [];
        const stderrChunks = [];
        let settled = false;
        const child = spawn('npx', cmd.args, {
          cwd: process.cwd(),
          env: process.env,
          shell: isWin,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (child.stdout) {
          child.stdout.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
        }
        if (child.stderr) {
          child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
        }
        child.on('error', (err) => {
          if (settled) return;
          settled = true;
          resolve({
            status: 1,
            stdout: Buffer.concat(stdoutChunks).toString('utf8'),
            stderr: Buffer.concat(stderrChunks).toString('utf8'),
            errorMessage: err && err.message ? err.message : String(err),
          });
        });
        child.on('close', (code) => {
          if (settled) return;
          settled = true;
          resolve({
            status: code,
            stdout: Buffer.concat(stdoutChunks).toString('utf8'),
            stderr: Buffer.concat(stderrChunks).toString('utf8'),
            errorMessage: null,
          });
        });
      })
  )
).then((results) => {
  process.stdout.write(JSON.stringify(results));
});
`;

interface ParallelCheckSpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
  errorMessage: string | null;
}

/**
 * Executes the OpenAPI schema and architectural documentation generators in parallel read-only --check mode,
 * returning any drifted documentation paths without modifying files on disk.
 */
export function runDocGeneration(
  cwd: string = process.cwd(),
  files: string[] = DEFAULT_DOC_FILES
): string[] {
  const driftedSet = new Set<string>();
  const checkCommands: Array<{ args: string[]; label: string }> = [
    {
      args: ['tsx', 'scripts/generate-openapi.ts', '--check'],
      label: 'scripts/generate-openapi.ts --check',
    },
    {
      args: ['tsx', 'scripts/generate-docs.ts', '--skip-openapi', '--check'],
      label: 'scripts/generate-docs.ts --skip-openapi --check',
    },
  ];

  const coordinatorRes = spawnSync(
    process.execPath,
    ['-e', PARALLEL_DOC_CHECK_COORDINATOR, JSON.stringify(checkCommands)],
    {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }
  );

  if (coordinatorRes.error) {
    throw coordinatorRes.error;
  }
  if (coordinatorRes.status !== 0 || !coordinatorRes.stdout) {
    const detail = (
      coordinatorRes.stderr ||
      coordinatorRes.stdout ||
      `Parallel doc check coordinator exited with code ${coordinatorRes.status}`
    ).trim();
    throw new Error(detail);
  }

  const results = JSON.parse(coordinatorRes.stdout) as ParallelCheckSpawnResult[];

  for (let i = 0; i < checkCommands.length; i++) {
    const cmd = checkCommands[i];
    const res = results[i];

    if (res.stdout?.trim()) {
      console.log(res.stdout.trim());
    }

    if (res.errorMessage) {
      throw new Error(res.errorMessage);
    }

    if (res.status !== 0) {
      const combined = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
      const reported = extractReportedDriftFiles(combined);
      if (reported.length > 0) {
        for (const drifted of reported) {
          driftedSet.add(drifted);
        }
      } else {
        const detail = (res.stderr || res.stdout || `${cmd.label} exited with code ${res.status}`).trim();
        throw new Error(detail);
      }
    }
  }

  const allowedFiles = new Set(files);
  const orderedDrifted: string[] = [];
  for (const file of files) {
    if (driftedSet.has(file)) {
      orderedDrifted.push(file);
    }
  }
  for (const file of driftedSet) {
    if (allowedFiles.has(file) && !orderedDrifted.includes(file)) {
      orderedDrifted.push(file);
    }
  }
  return orderedDrifted;
}

/**
 * Verifies whether generated documentation matches files on disk without mutating tracked files.
 */
export function verifyDocSync(options: DocSyncOptions = {}): DocSyncResult {
  const cwd = options.cwd || process.cwd();
  const files = options.files || DEFAULT_DOC_FILES;

  if (options.skipGeneration) {
    try {
      const driftedFiles = checkDocDrift(files, cwd);
      return {
        success: driftedFiles.length === 0,
        driftedFiles,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        driftedFiles: [],
        error: `Drift inspection failed: ${errorMsg}`,
      };
    }
  }

  try {
    if (options.generateDocs) {
      const customResult = options.generateDocs();
      if (Array.isArray(customResult)) {
        return {
          success: customResult.length === 0,
          driftedFiles: customResult,
        };
      }
      const driftedFiles = checkDocDrift(files, cwd);
      return {
        success: driftedFiles.length === 0,
        driftedFiles,
      };
    }

    const driftedFiles = runDocGeneration(cwd, files);
    return {
      success: driftedFiles.length === 0,
      driftedFiles,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      driftedFiles: [],
      error: `Documentation generation failed: ${errorMsg}`,
    };
  }
}

/**
 * CLI runner for verify-doc-sync.
 */
export function main(options?: DocSyncOptions): void {
  console.log('🔍 Checking documentation and architecture synchronization...\n');

  const result = verifyDocSync(options);

  if (result.error) {
    console.error('\n❌ Documentation Generation Failed!');
    console.error(`${result.error}\n`);
    console.error(`
================================================================================
ACTIONABLE REMEDIATION:
--------------------------------------------------------------------------------
The documentation generation scripts failed to execute properly.
Check route schemas and error logs above, fix any syntax or schema issues, and retry:
  npm run docs:sync
================================================================================
`);
    process.exit(1);
  }

  if (!result.success) {
    console.error('\n❌ Documentation Drift Detected!');
    console.error('The committed documentation files do not match current codebase schemas:\n');
    for (const file of result.driftedFiles) {
      console.error(`  - ${file}`);
    }
    console.error(`
================================================================================
ACTIONABLE REMEDIATION:
--------------------------------------------------------------------------------
The documentation is out of sync with recent codebase changes.
Run the following commands locally and commit the generated files:

  npm run docs:sync
  git add ${result.driftedFiles.join(' ')}
  git commit -m "docs: sync documentation with codebase"
================================================================================
`);
    process.exit(1);
  }

  console.log(`✅ Documentation is in sync! (No drift detected in ${DEFAULT_DOC_FILES.join(', ')})`);
  process.exit(0);
}

const isDirectCall =
  process.argv[1] &&
  (process.argv[1].endsWith('verify-doc-sync.ts') ||
    process.argv[1].endsWith('verify-doc-sync.js'));

if (isDirectCall) {
  main();
}
