import { execSync } from 'child_process';

export const DEFAULT_DOC_FILES = [
  'public/openapi.json',
  'ARCHITECTURE.md',
];

export interface DocSyncOptions {
  cwd?: string;
  files?: string[];
  generateDocs?: () => void;
  skipGeneration?: boolean;
}

export interface DocSyncResult {
  success: boolean;
  driftedFiles: string[];
  error?: string;
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
    const lines = output.split('\n');
    for (const rawLine of lines) {
      if (!rawLine.trim()) continue;
      // git status --porcelain formats: 'XY <filename>' or 'XY <old> -> <new>'
      // Strip porcelain 1-2 character status indicators followed by whitespace
      const pathPart = rawLine.replace(/^[ ?MADRCU!]{1,2}\s+/, '').trim();
      const targetFile = pathPart.includes('->')
        ? pathPart.split('->')[1].trim()
        : pathPart;
      driftedFiles.push(targetFile);
    }
    return driftedFiles;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to check git status for doc drift: ${errorMsg}`);
  }
}

/**
 * Executes the OpenAPI schema generation and architectural documentation generation scripts.
 */
export function runDocGeneration(cwd: string = process.cwd()): void {
  execSync('npx tsx scripts/generate-openapi.ts', {
    cwd,
    stdio: 'inherit',
  });
  execSync('npx tsx scripts/generate-docs.ts', {
    cwd,
    stdio: 'inherit',
  });
}

/**
 * Runs documentation generation and verifies whether generated docs have drifted from git.
 */
export function verifyDocSync(options: DocSyncOptions = {}): DocSyncResult {
  const cwd = options.cwd || process.cwd();
  const files = options.files || DEFAULT_DOC_FILES;

  if (!options.skipGeneration) {
    try {
      if (options.generateDocs) {
        options.generateDocs();
      } else {
        runDocGeneration(cwd);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        driftedFiles: [],
        error: `Documentation generation failed: ${errorMsg}`,
      };
    }
  }

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
  npx tsx scripts/generate-openapi.ts
  npx tsx scripts/generate-docs.ts
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

  npx tsx scripts/generate-openapi.ts
  npx tsx scripts/generate-docs.ts
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
