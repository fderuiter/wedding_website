import fs from 'fs';
import path from 'path';

const ROOT_DIR = process.cwd();

function main() {
  console.log('🔍 Checking standalone & container portability configuration...');

  const errors: string[] = [];

  // Check Dockerfile
  const dockerfilePath = path.join(ROOT_DIR, 'Dockerfile');
  if (!fs.existsSync(dockerfilePath)) {
    errors.push('Dockerfile is missing from repository root.');
  }

  // Check docker-entrypoint.sh
  const entrypointPath = path.join(ROOT_DIR, 'docker-entrypoint.sh');
  if (!fs.existsSync(entrypointPath)) {
    errors.push('docker-entrypoint.sh is missing from repository root.');
  }

  // Check next.config.ts for output: 'standalone'
  const nextConfigPath = path.join(ROOT_DIR, 'next.config.ts');
  if (fs.existsSync(nextConfigPath)) {
    const configContent = fs.readFileSync(nextConfigPath, 'utf8');
    if (!configContent.includes("output: 'standalone'") && !configContent.includes('output: "standalone"')) {
      errors.push("next.config.ts must specify output: 'standalone' for provider-neutral deployment.");
    }
  } else {
    errors.push('next.config.ts is missing.');
  }

  // Check if build was executed and generated standalone directory
  const standaloneDir = path.join(ROOT_DIR, '.next', 'standalone');
  if (fs.existsSync(path.join(ROOT_DIR, '.next'))) {
    if (!fs.existsSync(standaloneDir)) {
      errors.push('.next directory exists but .next/standalone was not generated. Ensure Next.js build produces standalone output.');
    } else {
      const serverJs = path.join(standaloneDir, 'server.js');
      if (!fs.existsSync(serverJs)) {
        errors.push('.next/standalone/server.js is missing.');
      }
    }
  }

  if (errors.length > 0) {
    console.error('\n❌ Standalone & container portability check failed:\n');
    errors.forEach((err, idx) => console.error(`  [${idx + 1}] ${err}`));

    console.error(`
================================================================================
ACTIONABLE REMEDIATION:
--------------------------------------------------------------------------------
1. Ensure next.config.ts contains output: 'standalone'.
2. Ensure Dockerfile and docker-entrypoint.sh exist in the repository root.
3. Run 'npm run build' to generate the standalone build bundle at .next/standalone.
================================================================================
`);
    process.exit(1);
  }

  console.log('✅ Standalone & container portability check passed!');
  process.exit(0);
}

main();
