import { execSync } from 'child_process';

function main() {
  console.log('🔍 Validating Prisma schema and generating Prisma Client...');
  try {
    const validateOutput = execSync('npx prisma validate', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(validateOutput.trim());
    const generateOutput = execSync('npx prisma generate', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(generateOutput.trim());
    console.log('✅ Prisma schema validation and client generation passed!');
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Prisma schema validation failed:\n');
    if (error.stdout) console.error(error.stdout.toString());
    if (error.stderr) console.error(error.stderr.toString());

    console.error(`
================================================================================
ACTIONABLE REMEDIATION:
--------------------------------------------------------------------------------
1. Inspect prisma/schema.prisma for syntax errors, missing field mappings,
   or invalid type declarations.
2. Run 'npx prisma validate' locally to identify exact errors.
3. Once corrected, run 'npm run prisma:generate' to update Prisma Client.
================================================================================
`);
    process.exit(1);
  }
}

main();
