import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export interface Step {
  name: string;
  command: string;
  script?: string;
  remediation?: string;
}

export interface QualityRunOptions {
  cwd?: string;
  stepsToRun?: Step[];
  staticOnly?: boolean;
  prePush?: boolean;
  skipDocSync?: boolean;
  skipActionPins?: boolean;
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

export function cleanupStaticExportOutDir(cwd: string = process.cwd()): void {
  const outDir = path.join(cwd, 'out');
  if (fs.existsSync(outDir)) {
    try {
      fs.rmSync(outDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

export const staticSteps: Step[] = [
  {
    name: 'Verify Environment Documentation',
    script: 'check:env-docs',
    command: 'npx tsx scripts/verify-env-docs.ts',
  },
  {
    name: 'Verify Deployment Runbooks',
    script: 'check:runbooks',
    command: 'npx tsx scripts/verify-deployment-runbooks.ts',
    remediation:
      'Deployment runbook, upgrade guide, or release changelog contract drift detected.\nRun "npm run check:runbooks" locally and reconcile "DEPLOYMENT.md", "docs/deployment/*.md", "docs/runtime-contract.md", "docs/upgrading.md", and "CHANGELOG.md" with live migrations, "src/env.ts", "src/lib/modules.ts", "Dockerfile", and "docker-compose.yml".',
  },
  {
    name: 'Verify Setup & Contributor Guides Contract',
    script: 'check:setup-guides',
    command: 'npm run check:setup-guides',
    remediation:
      'Setup, contributor, or testing guide contract drift detected.\nRun "npm run check:setup-guides" locally and reconcile ".env.example", "README.md", "docs/developer-setup.md", ".github/CONTRIBUTING.md", ".github/TESTING.md", and "AGENTS.md" with live repository configurations.',
  },
  {
    name: 'Check Personal/Template Identifier Isolation',
    script: 'check:identifiers',
    command: 'npx tsx scripts/check-personal-identifiers.ts',
  },
  {
    name: 'Check Third-Party Action Pin Commit SHAs',
    script: 'check:action-pins',
    command: 'npm run check:action-pins',
  },
  {
    name: 'Check Container Digest Pins & Standalone Portability',
    script: 'check:standalone',
    command: 'npm run check:standalone',
  },
  {
    name: 'Check Documentation Relative Links',
    script: 'check:links',
    command: 'npx tsx scripts/check-doc-links.ts',
  },
  {
    name: 'Verify Specification Route & Symbol Contracts',
    script: 'check:spec-contracts',
    command: 'npm run check:spec-contracts',
    remediation:
      'Specification route, method, ENTITY_KEY, or symbol contract drift detected.\nRun "npm run check:spec-contracts" locally and reconcile cited "/api/*" endpoints, HTTP methods, dynamic admin entity keys, and TypeScript symbols in architectural Markdown files with live source files.',
  },
  {
    name: 'Validate Prisma Schema',
    script: 'check:prisma',
    command: 'npx tsx scripts/check-prisma-schema.ts',
  },
  {
    name: 'Verify Migration Compatibility',
    script: 'lint:migrations',
    command: 'npm run lint:migrations',
  },
  {
    name: 'Verify Documentation Synchronization',
    script: 'check:doc-sync',
    command: 'npm run check:doc-sync',
    remediation:
      'Documentation drift detected or generation failed.\nRun "npx tsx scripts/generate-openapi.ts" and "npx tsx scripts/generate-docs.ts" to regenerate documentation, then commit changes to "public/openapi.json", "ARCHITECTURE.md", and "FEATURE_MODULES.md".',
  },
];

export const prePushSteps: Step[] = [
  ...staticSteps.map((step) =>
    step.script === 'check:standalone'
      ? {
        ...step,
        command: 'npm run check:standalone -- --static-only',
      }
      : step
  ),
  { name: 'TypeScript Typecheck', script: 'typecheck', command: 'npm run typecheck' },
  { name: 'ESLint Code Linting', script: 'lint', command: 'npm run lint' },
  { name: 'Knip Unused Export Analysis', script: 'lint:unused', command: 'npm run lint:unused' },
  {
    name: 'Security Dependency Audit',
    script: 'check:audit',
    command: 'npm run check:audit',
    remediation:
      'Moderate, high, or critical npm security advisories were detected in package-lock.json or docker/prisma-cli/package-lock.json.\nRun "npm run check:audit" locally (and inspect "npm audit --json" and "npm --prefix docker/prisma-cli audit --json") to upgrade or apply scoped range overrides for affected packages.',
  },
];

export const steps: Step[] = [
  ...staticSteps,
  { name: 'TypeScript Typecheck', script: 'typecheck', command: 'npm run typecheck' },
  { name: 'ESLint Code Linting', script: 'lint', command: 'npm run lint' },
  { name: 'Knip Unused Export Analysis', script: 'lint:unused', command: 'npm run lint:unused' },
  {
    name: 'Security Dependency Audit',
    script: 'check:audit',
    command: 'npm run check:audit',
    remediation:
      'Moderate, high, or critical npm security advisories were detected in package-lock.json or docker/prisma-cli/package-lock.json.\nRun "npm run check:audit" locally (and inspect "npm audit --json" and "npm --prefix docker/prisma-cli audit --json") to upgrade or apply scoped range overrides for affected packages.',
  },
  {
    name: 'Build Static Documentation Portal',
    command: 'npm run docs:build',
    remediation:
      'VitePress documentation portal compilation failed.\nRun "npm run docs:build" (or "npm run docs:dev") locally to inspect VitePress build errors, check for markdown/vue syntax issues, or broken documentation links.',
  },
  {
    name: 'Build Static Storybook Showcase',
    command: 'npm run build-storybook',
    remediation:
      'Storybook static showcase compilation failed.\nRun "npm run build-storybook" (or "npm run storybook") locally to inspect Webpack build errors, broken story imports in "src/**/*.stories.tsx", or mock handler mismatches in ".storybook/preview.tsx" and "src/mocks/handlers.ts".',
  },
  {
    name: 'Build Static HTML Showcase',
    command: 'npm run build:export',
    remediation: 'Static HTML showcase export failed.\nRun "npm run build:export" locally to inspect Next.js static prerender errors. Ensure public/showcase routes do not import "@/app/api/*", guard dynamic server APIs ("cookies()", "headers()") and Prisma queries when "STATIC_EXPORT" is enabled, and define "generateStaticParams()" on dynamic App Router segments.',
  },
  { name: 'Unit & Integration Tests', command: 'npm run test:cov' },
];

export function resolveQualitySteps(options: QualityRunOptions = {}): Step[] {
  const baseSteps =
    options.stepsToRun ||
    (options.staticOnly ? staticSteps : options.prePush ? prePushSteps : steps);
  return baseSteps.filter((step) => {
    if (
      options.skipDocSync &&
      (step.script === 'check:doc-sync' || step.command === 'npm run check:doc-sync')
    ) {
      return false;
    }
    if (
      options.skipActionPins &&
      (step.script === 'check:action-pins' || step.command === 'npm run check:action-pins')
    ) {
      return false;
    }
    return true;
  });
}

export function main(options: QualityRunOptions = {}): void {
  const cwd = options.cwd || process.cwd();
  const activeSteps = resolveQualitySteps(options);
  const runCmd =
    options.execCommand ||
    ((command: string, workDir: string) => {
      execSync(command, { cwd: workDir, stdio: 'inherit' });
    });

  const suiteLabel = options.staticOnly
    ? 'static verification'
    : options.prePush
      ? 'pre-push quality'
      : 'local quality';
  console.log(`🚀 Running all ${suiteLabel} checks...\n`);

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
      if (step.command.includes('build:export')) {
        cleanupStaticExportOutDir(cwd);
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
  const cliArgs = process.argv.slice(2);
  main({
    staticOnly: cliArgs.includes('--static'),
    prePush: cliArgs.includes('--pre-push'),
    skipDocSync: cliArgs.includes('--skip-doc-sync'),
    skipActionPins: cliArgs.includes('--skip-action-pins'),
  });
}
