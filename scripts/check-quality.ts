import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface Step {
  name: string;
  command: string;
  remediation?: string;
}

function cleanupPortalTempDirs(): void {
  const tempDir = path.join(process.cwd(), 'docs-portal', '.vitepress', '.temp');
  if (fs.existsSync(tempDir)) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

const steps: Step[] = [
  { name: 'Verify Environment Documentation', command: 'npx tsx scripts/verify-env-docs.ts' },
  { name: 'Check Personal/Template Identifier Isolation', command: 'npx tsx scripts/check-personal-identifiers.ts' },
  { name: 'Check Third-Party Action Pin Commit SHAs', command: 'npm run check:action-pins' },
  { name: 'Check Documentation Relative Links', command: 'npx tsx scripts/check-doc-links.ts' },
  { name: 'Validate Prisma Schema', command: 'npx tsx scripts/check-prisma-schema.ts' },
  { name: 'TypeScript Typecheck', command: 'npm run typecheck' },
  { name: 'ESLint Code Linting', command: 'npm run lint' },
  { name: 'Knip Unused Export Analysis', command: 'npm run lint:unused' },
  { name: 'Verify Migration Compatibility', command: 'npm run lint:migrations' },
  {
    name: 'Verify Documentation Synchronization',
    command: 'npm run check:doc-sync',
    remediation: 'Documentation drift detected or generation failed.\nRun "npx tsx scripts/generate-openapi.ts" and "npx tsx scripts/generate-docs.ts" to regenerate documentation, then commit changes to "public/openapi.json" and "ARCHITECTURE.md".',
  },
  {
    name: 'Build Static Documentation Portal',
    command: 'npm run docs:build',
    remediation: 'VitePress documentation portal compilation failed.\nRun "npm run docs:build" (or "npm run docs:dev") locally to inspect VitePress build errors, check for markdown/vue syntax issues, or broken documentation links.',
  },
  { name: 'Unit & Integration Tests', command: 'npm test' },
];

function main() {
  console.log('🚀 Running all local quality checks...\n');

  let passed = 0;
  const total = steps.length;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    console.log(`[${i + 1}/${total}] ⏳ ${step.name}...`);
    try {
      execSync(step.command, { stdio: 'inherit' });
      console.log(`[${i + 1}/${total}] ✅ ${step.name} passed!\n`);
      passed++;
    } catch (error: any) {
      if (step.command.includes('docs:build')) {
        cleanupPortalTempDirs();
      }
      console.error(`\n❌ [${i + 1}/${total}] ${step.name} FAILED!`);
      console.error(`\nCommand: "${step.command}"\n`);
      const remediationText = step.remediation
        ? `The quality check step "${step.name}" failed.\n\n${step.remediation}\n\nAlternatively, run '${step.command}' locally to view full details.`
        : `The quality check step "${step.name}" failed.\nRun '${step.command}' locally to view full details and fix any issues before pushing.`;
      console.error(`
================================================================================
ACTIONABLE REMEDIATION:
--------------------------------------------------------------------------------
${remediationText}
================================================================================
`);
      process.exit(1);
    }
  }

  console.log(`\n🎉 All ${passed}/${total} quality check gates passed successfully!`);
  process.exit(0);
}

main();
