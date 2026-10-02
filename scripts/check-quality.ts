import { execSync } from 'child_process';

interface Step {
  name: string;
  command: string;
}

const steps: Step[] = [
  { name: 'Verify Environment Documentation', command: 'npx tsx scripts/verify-env-docs.ts' },
  { name: 'Check Personal/Template Identifier Isolation', command: 'npx tsx scripts/check-personal-identifiers.ts' },
  { name: 'Check Documentation Relative Links', command: 'npx tsx scripts/check-doc-links.ts' },
  { name: 'Validate Prisma Schema', command: 'npx tsx scripts/check-prisma-schema.ts' },
  { name: 'TypeScript Typecheck', command: 'npm run typecheck' },
  { name: 'ESLint Code Linting', command: 'npm run lint' },
  { name: 'Knip Unused Export Analysis', command: 'npm run lint:unused' },
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
      console.error(`\n❌ [${i + 1}/${total}] ${step.name} FAILED!`);
      console.error(`\nCommand: "${step.command}"\n`);
      console.error(`
================================================================================
ACTIONABLE REMEDIATION:
--------------------------------------------------------------------------------
The quality check step "${step.name}" failed.
Run '${step.command}' locally to view full details and fix any issues before pushing.
================================================================================
`);
      process.exit(1);
    }
  }

  console.log(`\n🎉 All ${passed}/${total} quality check gates passed successfully!`);
  process.exit(0);
}

main();
