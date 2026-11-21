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
  } else {
    const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf8');
    if (!/COPY\s+--from=builder\b[^\n]*prisma\.config\.ts/.test(dockerfileContent)) {
      errors.push('Dockerfile runner stage must copy prisma.config.ts from builder for Prisma 7 migrations.');
    }
    if (/COPY\s+--from=builder\b[^\n]*\/app\/node_modules\s+\.\/node_modules/.test(dockerfileContent)) {
      errors.push('Dockerfile runner stage must not overwrite standalone ./node_modules with builder /app/node_modules.');
    }
    if (!/COPY\s+--from=prisma-cli\b[^\n]*\/opt\/prisma-cli/.test(dockerfileContent)) {
      errors.push('Dockerfile runner stage must copy the isolated Prisma CLI directory (/opt/prisma-cli).');
    }
    if (/COPY\s+--from=(?:builder|prisma-cli)\s+--chown=nextjs:nodejs\b/.test(dockerfileContent)) {
      errors.push('Dockerfile runner stage must keep static /app code, node_modules, prisma, scripts, and /opt/prisma-cli owned by root:root.');
    }
    if (!/\btini\b/.test(dockerfileContent) || !/ENTRYPOINT\s+\[\s*"\/usr\/bin\/tini"/.test(dockerfileContent)) {
      errors.push('Dockerfile must install tini and invoke /usr/bin/tini as PID 1 ENTRYPOINT.');
    }
    if (!/addgroup\s+--system\s+--gid\s+1001\s+nodejs/.test(dockerfileContent) || !/--ingroup\s+nodejs\s+nextjs/.test(dockerfileContent)) {
      errors.push('Dockerfile must assign runtime user nextjs to primary group nodejs (UID/GID 1001).');
    }
    if (!/chmod\s+a-s/.test(dockerfileContent)) {
      errors.push('Dockerfile must strip setuid and setgid bits across the container filesystem.');
    }
    if (!/^HEALTHCHECK\b[\s\S]*?\/api\/live\b/m.test(dockerfileContent)) {
      errors.push('Dockerfile must define a HEALTHCHECK targeting /api/live.');
    }
    if (!/ln\s+-sf\s+\/usr\/local\/bin\/prisma\s+\/app\/node_modules\/\.bin\/prisma/.test(dockerfileContent)) {
      errors.push('Dockerfile must link /app/node_modules/.bin/prisma to the isolated Prisma CLI wrapper.');
    }
  }

  // Check docker-entrypoint.sh
  const entrypointPath = path.join(ROOT_DIR, 'docker-entrypoint.sh');
  if (!fs.existsSync(entrypointPath)) {
    errors.push('docker-entrypoint.sh is missing from repository root.');
  } else {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    if (/\bnpx\b/.test(entrypointContent)) {
      errors.push('docker-entrypoint.sh must invoke ./node_modules/.bin/prisma offline without npx.');
    }
    if (!entrypointContent.includes('./node_modules/.bin/prisma migrate deploy')) {
      errors.push('docker-entrypoint.sh must execute ./node_modules/.bin/prisma migrate deploy when RUN_MIGRATIONS=true.');
    }
    if (!entrypointContent.includes('NPM_CONFIG_UPDATE_NOTIFIER=false')) {
      errors.push('docker-entrypoint.sh must disable npm update checks via NPM_CONFIG_UPDATE_NOTIFIER=false.');
    }
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
      if (fs.existsSync(path.join(standaloneDir, 'public', 'public'))) {
        errors.push('.next/standalone/public/public nested copy detected.');
      }
      if (fs.existsSync(path.join(standaloneDir, 'public', 'mockServiceWorker.js'))) {
        errors.push('.next/standalone/public/mockServiceWorker.js must not be bundled in standalone output.');
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
