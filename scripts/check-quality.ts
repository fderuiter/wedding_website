import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export interface Step {
  name: string;
  command: string;
  remediation?: string;
}

export interface QualityRunOptions {
  cwd?: string;
  stepsToRun?: Step[];
  execCommand?: (command: string, cwd: string) => void;
}

export function cleanupPortalTempDirs(cwd: string = process.cwd()): void {
  const tempDir = path.join(cwd, 'docs-portal', '.vitepress', '.temp');
  if (fs.existsSync(tempDir)) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

export function cleanupStorybookStaticDir(cwd: string = process.cwd()): void {
  const staticDir = path.join(cwd, 'storybook-static');
  if (fs.existsSync(staticDir)) {
    try {
      fs.rmSync(staticDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

export const steps: Step[] = [
  { name: 'Verify Environment Documentation', command: 'npx tsx scripts/verify-env-docs.ts' },
  {
    name: 'Verify Deployment Runbooks',
    command: 'npx tsx scripts/verify-deployment-runbooks.ts',
    remediation: 'Deployment runbook, upgrade guide, or release changelog contract drift detected.\nRun "npm run check:runbooks" locally and reconcile "DEPLOYMENT.md", "docs/deployment/*.md", "docs/runtime-contract.md", "docs/upgrading.md", and "CHANGELOG.md" with live migrations, "src/env.ts", "src/lib/modules.ts", "Dockerfile", and "docker-compose.yml".',
  },
  { name: 'Check Personal/Template Identifier Isolation', command: 'npx tsx scripts/check-personal-identifiers.ts' },
  { name: 'Check Third-Party Action Pin Commit SHAs', command: 'npm run check:action-pins' },
  { name: 'Check Documentation Relative Links', command: 'npx tsx scripts/check-doc-links.ts' },
  {
    name: 'Verify Specification Route & Symbol Contracts',
    command: 'npm run check:spec-contracts',
    remediation: 'Specification route, method, ENTITY_KEY, or symbol contract drift detected.\nRun "npm run check:spec-contracts" locally and reconcile cited "/api/*" endpoints, HTTP methods, dynamic admin entity keys, and TypeScript symbols in architectural Markdown files with live source files.',
  },
  { name: 'Validate Prisma Schema', command: 'npx tsx scripts/check-prisma-schema.ts' },
  { name: 'TypeScript Typecheck', command: 'npm run typecheck' },
  { name: 'ESLint Code Linting', command: 'npm run lint' },
  { name: 'Knip Unused Export Analysis', command: 'npm run lint:unused' },
  { name: 'Verify Migration Compatibility', command: 'npm run lint:migrations' },
  {
    name: 'Verify Documentation Synchronization',
    command: 'npm run check:doc-sync',
    remediation: 'Documentation drift detected or generation failed.\nRun "npx tsx scripts/generate-openapi.ts" and "npx tsx scripts/generate-docs.ts" to regenerate documentation, then commit changes to "public/openapi.json", "ARCHITECTURE.md", and "FEATURE_MODULES.md".',
  },
  {
    name: 'Verify Setup & Contributor Guides Contract',
    command: 'npm run check:setup-guides',
    remediation: 'Setup, contributor, or testing guide contract drift detected.\nRun "npm run check:setup-guides" locally and reconcile ".env.example", "README.md", "docs/developer-setup.md", ".github/CONTRIBUTING.md", ".github/TESTING.md", and "AGENTS.md" with live repository configurations.',
  },
  {
    name: 'Build Static Documentation Portal',
    command: 'npm run docs:build',
    remediation: 'VitePress documentation portal compilation failed.\nRun "npm run docs:build" (or "npm run docs:dev") locally to inspect VitePress build errors, check for markdown/vue syntax issues, or broken documentation links.',
  },
  {
    name: 'Build Static Storybook Showcase',
    command: 'npm run build-storybook',
    remediation: 'Storybook static showcase compilation failed.\nRun "npm run build-storybook" (or "npm run storybook") locally to inspect Webpack build errors, broken story imports in "src/**/*.stories.tsx", or mock handler mismatches in ".storybook/preview.tsx" and "src/mocks/handlers.ts".',
  },
  { name: 'Unit & Integration Tests', command: 'npm run test:cov' },
];

export function main(options: QualityRunOptions = {}): void {
  const cwd = options.cwd || process.cwd();
  const activeSteps = options.stepsToRun || steps;
  const runCmd =
    options.execCommand ||
    ((command: string, workDir: string) => {
      execSync(command, { cwd: workDir, stdio: 'inherit' });
    });

  console.log('🚀 Running all local quality checks...\n');

  let passed = 0;
  const total = activeSteps.length;

  for (let i = 0; i < activeSteps.length; i++) {
    const step = activeSteps[i];
    console.log(`[${i + 1}/${total}] ⏳ ${step.name}...`);
    try {
      runCmd(step.command, cwd);
      console.log(`[${i + 1}/${total}] ✅ ${step.name} passed!\n`);
      passed++;
    } catch {
      if (step.command.includes('docs:build')) {
        cleanupPortalTempDirs(cwd);
      }
      if (step.command.includes('build-storybook')) {
        cleanupStorybookStaticDir(cwd);
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

const isDirectCall =
  typeof process.argv[1] === 'string' &&
  (path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)) ||
    process.argv[1].endsWith('check-quality.ts') ||
    process.argv[1].endsWith('check-quality.js'));

if (isDirectCall) {
  main();
}
