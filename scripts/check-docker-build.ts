import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isMap, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';

interface Violation {
  filePath: string;
  lineNumber: number;
  lineContent: string;
  imageRef: string;
  reason: string;
}

interface PinnedImageOccurrence {
  filePath: string;
  lineNumber: number;
  lineContent: string;
  imageName: string;
  digest: string;
}

interface DockerfileInstruction {
  startLine: number;
  firstLineContent: string;
  text: string;
}

const ROOT_DIR = process.cwd();
const SHA256_DIGEST_REGEX = /^sha256:[a-fA-F0-9]{64}$/;

function parseLeadingMajorVersion(rawVersion: string): string | null {
  const match = rawVersion.trim().match(/^(?:[\^~>=<v\s]*)(\d+)(?:\.\d+|\.x|\b|$)/i);
  return match ? match[1] : null;
}

function normalizeImageKey(imageName: string): string {
  const trimmed = imageName.trim();
  if (trimmed.startsWith('docker.io/library/')) {
    return trimmed.slice('docker.io/library/'.length);
  }
  if (trimmed.startsWith('index.docker.io/library/')) {
    return trimmed.slice('index.docker.io/library/'.length);
  }
  if (trimmed.startsWith('docker.io/')) {
    return trimmed.slice('docker.io/'.length);
  }
  if (trimmed.startsWith('index.docker.io/')) {
    return trimmed.slice('index.docker.io/'.length);
  }
  return trimmed;
}

function normalizeImageRepository(imageName: string): string {
  const normalized = normalizeImageKey(imageName);
  const lastSlashIdx = normalized.lastIndexOf('/');
  const colonIdx = normalized.indexOf(':', lastSlashIdx + 1);
  return colonIdx === -1 ? normalized : normalized.slice(0, colonIdx);
}

function validateExternalImageRef(
  rawRef: string,
  filePath: string,
  lineNumber: number,
  lineContent: string,
  violations: Violation[],
  pinnedOccurrences: Map<string, PinnedImageOccurrence[]>
): void {
  const cleanedRef = rawRef.trim().replace(/^['"]|['"]$/g, '');
  if (!cleanedRef || cleanedRef.includes('${{')) {
    return;
  }

  const lastAtIdx = cleanedRef.lastIndexOf('@');
  if (lastAtIdx === -1) {
    violations.push({
      filePath,
      lineNumber,
      lineContent,
      imageRef: cleanedRef,
      reason: `External container image "${cleanedRef}" is missing an immutable "@sha256:<64-hex>" digest.`,
    });
    return;
  }

  const imageName = cleanedRef.slice(0, lastAtIdx).trim();
  const digest = cleanedRef.slice(lastAtIdx + 1).trim();

  if (!imageName) {
    violations.push({
      filePath,
      lineNumber,
      lineContent,
      imageRef: cleanedRef,
      reason: `External container image "${cleanedRef}" is missing an image repository name before "@".`,
    });
    return;
  }

  if (!SHA256_DIGEST_REGEX.test(digest)) {
    violations.push({
      filePath,
      lineNumber,
      lineContent,
      imageRef: cleanedRef,
      reason: `External container image "${cleanedRef}" has invalid digest "${digest}" (expected "sha256:<64-hex>").`,
    });
    return;
  }

  const repositoryKey = normalizeImageRepository(imageName);
  const existing = pinnedOccurrences.get(repositoryKey) ?? [];
  existing.push({
    filePath,
    lineNumber,
    lineContent,
    imageName,
    digest: digest.toLowerCase(),
  });
  pinnedOccurrences.set(repositoryKey, existing);
}

function parseDockerfileInstructions(content: string): DockerfileInstruction[] {
  const lines = content.split(/\r?\n/);
  const instructions: DockerfileInstruction[] = [];

  let currentParts: string[] = [];
  let startLine = 1;
  let firstLineContent = '';

  lines.forEach((rawLine, index) => {
    const trimmed = rawLine.trim();

    if (currentParts.length === 0) {
      if (!trimmed || trimmed.startsWith('#')) {
        return;
      }
      startLine = index + 1;
      firstLineContent = trimmed;
    } else if (trimmed.startsWith('#')) {
      // Comments inside backslash-continued Dockerfile instructions are ignored by BuildKit
      return;
    }

    if (trimmed.endsWith('\\')) {
      currentParts.push(trimmed.slice(0, -1).trim());
    } else {
      currentParts.push(trimmed);
      instructions.push({
        startLine,
        firstLineContent,
        text: currentParts.filter(Boolean).join(' '),
      });
      currentParts = [];
      firstLineContent = '';
    }
  });

  if (currentParts.length > 0) {
    instructions.push({
      startLine,
      firstLineContent,
      text: currentParts.filter(Boolean).join(' '),
    });
  }

  return instructions;
}

function checkDockerfileContent(
  dockerfileContent: string,
  relPath: string,
  violations: Violation[],
  pinnedOccurrences: Map<string, PinnedImageOccurrence[]>,
  expectedNodeMajor: string | null
): void {
  if (!/COPY\s+--from=builder\b[^\n]*prisma\.config\.ts/.test(dockerfileContent)) {
    violations.push({
      filePath: relPath,
      lineNumber: 1,
      lineContent: '',
      imageRef: 'prisma.config.ts',
      reason: 'Dockerfile runner stage must copy prisma.config.ts from builder for Prisma 7 migrations.',
    });
  }
  if (/COPY\s+--from=builder\b[^\n]*\/app\/node_modules\s+\.\/node_modules/.test(dockerfileContent)) {
    violations.push({
      filePath: relPath,
      lineNumber: 1,
      lineContent: '',
      imageRef: '/app/node_modules',
      reason: 'Dockerfile runner stage must not overwrite standalone ./node_modules with builder /app/node_modules.',
    });
  }
  if (!/COPY\s+--from=prisma-cli\s+\/opt\/prisma-cli\s+\/opt\/prisma-cli(?:\s|$)/m.test(dockerfileContent)) {
    violations.push({
      filePath: relPath,
      lineNumber: 1,
      lineContent: '',
      imageRef: '/opt/prisma-cli',
      reason:
        'Dockerfile runner stage must install the isolated Prisma CLI outside /app at /opt/prisma-cli (COPY --from=prisma-cli /opt/prisma-cli /opt/prisma-cli).',
    });
  }
  if (/COPY\s+--from=prisma-cli\b[^\n]*\/opt\/prisma-cli\s+(?:\.\/|\/app\b)/.test(dockerfileContent)) {
    violations.push({
      filePath: relPath,
      lineNumber: 1,
      lineContent: '',
      imageRef: '/app/prisma-cli',
      reason: 'Dockerfile runner stage must keep /opt/prisma-cli outside /app rather than copying it under /app.',
    });
  }
  if (
    !/COPY\s+--from=builder\s+\/app\/scripts\/generate-password-hash\.mjs\s+\.\/scripts\/generate-password-hash\.mjs(?:\s|$)/m.test(
      dockerfileContent
    )
  ) {
    violations.push({
      filePath: relPath,
      lineNumber: 1,
      lineContent: '',
      imageRef: 'scripts/generate-password-hash.mjs',
      reason:
        'Dockerfile runner stage must copy only /app/scripts/generate-password-hash.mjs into ./scripts/generate-password-hash.mjs.',
    });
  }
  if (/COPY\s+--from=builder\s+\/app\/scripts\/?\s+(?:\.\/scripts|\/app\/scripts)(?:\s|$)/m.test(dockerfileContent)) {
    violations.push({
      filePath: relPath,
      lineNumber: 1,
      lineContent: '',
      imageRef: '/app/scripts',
      reason:
        'Dockerfile runner stage must not copy the entire /app/scripts directory into the runtime image; copy only scripts/generate-password-hash.mjs.',
    });
  }
  if (/COPY\s+--from=(?:builder|prisma-cli)\s+--chown=nextjs:nodejs\b/.test(dockerfileContent)) {
    violations.push({
      filePath: relPath,
      lineNumber: 1,
      lineContent: '',
      imageRef: '--chown=nextjs:nodejs',
      reason:
        'Dockerfile runner stage must keep static /app code, node_modules, prisma, scripts, and /opt/prisma-cli owned by root:root.',
    });
  }
  if (!/\btini\b/.test(dockerfileContent) || !/ENTRYPOINT\s+\[\s*"\/usr\/bin\/tini"/.test(dockerfileContent)) {
    violations.push({
      filePath: relPath,
      lineNumber: 1,
      lineContent: '',
      imageRef: '/usr/bin/tini',
      reason: 'Dockerfile must install tini and invoke /usr/bin/tini as PID 1 ENTRYPOINT.',
    });
  }
  if (
    !/addgroup\s+--system\s+--gid\s+1001\s+nodejs/.test(dockerfileContent) ||
    !/--ingroup\s+nodejs\s+nextjs/.test(dockerfileContent)
  ) {
    violations.push({
      filePath: relPath,
      lineNumber: 1,
      lineContent: '',
      imageRef: 'nextjs:nodejs',
      reason: 'Dockerfile must assign runtime user nextjs to primary group nodejs (UID/GID 1001).',
    });
  }
  if (!/chmod\s+a-s/.test(dockerfileContent)) {
    violations.push({
      filePath: relPath,
      lineNumber: 1,
      lineContent: '',
      imageRef: 'chmod a-s',
      reason: 'Dockerfile must strip setuid and setgid bits across the container filesystem.',
    });
  }
  if (!/^HEALTHCHECK\b[\s\S]*?\/api\/live\b/m.test(dockerfileContent)) {
    violations.push({
      filePath: relPath,
      lineNumber: 1,
      lineContent: '',
      imageRef: 'HEALTHCHECK /api/live',
      reason: 'Dockerfile must define a HEALTHCHECK targeting /api/live.',
    });
  }
  if (!/ln\s+-sf\s+\/usr\/local\/bin\/prisma\s+\/app\/node_modules\/\.bin\/prisma/.test(dockerfileContent)) {
    violations.push({
      filePath: relPath,
      lineNumber: 1,
      lineContent: '',
      imageRef: '/app/node_modules/.bin/prisma',
      reason: 'Dockerfile must link /app/node_modules/.bin/prisma to the isolated Prisma CLI wrapper.',
    });
  }

  const instructions = parseDockerfileInstructions(dockerfileContent);
  const stageAliases = new Set<string>();
  const nodeDerivedStages = new Set<string>();
  let foundNodeBaseImage = false;
  let currentStage: string | null = null;
  let hasBaseStage = false;
  let baseStageLine = 1;
  let seenBaseGlobalNpmrc = false;
  let hasBuilderStage = false;
  let seenBuilderNpmCi = false;
  let builderNpmCiLine = 1;
  let seenBuilderBuildDocker = false;
  let hasRunnerStage = false;
  let runnerStageLine = 1;
  let runnerInheritedNode = false;
  let seenRunnerNodeBinaryCopy = false;
  const builderCopiedBeforeNpmCi: string[] = [];
  const builderCopiedAfterNpmCi = new Set<string>();

  for (const instr of instructions) {
    if (/(?:^|[\s>'"])\/etc\/npmrc(?:\s|['";&|]|$)/.test(instr.text)) {
      violations.push({
        filePath: relPath,
        lineNumber: instr.startLine,
        lineContent: instr.firstLineContent,
        imageRef: '/etc/npmrc',
        reason:
          'Dockerfile must write global npm configuration to "/usr/local/etc/npmrc" ($PREFIX/etc/npmrc) instead of "/etc/npmrc".',
      });
    }

    const fromMatch = instr.text.match(/^FROM\s+(.*)$/i);
    if (fromMatch) {
      const rest = fromMatch[1].trim();
      const parsedFrom = rest.match(/^(?:--\S+\s+)*(\S+)(?:\s+AS\s+([a-zA-Z0-9._-]+))?\s*$/i);
      if (parsedFrom) {
        const imageSpec = parsedFrom[1];
        const stageAlias = parsedFrom[2];
        const lowerImage = imageSpec.toLowerCase();
        let isNodeImage = nodeDerivedStages.has(lowerImage);

        if (lowerImage !== 'scratch' && !stageAliases.has(lowerImage) && !imageSpec.includes('${{')) {
          validateExternalImageRef(
            imageSpec,
            relPath,
            instr.startLine,
            instr.firstLineContent,
            violations,
            pinnedOccurrences
          );

          const rawRepo = imageSpec.trim().replace(/^['"]|['"]$/g, '').split('@')[0];
          const normalizedRepo = normalizeImageKey(rawRepo);
          if (normalizedRepo === 'node' || normalizedRepo.startsWith('node:')) {
            isNodeImage = true;
            foundNodeBaseImage = true;
            if (expectedNodeMajor) {
              const expectedPrefix = `node:${expectedNodeMajor}-bookworm-slim`;
              if (normalizedRepo !== expectedPrefix) {
                violations.push({
                  filePath: relPath,
                  lineNumber: instr.startLine,
                  lineContent: instr.firstLineContent,
                  imageRef: rawRepo,
                  reason: `Dockerfile Node.js base image "${rawRepo}" does not match expected "${expectedPrefix}" from .nvmrc (Node.js ${expectedNodeMajor} LTS).`,
                });
              }
            }
          }
        }

        if (stageAlias) {
          const normalizedAlias = stageAlias.toLowerCase();
          stageAliases.add(normalizedAlias);
          if (isNodeImage) {
            nodeDerivedStages.add(normalizedAlias);
          }
          currentStage = normalizedAlias;
          if (normalizedAlias === 'base') {
            hasBaseStage = true;
            baseStageLine = instr.startLine;
          } else if (normalizedAlias === 'builder') {
            hasBuilderStage = true;
          } else if (normalizedAlias === 'runner') {
            hasRunnerStage = true;
            runnerStageLine = instr.startLine;
            if (isNodeImage) {
              runnerInheritedNode = true;
              violations.push({
                filePath: relPath,
                lineNumber: instr.startLine,
                lineContent: instr.firstLineContent,
                imageRef: 'npm',
                reason: `Dockerfile runner stage must not inherit from Node.js stage/image "${imageSpec}" (which ships npm, npx, corepack, yarn, and /usr/local/include/node); base runner on a minimal OS image (e.g. debian:bookworm-slim) and copy only /usr/local/bin/node.`,
              });
            }
          }
        } else {
          currentStage = null;
        }
      }
      continue;
    }

    if (currentStage === 'runner' && /^COPY\b/i.test(instr.text)) {
      if (/\/usr\/local\/bin\/node\s+\/usr\/local\/bin\/node(?:\s|$)/.test(instr.text)) {
        seenRunnerNodeBinaryCopy = true;
      }
      const forbiddenRunnerCopyMatch = instr.text.match(
        /\/usr\/local\/(?:lib\/node_modules(?:\/npm)?|include\/node)\b|(?:^|[\s'"/])(npm|npx|corepack|yarn)(?:$|[\s'"/])/
      );
      if (forbiddenRunnerCopyMatch) {
        const forbiddenRef = forbiddenRunnerCopyMatch[1] ?? forbiddenRunnerCopyMatch[0].trim();
        violations.push({
          filePath: relPath,
          lineNumber: instr.startLine,
          lineContent: instr.firstLineContent,
          imageRef: forbiddenRef,
          reason:
            'Dockerfile runner stage must omit npm, npx, corepack, yarn, /usr/local/lib/node_modules/npm, and /usr/local/include/node.',
        });
      }
    }

    const copyFromMatch = instr.text.match(/^COPY\s+(?:--\S+\s+)*--from=([^\s]+)\b/i);
    if (copyFromMatch) {
      const fromTarget = copyFromMatch[1].trim();
      const lowerTarget = fromTarget.toLowerCase();
      if (
        !/^\d+$/.test(fromTarget) &&
        lowerTarget !== 'scratch' &&
        !stageAliases.has(lowerTarget) &&
        !fromTarget.includes('${{')
      ) {
        validateExternalImageRef(
          fromTarget,
          relPath,
          instr.startLine,
          instr.firstLineContent,
          violations,
          pinnedOccurrences
        );
      }
      continue;
    }

    const copyMatch = instr.text.match(/^COPY\s+(.*)$/i);
    if (copyMatch && currentStage === 'builder') {
      const tokens = copyMatch[1]
        .trim()
        .split(/\s+/)
        .filter((tok) => tok && !tok.startsWith('--'));
      const sources = tokens.length > 1 ? tokens.slice(0, -1) : [];

      for (const rawSrc of sources) {
        const cleanedSrc = rawSrc.replace(/^['"]|['"]$/g, '');
        if (cleanedSrc === '.' || cleanedSrc === './') {
          violations.push({
            filePath: relPath,
            lineNumber: instr.startLine,
            lineContent: instr.firstLineContent,
            imageRef: 'COPY . .',
            reason:
              'Dockerfile builder stage must copy explicit build inputs instead of broad "COPY . ." so unrelated repository edits preserve BuildKit layer caches.',
          });
          continue;
        }

        const normalizedSrc = cleanedSrc.replace(/^\.\//, '').replace(/\/+$/, '');
        if (normalizedSrc === 'docker-entrypoint.sh' || normalizedSrc.endsWith('/docker-entrypoint.sh')) {
          violations.push({
            filePath: relPath,
            lineNumber: instr.startLine,
            lineContent: instr.firstLineContent,
            imageRef: 'docker-entrypoint.sh',
            reason:
              'Dockerfile must keep docker-entrypoint.sh scoped to the runner stage so entrypoint edits do not invalidate builder layers.',
          });
          continue;
        }

        if (!seenBuilderNpmCi) {
          builderCopiedBeforeNpmCi.push(normalizedSrc);
        } else {
          builderCopiedAfterNpmCi.add(normalizedSrc);
        }
      }
      continue;
    }

    const runMatch = instr.text.match(/^RUN\s+(.*)$/i);
    if (runMatch && currentStage === 'base') {
      if (/update-notifier=false[\s\S]*\/usr\/local\/etc\/npmrc/.test(runMatch[1])) {
        seenBaseGlobalNpmrc = true;
      }
    }

    if (runMatch && currentStage === 'prisma-cli') {
      if (/\bnpm\s+install\b/.test(runMatch[1])) {
        violations.push({
          filePath: relPath,
          lineNumber: instr.startLine,
          lineContent: instr.firstLineContent,
          imageRef: 'npm install',
          reason:
            'Dockerfile prisma-cli stage must use "npm ci" with a committed lockfile instead of unpinned "npm install".',
        });
      }
    }

    if (runMatch && currentStage === 'runner') {
      const forbiddenRunnerRunMatch = runMatch[1].match(
        /\/usr\/local\/(?:lib\/node_modules(?:\/npm)?|include\/node)\b|\b(npm|npx|corepack|yarn)\b/
      );
      if (forbiddenRunnerRunMatch) {
        const forbiddenRef = forbiddenRunnerRunMatch[1] ?? forbiddenRunnerRunMatch[0].trim();
        violations.push({
          filePath: relPath,
          lineNumber: instr.startLine,
          lineContent: instr.firstLineContent,
          imageRef: forbiddenRef,
          reason:
            'Dockerfile runner stage must forbid npm, npx, corepack, yarn, /usr/local/lib/node_modules/npm, and /usr/local/include/node.',
        });
      }
    }

    if (runMatch && currentStage === 'builder') {
      const runBody = runMatch[1];

      if (/\bnpm\s+ci\b/.test(runBody)) {
        seenBuilderNpmCi = true;
        builderNpmCiLine = instr.startLine;

        if (!/--mount=type=cache,[^\s]*target=\/root\/\.npm(?:,|\s)/.test(runBody)) {
          violations.push({
            filePath: relPath,
            lineNumber: instr.startLine,
            lineContent: instr.firstLineContent,
            imageRef: '/root/.npm',
            reason: 'Dockerfile builder "npm ci" RUN block must mount BuildKit cache for "/root/.npm".',
          });
        }

        if (!/\bnpm\s+ci\b[^\n;&|]*--ignore-scripts\b/.test(runBody)) {
          violations.push({
            filePath: relPath,
            lineNumber: instr.startLine,
            lineContent: instr.firstLineContent,
            imageRef: 'npm ci --ignore-scripts',
            reason:
              'Dockerfile builder stage must run "npm ci --ignore-scripts" before copying Prisma and source files.',
          });
        }

        const hasPkg = builderCopiedBeforeNpmCi.includes('package.json');
        const hasLock = builderCopiedBeforeNpmCi.includes('package-lock.json');
        const disallowedBeforeNpmCi = builderCopiedBeforeNpmCi.filter(
          (src) => src !== 'package.json' && src !== 'package-lock.json' && src !== '.npmrc'
        );
        if (!hasPkg || !hasLock || disallowedBeforeNpmCi.length > 0) {
          violations.push({
            filePath: relPath,
            lineNumber: instr.startLine,
            lineContent: instr.firstLineContent,
            imageRef: disallowedBeforeNpmCi[0] ?? 'package.json',
            reason:
              'Dockerfile builder stage must copy only package.json, package-lock.json, and optional .npmrc before "npm ci --ignore-scripts" (copy prisma/ and prisma.config.ts afterward).',
          });
        }
      }

      if (/\bnpm\s+run\s+build:docker\b/.test(runBody)) {
        seenBuilderBuildDocker = true;
        if (!/--mount=type=cache,[^\s]*target=\/app\/\.next\/cache(?:,|\s)/.test(runBody)) {
          violations.push({
            filePath: relPath,
            lineNumber: instr.startLine,
            lineContent: instr.firstLineContent,
            imageRef: '/app/.next/cache',
            reason:
              'Dockerfile builder "npm run build:docker" RUN block must mount BuildKit cache for "/app/.next/cache".',
          });
        }
      }
    }

    if (runMatch && /\bapt-get\b/.test(runMatch[1])) {
      const runBody = runMatch[1];

      if (!/--mount=type=cache,[^\s]*target=\/var\/cache\/apt(?:,|\s)/.test(runBody)) {
        violations.push({
          filePath: relPath,
          lineNumber: instr.startLine,
          lineContent: instr.firstLineContent,
          imageRef: '/var/cache/apt',
          reason: 'Dockerfile APT RUN block must mount BuildKit cache for "/var/cache/apt".',
        });
      }

      if (!/--mount=type=cache,[^\s]*target=\/var\/lib\/apt(?:,|\s)/.test(runBody)) {
        violations.push({
          filePath: relPath,
          lineNumber: instr.startLine,
          lineContent: instr.firstLineContent,
          imageRef: '/var/lib/apt',
          reason: 'Dockerfile APT RUN block must mount BuildKit cache for "/var/lib/apt".',
        });
      }

      const shellCmd = runBody.replace(/^(?:--\S+\s+)*/, '');
      const dockerCleanMatch = shellCmd.match(
        /\brm\s+-[a-zA-Z]*f[a-zA-Z]*\s+['"]?\/etc\/apt\/apt\.conf\.d\/docker-clean['"]?(?=\s|;|&|$)/
      );
      const firstAptGetIdx = shellCmd.search(/\bapt-get\b/);

      if (!dockerCleanMatch || dockerCleanMatch.index === undefined || dockerCleanMatch.index > firstAptGetIdx) {
        violations.push({
          filePath: relPath,
          lineNumber: instr.startLine,
          lineContent: instr.firstLineContent,
          imageRef: '/etc/apt/apt.conf.d/docker-clean',
          reason:
            'Dockerfile APT RUN block must run "rm -f /etc/apt/apt.conf.d/docker-clean" before "apt-get" so BuildKit retains .deb packages in /var/cache/apt.',
        });
      }

      const commandSegments = shellCmd.split(/\s*(?:&&|\|\||;|\|)\s*/);
      for (const segment of commandSegments) {
        if (/\bapt-get\b.*\binstall\b/.test(segment) && !/(?:^|\s)--no-install-recommends(?:\s|$)/.test(segment)) {
          violations.push({
            filePath: relPath,
            lineNumber: instr.startLine,
            lineContent: instr.firstLineContent,
            imageRef: 'apt-get install',
            reason: 'Dockerfile "apt-get install" command must include "--no-install-recommends".',
          });
        }
      }

      if (/\brm\s+-[^\n;&|]*\/var\/lib\/apt\/lists\b/.test(shellCmd)) {
        violations.push({
          filePath: relPath,
          lineNumber: instr.startLine,
          lineContent: instr.firstLineContent,
          imageRef: '/var/lib/apt/lists/*',
          reason:
            'Dockerfile APT RUN block must not delete "/var/lib/apt/lists/*" inside a BuildKit /var/lib/apt cache mount.',
        });
      }
    }
  }

  if (hasBuilderStage) {
    if (!seenBuilderNpmCi) {
      violations.push({
        filePath: relPath,
        lineNumber: 1,
        lineContent: '',
        imageRef: 'npm ci --ignore-scripts',
        reason: 'Dockerfile builder stage must execute "npm ci --ignore-scripts" before copying application sources.',
      });
    } else {
      const requiredBuilderInputs = [
        'prisma',
        'prisma.config.ts',
        'next.config.ts',
        'postcss.config.mjs',
        'tsconfig.json',
        'tsconfig.build.json',
        'assets',
        'public',
        'src',
        'scripts/generate-password-hash.mjs',
      ];
      for (const reqInput of requiredBuilderInputs) {
        if (!builderCopiedAfterNpmCi.has(reqInput)) {
          violations.push({
            filePath: relPath,
            lineNumber: builderNpmCiLine,
            lineContent: '',
            imageRef: reqInput,
            reason: `Dockerfile builder stage must explicitly copy "${reqInput}" after "npm ci --ignore-scripts".`,
          });
        }
      }
    }

    if (!seenBuilderBuildDocker) {
      violations.push({
        filePath: relPath,
        lineNumber: 1,
        lineContent: '',
        imageRef: 'npm run build:docker',
        reason: 'Dockerfile builder stage must execute "npm run build:docker".',
      });
    }
  }

  if (hasBaseStage && !seenBaseGlobalNpmrc) {
    violations.push({
      filePath: relPath,
      lineNumber: baseStageLine,
      lineContent: '',
      imageRef: '/usr/local/etc/npmrc',
      reason:
        'Dockerfile base stage must write "update-notifier=false" to "/usr/local/etc/npmrc" ($PREFIX/etc/npmrc).',
    });
  }

  if (hasRunnerStage && !runnerInheritedNode && !seenRunnerNodeBinaryCopy) {
    violations.push({
      filePath: relPath,
      lineNumber: runnerStageLine,
      lineContent: '',
      imageRef: '/usr/local/bin/node',
      reason: 'Dockerfile runner stage must copy "/usr/local/bin/node" into "/usr/local/bin/node".',
    });
  }

  if (expectedNodeMajor && !foundNodeBaseImage) {
    violations.push({
      filePath: relPath,
      lineNumber: 1,
      lineContent: '',
      imageRef: `node:${expectedNodeMajor}-bookworm-slim`,
      reason: `Dockerfile must declare a "node:${expectedNodeMajor}-bookworm-slim" base stage matching .nvmrc.`,
    });
  }
}

function recordYamlDiagnostics(
  doc: ReturnType<typeof parseDocument>,
  relPath: string,
  lines: string[],
  violations: Violation[]
): void {
  for (const err of doc.errors) {
    const lineNumber = err.linePos?.[0]?.line ?? 1;
    const summary = err.message.split(/\r?\n/)[0].trim();
    violations.push({
      filePath: relPath,
      lineNumber,
      lineContent: (lines[lineNumber - 1] ?? '').trim(),
      imageRef: err.code,
      reason: `YAML 1.2 parse error (${err.code}): ${summary}`,
    });
  }

  for (const warn of doc.warnings) {
    const lineNumber = warn.linePos?.[0]?.line ?? 1;
    const summary = warn.message.split(/\r?\n/)[0].trim();
    violations.push({
      filePath: relPath,
      lineNumber,
      lineContent: (lines[lineNumber - 1] ?? '').trim(),
      imageRef: warn.code,
      reason: `YAML 1.2 warning (${warn.code}): ${summary}`,
    });
  }
}

function collectComposeLocalBuildImages(composePath: string): Set<string> {
  const localImages = new Set<string>();
  if (!fs.existsSync(composePath)) {
    return localImages;
  }
  const content = fs.readFileSync(composePath, 'utf8');
  const doc = parseDocument(content, { version: '1.2', strict: true });
  if (!isMap(doc.contents)) {
    return localImages;
  }
  const servicesNode = doc.contents.get('services', true);
  if (!isMap(servicesNode)) {
    return localImages;
  }
  for (const svcPair of servicesNode.items) {
    const svcMap = svcPair.value;
    if (!isMap(svcMap)) {
      continue;
    }
    const buildNode = svcMap.get('build', true);
    const hasBuild =
      buildNode !== undefined && (!isScalar(buildNode) || buildNode.value !== null);
    if (!hasBuild) {
      continue;
    }
    const imageNode = svcMap.get('image', true);
    if (isScalar(imageNode) && typeof imageNode.value === 'string' && imageNode.value.trim()) {
      localImages.add(imageNode.value.trim());
    }
  }
  return localImages;
}

function checkDockerComposeFile(
  composePath: string,
  baseDir: string,
  violations: Violation[],
  pinnedOccurrences: Map<string, PinnedImageOccurrence[]>,
  sharedLocalBuildImages: ReadonlySet<string> = new Set()
): void {
  const relPath = path.relative(baseDir, composePath).replace(/\\/g, '/');
  const content = fs.readFileSync(composePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const lineCounter = new LineCounter();
  const doc = parseDocument(content, { version: '1.2', strict: true, lineCounter });

  recordYamlDiagnostics(doc, relPath, lines, violations);

  lines.forEach((rawLine, idx) => {
    const trimmed = rawLine.trim();
    if (/^<<\s*:/.test(trimmed)) {
      violations.push({
        filePath: relPath,
        lineNumber: idx + 1,
        lineContent: trimmed,
        imageRef: '<<',
        reason: `${relPath} must not use YAML 1.1 "<<" merge keys; expand service mappings explicitly for strict YAML 1.2 compatibility.`,
      });
    }
  });

  if (relPath === 'docker-compose.yml' || relPath === 'docker-compose.rollout.yml') {
    lines.forEach((rawLine, idx) => {
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return;
      }
      if (/\btype=gha\b/.test(trimmed)) {
        violations.push({
          filePath: relPath,
          lineNumber: idx + 1,
          lineContent: trimmed,
          imageRef: 'type=gha',
          reason:
            `${relPath} must remain provider-neutral and omit GitHub Actions BuildKit cache backends ("type=gha"); move CI cache_from overrides to docker-compose.ci.yml.`,
        });
      }
      if (/\bGHA_CACHE_SCOPE\b/.test(trimmed)) {
        violations.push({
          filePath: relPath,
          lineNumber: idx + 1,
          lineContent: trimmed,
          imageRef: 'GHA_CACHE_SCOPE',
          reason:
            `${relPath} must omit "GHA_CACHE_SCOPE"; isolate CI cache scope configuration in docker-compose.ci.yml.`,
        });
      }
    });
  }

  if (!isMap(doc.contents)) {
    return;
  }

  const servicesNode = doc.contents.get('services', true);
  if (!isMap(servicesNode)) {
    return;
  }

  if (relPath === 'docker-compose.yml') {
    const appSvc = servicesNode.get('app', true);
    if (isMap(appSvc)) {
      const initNode = appSvc.get('init', true);
      if (!isScalar(initNode) || initNode.value !== true) {
        violations.push({
          filePath: relPath,
          lineNumber: 1,
          lineContent: '',
          imageRef: 'app.init',
          reason: 'docker-compose.yml service "app" must set "init: true" for signal forwarding and zombie reaping.',
        });
      }

      const stopGraceNode = appSvc.get('stop_grace_period', true);
      const rawGrace = isScalar(stopGraceNode) ? String(stopGraceNode.value ?? '').trim() : '';
      const graceMatch = rawGrace.match(/^(\d+)(ms|s|m)?$/i);
      let graceMs = 0;
      if (graceMatch) {
        const amount = Number(graceMatch[1]);
        const unit = (graceMatch[2] ?? 's').toLowerCase();
        graceMs = unit === 'ms' ? amount : unit === 'm' ? amount * 60_000 : amount * 1000;
      }
      if (!graceMatch || graceMs < 15_000) {
        violations.push({
          filePath: relPath,
          lineNumber: 1,
          lineContent: rawGrace ? `stop_grace_period: ${rawGrace}` : '',
          imageRef: 'app.stop_grace_period',
          reason:
            'docker-compose.yml service "app" must configure "stop_grace_period: 15s" (at least 15s to cover HTTP request completion and the 5000ms Prisma pool drain).',
        });
      }
    }
  }

  for (const forbiddenBuildService of ['migration', 'app-standby']) {
    const svcNode = servicesNode.get(forbiddenBuildService, true);
    const buildNode = isMap(svcNode) ? svcNode.get('build', true) : undefined;
    const hasBuild =
      buildNode !== undefined && (!isScalar(buildNode) || buildNode.value !== null);
    if (hasBuild) {
      const offset =
        isMap(buildNode) || isSeq(buildNode) || isScalar(buildNode)
          ? (buildNode.range?.[0] ?? 0)
          : 0;
      const lineNumber = lineCounter.linePos(offset).line;
      violations.push({
        filePath: relPath,
        lineNumber,
        lineContent: (lines[lineNumber - 1] ?? '').trim(),
        imageRef: `${forbiddenBuildService}.build`,
        reason: `${relPath} service "${forbiddenBuildService}" must not configure "build"; keep "app" as the sole image build owner and reuse wedding-website:latest via pull_policy: never.`,
      });
    }
  }

  if (relPath === 'docker-compose.ci.yml') {
    const appSvcNode = servicesNode.get('app', true);
    const buildNode = isMap(appSvcNode) ? appSvcNode.get('build', true) : undefined;
    const cacheFromNode = isMap(buildNode) ? buildNode.get('cache_from', true) : undefined;
    const hasValidGhaCacheFrom =
      isSeq(cacheFromNode) &&
      cacheFromNode.items.some(
        (item) =>
          isScalar(item) &&
          typeof item.value === 'string' &&
          item.value.includes('type=gha') &&
          item.value.includes('${GHA_CACHE_SCOPE:-app-amd64}')
      );

    if (!hasValidGhaCacheFrom) {
      violations.push({
        filePath: relPath,
        lineNumber: 1,
        lineContent: '',
        imageRef: 'app.build.cache_from',
        reason:
          'docker-compose.ci.yml service "app" must configure build.cache_from with "type=gha,scope=${GHA_CACHE_SCOPE:-app-amd64}".',
      });
    }

    const cacheToNode = isMap(buildNode) ? buildNode.get('cache_to', true) : undefined;
    if (cacheToNode !== undefined) {
      const offset =
        isMap(cacheToNode) || isSeq(cacheToNode) || isScalar(cacheToNode)
          ? (cacheToNode.range?.[0] ?? 0)
          : 0;
      const lineNumber = lineCounter.linePos(offset).line;
      violations.push({
        filePath: relPath,
        lineNumber,
        lineContent: (lines[lineNumber - 1] ?? '').trim(),
        imageRef: 'app.build.cache_to',
        reason: 'docker-compose.ci.yml service "app" must not configure build.cache_to.',
      });
    }
  }

  const localBuildImages = new Set<string>(sharedLocalBuildImages);
  for (const svcPair of servicesNode.items) {
    const svcMap = svcPair.value;
    if (!isMap(svcMap)) {
      continue;
    }
    const buildNode = svcMap.get('build', true);
    if (buildNode !== undefined && (!isScalar(buildNode) || buildNode.value !== null)) {
      const imageNode = svcMap.get('image', true);
      if (isScalar(imageNode) && typeof imageNode.value === 'string' && imageNode.value.trim()) {
        localBuildImages.add(imageNode.value.trim());
      }
    }
  }

  for (const svcPair of servicesNode.items) {
    const svcMap = svcPair.value;
    if (!isMap(svcMap)) {
      continue;
    }

    // Skip local Compose services that build from source (e.g. app)
    const buildNode = svcMap.get('build', true);
    if (buildNode !== undefined && (!isScalar(buildNode) || buildNode.value !== null)) {
      continue;
    }

    const imageNode = svcMap.get('image', true);
    if (isScalar(imageNode) && typeof imageNode.value === 'string') {
      const pullPolicyNode = svcMap.get('pull_policy', true);
      const hasNeverPullPolicy =
        isScalar(pullPolicyNode) &&
        typeof pullPolicyNode.value === 'string' &&
        pullPolicyNode.value.trim() === 'never';
      if (hasNeverPullPolicy && localBuildImages.has(imageNode.value.trim())) {
        continue;
      }

      const offset = imageNode.range?.[0] ?? 0;
      const lineNumber = lineCounter.linePos(offset).line;
      const lineContent = (lines[lineNumber - 1] ?? '').trim();
      validateExternalImageRef(
        imageNode.value,
        relPath,
        lineNumber,
        lineContent,
        violations,
        pinnedOccurrences
      );
    }
  }
}

function validateScalarImageNode(
  node: unknown,
  relPath: string,
  lines: string[],
  lineCounter: LineCounter,
  violations: Violation[],
  pinnedOccurrences: Map<string, PinnedImageOccurrence[]>,
  stripPrefix: string = ''
): void {
  if (!isScalar(node) || typeof node.value !== 'string') {
    return;
  }
  const rawVal = stripPrefix && node.value.startsWith(stripPrefix)
    ? node.value.slice(stripPrefix.length)
    : node.value;
  const offset = node.range?.[0] ?? 0;
  const lineNumber = lineCounter.linePos(offset).line;
  const lineContent = (lines[lineNumber - 1] ?? '').trim();
  validateExternalImageRef(rawVal, relPath, lineNumber, lineContent, violations, pinnedOccurrences);
}

function validateContainerOrServiceNode(
  node: unknown,
  relPath: string,
  lines: string[],
  lineCounter: LineCounter,
  violations: Violation[],
  pinnedOccurrences: Map<string, PinnedImageOccurrence[]>
): void {
  if (isScalar(node)) {
    validateScalarImageNode(node, relPath, lines, lineCounter, violations, pinnedOccurrences);
  } else if (isMap(node)) {
    validateScalarImageNode(
      node.get('image', true),
      relPath,
      lines,
      lineCounter,
      violations,
      pinnedOccurrences
    );
  }
}

function checkWorkflowImages(
  workflowPath: string,
  baseDir: string,
  violations: Violation[],
  pinnedOccurrences: Map<string, PinnedImageOccurrence[]>,
  expectedNodeMajor: string | null
): void {
  const relPath = path.relative(baseDir, workflowPath).replace(/\\/g, '/');
  const content = fs.readFileSync(workflowPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const lineCounter = new LineCounter();
  const doc = parseDocument(content, { version: '1.2', strict: true, lineCounter });

  recordYamlDiagnostics(doc, relPath, lines, violations);

  if (!isMap(doc.contents)) {
    return;
  }

  const jobsNode: unknown = doc.contents.get('jobs', true);
  if (!isMap(jobsNode)) {
    return;
  }

  for (const jobPair of jobsNode.items) {
    const jobMap: unknown = jobPair.value;
    if (!isMap(jobMap)) {
      continue;
    }

    validateContainerOrServiceNode(
      jobMap.get('container', true),
      relPath,
      lines,
      lineCounter,
      violations,
      pinnedOccurrences
    );

    const servicesNode: unknown = jobMap.get('services', true);
    if (isMap(servicesNode)) {
      for (const svcPair of servicesNode.items) {
        validateContainerOrServiceNode(
          svcPair.value,
          relPath,
          lines,
          lineCounter,
          violations,
          pinnedOccurrences
        );
      }
    }

    const stepsNode: unknown = jobMap.get('steps', true);
    if (isSeq(stepsNode)) {
      for (const stepNode of stepsNode.items) {
        if (!isMap(stepNode)) {
          continue;
        }
        const usesNode: unknown = stepNode.get('uses', true);
        if (isScalar(usesNode) && typeof usesNode.value === 'string' && usesNode.value.trim().startsWith('docker://')) {
          validateScalarImageNode(
            usesNode,
            relPath,
            lines,
            lineCounter,
            violations,
            pinnedOccurrences,
            'docker://'
          );
        }

        if (
          isScalar(usesNode) &&
          typeof usesNode.value === 'string' &&
          usesNode.value.trim().startsWith('actions/setup-node@')
        ) {
          const usesOffset = usesNode.range?.[0] ?? 0;
          const usesLine = lineCounter.linePos(usesOffset).line;
          const usesLineContent = (lines[usesLine - 1] ?? '').trim();
          const setupWithNode: unknown = stepNode.get('with', true);
          const versionFileNode: unknown = isMap(setupWithNode)
            ? setupWithNode.get('node-version-file', true)
            : undefined;
          const nodeVersionNode: unknown = isMap(setupWithNode)
            ? setupWithNode.get('node-version', true)
            : undefined;

          if (versionFileNode === undefined && nodeVersionNode === undefined) {
            violations.push({
              filePath: relPath,
              lineNumber: usesLine,
              lineContent: usesLineContent,
              imageRef: 'actions/setup-node',
              reason:
                'actions/setup-node step must declare node-version-file: ".nvmrc" or a node-version matching .nvmrc.',
            });
          } else {
            if (versionFileNode !== undefined) {
              const versionFileVal =
                isScalar(versionFileNode) && versionFileNode.value !== null
                  ? String(versionFileNode.value).trim()
                  : '';
              const vfOffset =
                isScalar(versionFileNode) && versionFileNode.range ? versionFileNode.range[0] : usesOffset;
              const vfLine = lineCounter.linePos(vfOffset).line;
              if (versionFileVal !== '.nvmrc') {
                violations.push({
                  filePath: relPath,
                  lineNumber: vfLine,
                  lineContent: (lines[vfLine - 1] ?? '').trim(),
                  imageRef: 'node-version-file',
                  reason: `actions/setup-node node-version-file ("${versionFileVal}") must reference ".nvmrc".`,
                });
              }
            }
            if (nodeVersionNode !== undefined) {
              const rawNodeVersion =
                isScalar(nodeVersionNode) && nodeVersionNode.value !== null
                  ? String(nodeVersionNode.value).trim()
                  : '';
              const nvOffset =
                isScalar(nodeVersionNode) && nodeVersionNode.range ? nodeVersionNode.range[0] : usesOffset;
              const nvLine = lineCounter.linePos(nvOffset).line;
              if (!rawNodeVersion.includes('${{')) {
                const wfNodeMajor = parseLeadingMajorVersion(rawNodeVersion);
                if (!wfNodeMajor || (expectedNodeMajor && wfNodeMajor !== expectedNodeMajor)) {
                  violations.push({
                    filePath: relPath,
                    lineNumber: nvLine,
                    lineContent: (lines[nvLine - 1] ?? '').trim(),
                    imageRef: 'node-version',
                    reason: `actions/setup-node node-version ("${rawNodeVersion}") does not match expected Node.js major "${expectedNodeMajor ?? 'unknown'}" from .nvmrc.`,
                  });
                }
              }
            }
          }
        }

        const withNode: unknown = stepNode.get('with', true);
        if (isMap(withNode)) {
          validateScalarImageNode(
            withNode.get('image', true),
            relPath,
            lines,
            lineCounter,
            violations,
            pinnedOccurrences
          );
        }
      }
    }
  }
}

export interface CheckDockerBuildOptions {
  requireStandalone?: boolean;
  standaloneOnly?: boolean;
}

function validateStandaloneOutput(
  rootDir: string,
  requireStandalone: boolean,
  violations: Violation[]
): void {
  const nextDir = path.join(rootDir, '.next');
  const standaloneDir = path.join(nextDir, 'standalone');
  const hasNextDir = fs.existsSync(nextDir) && fs.statSync(nextDir).isDirectory();
  const hasStandaloneDir =
    hasNextDir && fs.existsSync(standaloneDir) && fs.statSync(standaloneDir).isDirectory();
  const hasProductionBuildMarker =
    hasNextDir &&
    (fs.existsSync(path.join(nextDir, 'BUILD_ID')) ||
      fs.existsSync(path.join(nextDir, 'routes-manifest.json')) ||
      hasStandaloneDir);

  if (requireStandalone && !hasNextDir) {
    violations.push({
      filePath: '.next',
      lineNumber: 1,
      lineContent: '',
      imageRef: '.next',
      reason:
        ".next build output directory is missing while --require-standalone is enabled. Run 'npm run build' first.",
    });
  } else if ((requireStandalone || hasProductionBuildMarker) && !hasStandaloneDir) {
    violations.push({
      filePath: '.next/standalone',
      lineNumber: 1,
      lineContent: '',
      imageRef: '.next/standalone',
      reason:
        '.next directory exists but .next/standalone was not generated. Ensure Next.js build produces standalone output.',
    });
  } else if (hasStandaloneDir) {
    const serverJs = path.join(standaloneDir, 'server.js');
    if (!fs.existsSync(serverJs) || !fs.statSync(serverJs).isFile()) {
      violations.push({
        filePath: '.next/standalone/server.js',
        lineNumber: 1,
        lineContent: '',
        imageRef: 'server.js',
        reason: '.next/standalone/server.js is missing.',
      });
    }

    const standaloneStaticDir = path.join(standaloneDir, '.next', 'static');
    if (!fs.existsSync(standaloneStaticDir) || !fs.statSync(standaloneStaticDir).isDirectory()) {
      violations.push({
        filePath: '.next/standalone/.next/static',
        lineNumber: 1,
        lineContent: '',
        imageRef: '.next/standalone/.next/static',
        reason:
          '.next/standalone/.next/static is missing. Copy .next/static into .next/standalone/.next/static after building.',
      });
    } else if (fs.readdirSync(standaloneStaticDir).length === 0) {
      violations.push({
        filePath: '.next/standalone/.next/static',
        lineNumber: 1,
        lineContent: '',
        imageRef: '.next/standalone/.next/static',
        reason: '.next/standalone/.next/static directory is empty.',
      });
    } else if (fs.existsSync(path.join(standaloneStaticDir, 'static'))) {
      violations.push({
        filePath: '.next/standalone/.next/static/static',
        lineNumber: 1,
        lineContent: '',
        imageRef: 'static/static',
        reason: '.next/standalone/.next/static/static nested copy detected.',
      });
    }

    const standalonePublicDir = path.join(standaloneDir, 'public');
    if (!fs.existsSync(standalonePublicDir) || !fs.statSync(standalonePublicDir).isDirectory()) {
      violations.push({
        filePath: '.next/standalone/public',
        lineNumber: 1,
        lineContent: '',
        imageRef: '.next/standalone/public',
        reason:
          '.next/standalone/public is missing. Copy public into .next/standalone/public after building.',
      });
    } else if (fs.readdirSync(standalonePublicDir).length === 0) {
      violations.push({
        filePath: '.next/standalone/public',
        lineNumber: 1,
        lineContent: '',
        imageRef: '.next/standalone/public',
        reason: '.next/standalone/public directory is empty.',
      });
    } else {
      if (fs.existsSync(path.join(standalonePublicDir, 'public'))) {
        violations.push({
          filePath: '.next/standalone/public/public',
          lineNumber: 1,
          lineContent: '',
          imageRef: 'public/public',
          reason: '.next/standalone/public/public nested copy detected.',
        });
      }
      if (fs.existsSync(path.join(standalonePublicDir, 'mockServiceWorker.js'))) {
        violations.push({
          filePath: '.next/standalone/public/mockServiceWorker.js',
          lineNumber: 1,
          lineContent: '',
          imageRef: 'mockServiceWorker.js',
          reason:
            '.next/standalone/public/mockServiceWorker.js must not be bundled in standalone output.',
        });
      }
    }

    const standaloneNextDir = path.join(standaloneDir, '.next');
    const standaloneChunksDir = path.join(standaloneStaticDir, 'chunks');
    if (fs.existsSync(standaloneChunksDir) && fs.statSync(standaloneChunksDir).isDirectory()) {
      const eagerChunkRoutes = new Map<string, Set<string>>();
      const recordEagerChunk = (chunkRef: string, routeLabel: string): void => {
        if (!chunkRef.endsWith('.js')) return;
        const chunkFile = path.basename(chunkRef);
        let routeSet = eagerChunkRoutes.get(chunkFile);
        if (!routeSet) {
          routeSet = new Set<string>();
          eagerChunkRoutes.set(chunkFile, routeSet);
        }
        routeSet.add(routeLabel);
      };

      let hasManifestMetadata = false;
      const buildManifestPath = path.join(standaloneNextDir, 'build-manifest.json');
      if (fs.existsSync(buildManifestPath)) {
        hasManifestMetadata = true;
        try {
          const buildManifest = JSON.parse(fs.readFileSync(buildManifestPath, 'utf8')) as {
            rootMainFiles?: string[];
          };
          for (const chunkRef of buildManifest.rootMainFiles ?? []) {
            recordEagerChunk(chunkRef, '<rootMainFiles>');
          }
        } catch (err) {
          violations.push({
            filePath: '.next/standalone/.next/build-manifest.json',
            lineNumber: 1,
            lineContent: '',
            imageRef: 'build-manifest.json',
            reason: `Failed to parse .next/standalone/.next/build-manifest.json: ${(err as Error).message}`,
          });
        }
      }

      const standaloneServerAppDir = path.join(standaloneNextDir, 'server', 'app');
      if (fs.existsSync(standaloneServerAppDir) && fs.statSync(standaloneServerAppDir).isDirectory()) {
        hasManifestMetadata = true;
        const manifestStack = [standaloneServerAppDir];
        const manifestPattern =
          /globalThis\.__RSC_MANIFEST\[("(?:[^"\\]|\\.)*")\]\s*=\s*(\{[\s\S]*?\});\s*$/gm;
        while (manifestStack.length > 0) {
          const currentDir = manifestStack.pop()!;
          for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
            const entryPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
              manifestStack.push(entryPath);
            } else if (entry.isFile() && entry.name.endsWith('_client-reference-manifest.js')) {
              const rawManifest = fs.readFileSync(entryPath, 'utf8');
              manifestPattern.lastIndex = 0;
              let match: RegExpExecArray | null;
              while ((match = manifestPattern.exec(rawManifest)) !== null) {
                try {
                  const routeName = JSON.parse(match[1]) as string;
                  const parsedManifest = JSON.parse(match[2]) as {
                    entryJSFiles?: Record<string, string[]>;
                  };
                  for (const chunkList of Object.values(parsedManifest.entryJSFiles ?? {})) {
                    for (const chunkRef of chunkList) {
                      recordEagerChunk(chunkRef, routeName);
                    }
                  }
                } catch (err) {
                  const relManifestPath = path
                    .relative(rootDir, entryPath)
                    .split(path.sep)
                    .join('/');
                  violations.push({
                    filePath: relManifestPath,
                    lineNumber: 1,
                    lineContent: '',
                    imageRef: entry.name,
                    reason: `Failed to parse ${relManifestPath}: ${(err as Error).message}`,
                  });
                }
              }
            }
          }
        }
      }

      if (!hasManifestMetadata) {
        for (const entry of fs.readdirSync(standaloneChunksDir, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith('.js')) {
            recordEagerChunk(entry.name, '<standalone-chunks>');
          }
        }
      }

      const forbiddenStandaloneChunkMarkers: ReadonlyArray<{
        marker: string;
        category: 'demo' | 'setup';
        allowedRoutes: ReadonlySet<string>;
      }> = [
        {
          marker: 'wedding_showcase_demo_v1',
          category: 'demo',
          allowedRoutes: new Set<string>(),
        },
        {
          marker: 'installDemoFetchInterceptor',
          category: 'demo',
          allowedRoutes: new Set<string>(),
        },
        {
          marker: 'Interactive Demo Controls',
          category: 'demo',
          allowedRoutes: new Set<string>(),
        },
        {
          marker: 'Non-Charging Demo Checkout',
          category: 'demo',
          allowedRoutes: new Set<string>(),
        },
        {
          marker: 'Step 3: Sample Data Selection',
          category: 'setup',
          allowedRoutes: new Set<string>(['/admin/setup/page']),
        },
        {
          marker: 'Import Guest Invitation Codes',
          category: 'setup',
          allowedRoutes: new Set<string>(['/admin/dashboard/invitation-codes/page']),
        },
      ];

      for (const [chunkName, routes] of eagerChunkRoutes.entries()) {
        const chunkPath = path.join(standaloneChunksDir, chunkName);
        if (!fs.existsSync(chunkPath) || !fs.statSync(chunkPath).isFile()) {
          continue;
        }
        const chunkContent = fs.readFileSync(chunkPath, 'utf8');
        for (const rule of forbiddenStandaloneChunkMarkers) {
          if (!chunkContent.includes(rule.marker)) {
            continue;
          }
          const disallowedRoutes = [...routes]
            .filter((route) => !rule.allowedRoutes.has(route))
            .sort();
          if (disallowedRoutes.length > 0) {
            const relChunkPath = `.next/standalone/.next/static/chunks/${chunkName}`;
            violations.push({
              filePath: relChunkPath,
              lineNumber: 1,
              lineContent: '',
              imageRef: rule.marker,
              reason: `${relChunkPath} eagerly bundles ${rule.category} marker "${rule.marker}" into standalone route(s): ${disallowedRoutes.slice(0, 3).join(', ')}. Isolate demo and setup modules behind next/dynamic.`,
            });
          }
        }
      }
    }
    const forbiddenStandalonePaths = [
      ['node_modules', 'pdfkit', 'js', 'pdfkit.standalone.js'],
      ['node_modules', 'pdfkit', 'js', 'pdfkit.browser.js'],
      ['node_modules', 'pdfkit', 'js', 'pdfkit.old.js'],
      ['node_modules', 'fontkit', 'dist', 'browser.cjs'],
    ];
    for (const segments of forbiddenStandalonePaths) {
      const candidatePath = path.join(standaloneDir, ...segments);
      if (fs.existsSync(candidatePath)) {
        const relStandalone = ['.next', 'standalone', ...segments].join('/');
        violations.push({
          filePath: relStandalone,
          lineNumber: 1,
          lineContent: '',
          imageRef: segments[segments.length - 1],
          reason: `${relStandalone} browser/.old bundle must be excluded from standalone output.`,
        });
      }
    }
  }
}

export function checkDockerBuild(
  rootDir: string = ROOT_DIR,
  options: CheckDockerBuildOptions = {}
): {
  violations: Violation[];
} {
  const { standaloneOnly = false } = options;
  const requireStandalone = Boolean(options.requireStandalone || standaloneOnly);
  const violations: Violation[] = [];
  if (standaloneOnly) {
    validateStandaloneOutput(rootDir, true, violations);
    return { violations };
  }
  const pinnedOccurrences = new Map<string, PinnedImageOccurrence[]>();

  // 0. Check .nvmrc and package.json Node.js major version parity
  let expectedNodeMajor: string | null = null;
  const nvmrcPath = path.join(rootDir, '.nvmrc');
  if (!fs.existsSync(nvmrcPath)) {
    violations.push({
      filePath: '.nvmrc',
      lineNumber: 1,
      lineContent: '',
      imageRef: '.nvmrc',
      reason: '.nvmrc is missing from repository root.',
    });
  } else {
    const nvmrcContent = fs.readFileSync(nvmrcPath, 'utf8').trim();
    expectedNodeMajor = parseLeadingMajorVersion(nvmrcContent);
    if (!expectedNodeMajor) {
      violations.push({
        filePath: '.nvmrc',
        lineNumber: 1,
        lineContent: nvmrcContent,
        imageRef: '.nvmrc',
        reason: `.nvmrc ("${nvmrcContent}") must declare a valid Node.js major version (e.g. "22").`,
      });
    }
  }

  const packageJsonPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    violations.push({
      filePath: 'package.json',
      lineNumber: 1,
      lineContent: '',
      imageRef: 'package.json',
      reason: 'package.json is missing from repository root.',
    });
  } else {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
        engines?: { node?: string; npm?: string };
        devEngines?: {
          runtime?: { name?: string; version?: string; onFail?: string };
          packageManager?: { name?: string; version?: string; onFail?: string };
        };
        devDependencies?: Record<string, string>;
      };
      const enginesNode = pkg.engines?.node ?? '';
      const enginesNpm = pkg.engines?.npm ?? '';
      const pkgNodeMajor = parseLeadingMajorVersion(enginesNode);
      if (!pkgNodeMajor) {
        violations.push({
          filePath: 'package.json',
          lineNumber: 1,
          lineContent: '',
          imageRef: 'engines.node',
          reason: 'package.json must declare engines.node matching .nvmrc.',
        });
      } else if (expectedNodeMajor && pkgNodeMajor !== expectedNodeMajor) {
        violations.push({
          filePath: 'package.json',
          lineNumber: 1,
          lineContent: `"node": "${enginesNode}"`,
          imageRef: 'engines.node',
          reason: `package.json engines.node ("${enginesNode}") major version "${pkgNodeMajor}" does not match .nvmrc ("${expectedNodeMajor}").`,
        });
      }
      if (!enginesNpm || parseLeadingMajorVersion(enginesNpm) !== '10') {
        violations.push({
          filePath: 'package.json',
          lineNumber: 1,
          lineContent: enginesNpm ? `"npm": "${enginesNpm}"` : '',
          imageRef: 'engines.npm',
          reason: 'package.json must declare engines.npm targeting npm 10 ("^10.9.0").',
        });
      }
      const runtimeNodeVersion = pkg.devEngines?.runtime?.version?.trim();
      const runtimeNodeMajor = runtimeNodeVersion
        ? parseLeadingMajorVersion(runtimeNodeVersion)
        : null;
      if (
        pkg.devEngines?.runtime?.name !== 'node' ||
        !runtimeNodeVersion ||
        runtimeNodeMajor !== (expectedNodeMajor ?? pkgNodeMajor) ||
        pkg.devEngines?.runtime?.onFail !== 'error'
      ) {
        violations.push({
          filePath: 'package.json',
          lineNumber: 1,
          lineContent: '',
          imageRef: 'devEngines.runtime',
          reason:
            'package.json devEngines.runtime must enforce name "node", Node major matching engines.node/.nvmrc, and onFail "error".',
        });
      }
      if (
        pkg.devEngines?.packageManager?.name !== 'npm' ||
        pkg.devEngines?.packageManager?.version !== enginesNpm ||
        pkg.devEngines?.packageManager?.onFail !== 'error'
      ) {
        violations.push({
          filePath: 'package.json',
          lineNumber: 1,
          lineContent: '',
          imageRef: 'devEngines.packageManager',
          reason:
            'package.json devEngines.packageManager must enforce name "npm", version matching engines.npm, and onFail "error".',
        });
      }
      const typesNodeVersion = pkg.devDependencies?.['@types/node'];
      if (typesNodeVersion !== undefined) {
        const typesNodeMajor = parseLeadingMajorVersion(typesNodeVersion);
        if (!typesNodeMajor || (expectedNodeMajor && typesNodeMajor !== expectedNodeMajor)) {
          violations.push({
            filePath: 'package.json',
            lineNumber: 1,
            lineContent: `"@types/node": "${typesNodeVersion}"`,
            imageRef: '@types/node',
            reason: `package.json devDependencies["@types/node"] ("${typesNodeVersion}") does not match .nvmrc ("${expectedNodeMajor ?? 'unknown'}").`,
          });
        }
      }
    } catch {
      violations.push({
        filePath: 'package.json',
        lineNumber: 1,
        lineContent: '',
        imageRef: 'package.json',
        reason: 'package.json contains invalid JSON.',
      });
    }
  }

  // 1. Check Dockerfile
  const dockerfilePath = path.join(rootDir, 'Dockerfile');
  if (!fs.existsSync(dockerfilePath)) {
    violations.push({
      filePath: 'Dockerfile',
      lineNumber: 1,
      lineContent: '',
      imageRef: 'Dockerfile',
      reason: 'Dockerfile is missing from repository root.',
    });
  } else {
    const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf8');
    checkDockerfileContent(
      dockerfileContent,
      'Dockerfile',
      violations,
      pinnedOccurrences,
      expectedNodeMajor
    );
  }

  // 1b. Check .dockerignore
  const dockerignorePath = path.join(rootDir, '.dockerignore');
  if (!fs.existsSync(dockerignorePath)) {
    violations.push({
      filePath: '.dockerignore',
      lineNumber: 1,
      lineContent: '',
      imageRef: '.dockerignore',
      reason: '.dockerignore is missing from repository root.',
    });
  } else {
    const ignoreLines = fs
      .readFileSync(dockerignorePath, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));

    let dockerfileIgnored = false;
    let entrypointIgnored = false;
    for (const rule of ignoreLines) {
      const normalizedRule = rule.replace(/^\/+/, '');
      if (normalizedRule === 'Dockerfile') {
        dockerfileIgnored = true;
      } else if (rule === '!Dockerfile' || rule === '!/Dockerfile') {
        dockerfileIgnored = false;
      }
      if (
        normalizedRule === 'docker-entrypoint.sh' ||
        normalizedRule === '*.sh' ||
        normalizedRule === '**/*.sh'
      ) {
        entrypointIgnored = true;
      } else if (rule === '!docker-entrypoint.sh' || rule === '!/docker-entrypoint.sh') {
        entrypointIgnored = false;
      }
    }

    if (!dockerfileIgnored) {
      violations.push({
        filePath: '.dockerignore',
        lineNumber: 1,
        lineContent: '',
        imageRef: 'Dockerfile',
        reason: '.dockerignore must exclude "Dockerfile" so Dockerfile runner edits do not invalidate build context.',
      });
    }
    if (entrypointIgnored) {
      violations.push({
        filePath: '.dockerignore',
        lineNumber: 1,
        lineContent: '',
        imageRef: 'docker-entrypoint.sh',
        reason: '.dockerignore must keep "docker-entrypoint.sh" unignored for the Dockerfile runner stage.',
      });
    }
  }

  // 2. Check docker-compose.yml (and docker-compose.ci.yml / docker-compose.rollout.yml if present)
  const composePath = path.join(rootDir, 'docker-compose.yml');
  const sharedLocalBuildImages = collectComposeLocalBuildImages(composePath);
  if (!fs.existsSync(composePath)) {
    violations.push({
      filePath: 'docker-compose.yml',
      lineNumber: 1,
      lineContent: '',
      imageRef: 'docker-compose.yml',
      reason: 'docker-compose.yml is missing from repository root.',
    });
  } else {
    checkDockerComposeFile(
      composePath,
      rootDir,
      violations,
      pinnedOccurrences,
      sharedLocalBuildImages
    );
  }

  const ciComposePath = path.join(rootDir, 'docker-compose.ci.yml');
  if (fs.existsSync(ciComposePath)) {
    checkDockerComposeFile(
      ciComposePath,
      rootDir,
      violations,
      pinnedOccurrences,
      sharedLocalBuildImages
    );
  }

  const rolloutComposePath = path.join(rootDir, 'docker-compose.rollout.yml');
  if (fs.existsSync(rolloutComposePath)) {
    checkDockerComposeFile(
      rolloutComposePath,
      rootDir,
      violations,
      pinnedOccurrences,
      sharedLocalBuildImages
    );
  }

  // 3. Check .github/workflows/*.yml
  const workflowsDir = path.join(rootDir, '.github', 'workflows');
  if (fs.existsSync(workflowsDir)) {
    const workflowFiles = fs
      .readdirSync(workflowsDir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .sort();
    for (const file of workflowFiles) {
      checkWorkflowImages(
        path.join(workflowsDir, file),
        rootDir,
        violations,
        pinnedOccurrences,
        expectedNodeMajor
      );
    }
  }

  // 4. Verify matching tags and @sha256 digests per external image repository across Dockerfile, docker-compose.yml, and .github/workflows/*.yml
  for (const [repositoryKey, occurrences] of pinnedOccurrences.entries()) {
    const canonical = occurrences[0];
    const canonicalNormalizedImage = normalizeImageKey(canonical.imageName);
    for (const occ of occurrences.slice(1)) {
      const occNormalizedImage = normalizeImageKey(occ.imageName);
      const tagDrifted = occNormalizedImage !== canonicalNormalizedImage;
      const digestDrifted = occ.digest !== canonical.digest;

      if (tagDrifted || digestDrifted) {
        let reason: string;
        if (tagDrifted && digestDrifted) {
          reason = `Image repository "${repositoryKey}" reference "${occNormalizedImage}@${occ.digest}" does not match "${canonicalNormalizedImage}@${canonical.digest}" at ${canonical.filePath}:${canonical.lineNumber}. All references to "${repositoryKey}" must share the same tag and @sha256 digest.`;
        } else if (tagDrifted) {
          reason = `Image repository "${repositoryKey}" tag "${occNormalizedImage}" does not match "${canonicalNormalizedImage}" at ${canonical.filePath}:${canonical.lineNumber}. All references to "${repositoryKey}" must share the same tag and @sha256 digest.`;
        } else {
          reason = `Image "${canonicalNormalizedImage}" digest "${occ.digest}" does not match "${canonical.digest}" at ${canonical.filePath}:${canonical.lineNumber}. All references to "${repositoryKey}" must share the same @sha256 digest.`;
        }

        violations.push({
          filePath: occ.filePath,
          lineNumber: occ.lineNumber,
          lineContent: occ.lineContent,
          imageRef: `${occ.imageName}@${occ.digest}`,
          reason,
        });
      }
    }
  }

  // 5. Check docker-entrypoint.sh
  const entrypointPath = path.join(rootDir, 'docker-entrypoint.sh');
  if (!fs.existsSync(entrypointPath)) {
    violations.push({
      filePath: 'docker-entrypoint.sh',
      lineNumber: 1,
      lineContent: '',
      imageRef: 'docker-entrypoint.sh',
      reason: 'docker-entrypoint.sh is missing from repository root.',
    });
  } else {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    if (/\bnpx\b/.test(entrypointContent)) {
      violations.push({
        filePath: 'docker-entrypoint.sh',
        lineNumber: 1,
        lineContent: '',
        imageRef: 'npx',
        reason: 'docker-entrypoint.sh must invoke ./node_modules/.bin/prisma offline without npx.',
      });
    }
    if (!entrypointContent.includes('./node_modules/.bin/prisma migrate deploy')) {
      violations.push({
        filePath: 'docker-entrypoint.sh',
        lineNumber: 1,
        lineContent: '',
        imageRef: './node_modules/.bin/prisma migrate deploy',
        reason: 'docker-entrypoint.sh must execute ./node_modules/.bin/prisma migrate deploy when RUN_MIGRATIONS=true or RUN_MIGRATIONS=1.',
      });
    }
    if (
      !/\[\s*"\$RUN_MIGRATIONS"\s*=\s*"true"\s*\]/.test(entrypointContent) ||
      !/\[\s*"\$RUN_MIGRATIONS"\s*=\s*"1"\s*\]/.test(entrypointContent)
    ) {
      violations.push({
        filePath: 'docker-entrypoint.sh',
        lineNumber: 1,
        lineContent: '',
        imageRef: 'RUN_MIGRATIONS=1',
        reason: 'docker-entrypoint.sh must accept both RUN_MIGRATIONS="true" and RUN_MIGRATIONS="1".',
      });
    }
    if (!entrypointContent.includes('NPM_CONFIG_UPDATE_NOTIFIER=false')) {
      violations.push({
        filePath: 'docker-entrypoint.sh',
        lineNumber: 1,
        lineContent: '',
        imageRef: 'NPM_CONFIG_UPDATE_NOTIFIER=false',
        reason: 'docker-entrypoint.sh must disable npm update checks via NPM_CONFIG_UPDATE_NOTIFIER=false.',
      });
    }
  }

  // 6. Check next.config.ts for output: 'standalone'
  const nextConfigPath = path.join(rootDir, 'next.config.ts');
  if (fs.existsSync(nextConfigPath)) {
    const configContent = fs.readFileSync(nextConfigPath, 'utf8');
    if (!configContent.includes("output: 'standalone'") && !configContent.includes('output: "standalone"')) {
      violations.push({
        filePath: 'next.config.ts',
        lineNumber: 1,
        lineContent: '',
        imageRef: 'output',
        reason: "next.config.ts must specify output: 'standalone' for provider-neutral deployment.",
      });
    }
  } else {
    violations.push({
      filePath: 'next.config.ts',
      lineNumber: 1,
      lineContent: '',
      imageRef: 'next.config.ts',
      reason: 'next.config.ts is missing.',
    });
  }

  // 7. Check standalone build artifacts (.next/standalone) when present from a production build or required (--require-standalone)
  validateStandaloneOutput(rootDir, requireStandalone, violations);

  // 8. Verify isolated Prisma CLI lockfile version parity and offline peerDependencies ranges across both lockfiles
  const rootLockPath = path.join(rootDir, 'package-lock.json');
  const cliLockPath = path.join(rootDir, 'docker', 'prisma-cli', 'package-lock.json');
  const cliPkgJsonPath = path.join(rootDir, 'docker', 'prisma-cli', 'package.json');

  const parseJsonManifest = (
    absPath: string
  ): {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    overrides?: Record<string, unknown>;
  } => {
    if (!fs.existsSync(absPath)) {
      return {};
    }
    try {
      return JSON.parse(fs.readFileSync(absPath, 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
        overrides?: Record<string, unknown>;
      };
    } catch {
      return {};
    }
  };

  let parsedRootLock: ParsedLockfile | null = null;
  let parsedCliLock: ParsedLockfile | null = null;

  if (fs.existsSync(rootLockPath)) {
    try {
      parsedRootLock = JSON.parse(fs.readFileSync(rootLockPath, 'utf8')) as ParsedLockfile;
      const rootManifest = parseJsonManifest(packageJsonPath);
      validateLockfilePeerDependencies(
        'package-lock.json',
        parsedRootLock,
        rootManifest.overrides,
        violations
      );
    } catch (err) {
      violations.push({
        filePath: 'package-lock.json',
        lineNumber: 1,
        lineContent: '',
        imageRef: 'package-lock.json',
        reason: `Failed to parse package-lock.json: ${(err as Error).message}`,
      });
    }
  }

  if (fs.existsSync(cliLockPath)) {
    try {
      parsedCliLock = JSON.parse(fs.readFileSync(cliLockPath, 'utf8')) as ParsedLockfile;
      const cliManifest = parseJsonManifest(cliPkgJsonPath);
      validateLockfilePeerDependencies(
        'docker/prisma-cli/package-lock.json',
        parsedCliLock,
        cliManifest.overrides,
        violations
      );
    } catch (err) {
      violations.push({
        filePath: 'docker/prisma-cli/package-lock.json',
        lineNumber: 1,
        lineContent: '',
        imageRef: 'package-lock.json',
        reason: `Failed to parse docker/prisma-cli/package-lock.json: ${(err as Error).message}`,
      });
    }
  }

  if (parsedRootLock && parsedCliLock) {
    for (const pkgKey of ['node_modules/prisma', 'node_modules/@prisma/config', 'node_modules/effect']) {
      const rootVersion = parsedRootLock.packages?.[pkgKey]?.version;
      const cliVersion = parsedCliLock.packages?.[pkgKey]?.version;
      if (rootVersion && cliVersion !== rootVersion) {
        const pkgName = pkgKey.replace(/^node_modules\//, '');
        violations.push({
          filePath: 'docker/prisma-cli/package-lock.json',
          lineNumber: 1,
          lineContent: '',
          imageRef: pkgName,
          reason: `docker/prisma-cli/package-lock.json pins "${pkgName}" to "${cliVersion ?? 'missing'}", which does not match "${rootVersion}" in package-lock.json.`,
        });
      }
    }
  }

  return { violations };
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

interface LockfilePackageNode {
  version?: string;
  resolved?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

interface ParsedLockfile {
  packages?: Record<string, LockfilePackageNode>;
}

function parseSemver(raw: string): ParsedSemver | null {
  const cleaned = raw.trim().replace(/^[=v]+/i, '');
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function compareSemver(a: ParsedSemver, b: ParsedSemver): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;

  const aPre = a.prerelease;
  const bPre = b.prerelease;
  if (aPre.length === 0 && bPre.length === 0) return 0;
  if (aPre.length === 0) return 1;
  if (bPre.length === 0) return -1;

  const len = Math.max(aPre.length, bPre.length);
  for (let i = 0; i < len; i++) {
    if (i >= aPre.length) return -1;
    if (i >= bPre.length) return 1;
    const idA = aPre[i];
    const idB = bPre[i];
    if (idA === idB) continue;
    const numA = /^\d+$/.test(idA);
    const numB = /^\d+$/.test(idB);
    if (numA && numB) {
      const diff = Number(idA) - Number(idB);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (numA) {
      return -1;
    } else if (numB) {
      return 1;
    } else {
      return idA < idB ? -1 : 1;
    }
  }
  return 0;
}

function parsePartialSemverParts(rawBody: string): {
  major: number | null;
  minor: number | null;
  patch: number | null;
  prerelease: string[];
} | null {
  const cleaned = rawBody.trim().replace(/^v/i, '');
  if (!cleaned || cleaned === '*' || cleaned.toLowerCase() === 'x') {
    return { major: null, minor: null, patch: null, prerelease: [] };
  }
  const match = cleaned.match(
    /^(\d+|x|X|\*)(?:\.(\d+|x|X|\*)(?:\.(\d+|x|X|\*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?)?)?$/
  );
  if (!match) {
    return null;
  }
  const toNum = (seg: string | undefined): number | null => {
    if (!seg || seg === '*' || seg.toLowerCase() === 'x') return null;
    return Number(seg);
  };
  const major = toNum(match[1]);
  const minor = major === null ? null : toNum(match[2]);
  const patch = minor === null ? null : toNum(match[3]);
  return {
    major,
    minor,
    patch,
    prerelease: patch !== null && match[4] ? match[4].split('.') : [],
  };
}

function evaluateSingleComparator(version: ParsedSemver, token: string): boolean {
  if (!token || token === '*' || token.toLowerCase() === 'x') {
    return true;
  }
  const opMatch = token.match(/^(>=|<=|>|<|=|\^|~)?(.*)$/);
  if (!opMatch) {
    return false;
  }
  const op = opMatch[1] ?? '';
  const parts = parsePartialSemverParts(opMatch[2]);
  if (!parts) {
    return false;
  }
  if (parts.major === null) {
    return true;
  }

  const zeroPre = ['0'];
  const lowerBound = (maj: number, min: number, pat: number, pre: string[] = []): ParsedSemver => ({
    major: maj,
    minor: min,
    patch: pat,
    prerelease: pre,
  });

  if (op === '' || op === '=') {
    if (parts.minor === null) {
      return (
        compareSemver(version, lowerBound(parts.major, 0, 0)) >= 0 &&
        compareSemver(version, lowerBound(parts.major + 1, 0, 0, zeroPre)) < 0
      );
    }
    if (parts.patch === null) {
      return (
        compareSemver(version, lowerBound(parts.major, parts.minor, 0)) >= 0 &&
        compareSemver(version, lowerBound(parts.major, parts.minor + 1, 0, zeroPre)) < 0
      );
    }
    return compareSemver(version, lowerBound(parts.major, parts.minor, parts.patch, parts.prerelease)) === 0;
  }

  if (op === '^') {
    if (parts.minor === null) {
      return (
        compareSemver(version, lowerBound(parts.major, 0, 0)) >= 0 &&
        compareSemver(version, lowerBound(parts.major + 1, 0, 0, zeroPre)) < 0
      );
    }
    if (parts.patch === null) {
      const upper =
        parts.major === 0
          ? lowerBound(0, parts.minor + 1, 0, zeroPre)
          : lowerBound(parts.major + 1, 0, 0, zeroPre);
      return compareSemver(version, lowerBound(parts.major, parts.minor, 0)) >= 0 && compareSemver(version, upper) < 0;
    }
    const lower = lowerBound(parts.major, parts.minor, parts.patch, parts.prerelease);
    const upper =
      parts.major > 0
        ? lowerBound(parts.major + 1, 0, 0, zeroPre)
        : parts.minor > 0
          ? lowerBound(0, parts.minor + 1, 0, zeroPre)
          : lowerBound(0, 0, parts.patch + 1, zeroPre);
    return compareSemver(version, lower) >= 0 && compareSemver(version, upper) < 0;
  }

  if (op === '~') {
    if (parts.minor === null) {
      return (
        compareSemver(version, lowerBound(parts.major, 0, 0)) >= 0 &&
        compareSemver(version, lowerBound(parts.major + 1, 0, 0, zeroPre)) < 0
      );
    }
    const lower = lowerBound(parts.major, parts.minor, parts.patch ?? 0, parts.prerelease);
    const upper = lowerBound(parts.major, parts.minor + 1, 0, zeroPre);
    return compareSemver(version, lower) >= 0 && compareSemver(version, upper) < 0;
  }

  if (op === '>=') {
    const target = lowerBound(parts.major, parts.minor ?? 0, parts.patch ?? 0, parts.prerelease);
    return compareSemver(version, target) >= 0;
  }

  if (op === '>') {
    if (parts.minor === null) {
      return compareSemver(version, lowerBound(parts.major + 1, 0, 0)) >= 0;
    }
    if (parts.patch === null) {
      return compareSemver(version, lowerBound(parts.major, parts.minor + 1, 0)) >= 0;
    }
    return compareSemver(version, lowerBound(parts.major, parts.minor, parts.patch, parts.prerelease)) > 0;
  }

  if (op === '<=') {
    if (parts.minor === null) {
      return compareSemver(version, lowerBound(parts.major + 1, 0, 0, zeroPre)) < 0;
    }
    if (parts.patch === null) {
      return compareSemver(version, lowerBound(parts.major, parts.minor + 1, 0, zeroPre)) < 0;
    }
    return compareSemver(version, lowerBound(parts.major, parts.minor, parts.patch, parts.prerelease)) <= 0;
  }

  if (op === '<') {
    if (parts.minor === null) {
      return compareSemver(version, lowerBound(parts.major, 0, 0, zeroPre)) < 0;
    }
    if (parts.patch === null) {
      return compareSemver(version, lowerBound(parts.major, parts.minor, 0, zeroPre)) < 0;
    }
    return compareSemver(version, lowerBound(parts.major, parts.minor, parts.patch, parts.prerelease)) < 0;
  }

  return false;
}

function expandHyphenRanges(branch: string): string {
  return branch.replace(/(\S+)\s+-\s+(\S+)/g, (_full, lowRaw: string, highRaw: string) => {
    const lowParts = parsePartialSemverParts(lowRaw);
    const highParts = parsePartialSemverParts(highRaw);
    const lowSuffix = lowParts && lowParts.prerelease.length > 0 ? `-${lowParts.prerelease.join('.')}` : '';
    const lowToken =
      lowParts && lowParts.major !== null
        ? `>=${lowParts.major}.${lowParts.minor ?? 0}.${lowParts.patch ?? 0}${lowSuffix}`
        : `>=${lowRaw}`;
    let highToken = `<=${highRaw}`;
    if (highParts) {
      if (highParts.major === null) {
        highToken = '*';
      } else if (highParts.minor === null) {
        highToken = `<${highParts.major + 1}.0.0`;
      } else if (highParts.patch === null) {
        highToken = `<${highParts.major}.${highParts.minor + 1}.0`;
      }
    }
    return `${lowToken} ${highToken}`;
  });
}

function satisfiesSemverRange(versionStr: string, rangeStr: string): boolean {
  const version = parseSemver(versionStr);
  if (!version) {
    return false;
  }
  const rawRange = rangeStr.trim();
  if (!rawRange || rawRange === '*') {
    return true;
  }
  const branches = rawRange.split('||');
  return branches.some((rawBranch) => {
    const withHyphens = expandHyphenRanges(rawBranch.trim());
    const normalized = withHyphens.replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1').trim();
    if (!normalized) {
      return true;
    }
    const tokens = normalized.split(/\s+/);
    return tokens.every((token) => evaluateSingleComparator(version, token));
  });
}

function extractPackageNameFromLockPath(pkgPath: string): string {
  const marker = 'node_modules/';
  const lastIdx = pkgPath.lastIndexOf(marker);
  return lastIdx === -1 ? pkgPath : pkgPath.slice(lastIdx + marker.length);
}

function resolvePeerInLockfile(
  packages: Record<string, LockfilePackageNode>,
  fromPkgPath: string,
  peerName: string
): { path: string; node: LockfilePackageNode } | null {
  let cursor = fromPkgPath;
  while (true) {
    const candidatePath = `${cursor ? `${cursor}/` : ''}node_modules/${peerName}`;
    const candidateNode = packages[candidatePath];
    if (candidateNode) {
      return { path: candidatePath, node: candidateNode };
    }
    const parentMarkerIdx = cursor.lastIndexOf('/node_modules/');
    if (parentMarkerIdx !== -1) {
      cursor = cursor.slice(0, parentMarkerIdx);
    } else if (cursor.startsWith('node_modules/')) {
      cursor = '';
    } else {
      break;
    }
  }
  return null;
}

function matchesOverrideSelectorKey(
  overrideKey: string,
  targetName: string,
  targetVersion: string | undefined
): boolean {
  if (overrideKey === targetName) {
    return true;
  }
  if (!overrideKey.startsWith(`${targetName}@`)) {
    return false;
  }
  if (!targetVersion) {
    return true;
  }
  const selectorRange = overrideKey.slice(targetName.length + 1).trim();
  return satisfiesSemverRange(targetVersion, selectorRange);
}

function isPeerOverriddenInManifest(
  overrides: Record<string, unknown> | undefined,
  pkgName: string,
  pkgVersion: string | undefined,
  peerName: string,
  resolvedPeerVersion: string
): boolean {
  if (!overrides) {
    return false;
  }
  for (const [key, val] of Object.entries(overrides)) {
    if (typeof val === 'string' && matchesOverrideSelectorKey(key, peerName, resolvedPeerVersion)) {
      return true;
    }
    if (
      val &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      matchesOverrideSelectorKey(key, pkgName, pkgVersion)
    ) {
      const nested = val as Record<string, unknown>;
      for (const nestedKey of Object.keys(nested)) {
        if (matchesOverrideSelectorKey(nestedKey, peerName, resolvedPeerVersion)) {
          return true;
        }
      }
    }
  }
  return false;
}

function validateLockfilePeerDependencies(
  lockRelPath: string,
  lockData: ParsedLockfile,
  manifestOverrides: Record<string, unknown> | undefined,
  violations: Violation[]
): void {
  const packages = lockData.packages;
  if (!packages) {
    return;
  }

  for (const [pkgPath, pkgNode] of Object.entries(packages)) {
    if (!pkgPath || !pkgNode.peerDependencies || pkgNode.resolved?.startsWith('file:')) {
      continue;
    }
    const pkgName = extractPackageNameFromLockPath(pkgPath);

    for (const [peerName, peerRange] of Object.entries(pkgNode.peerDependencies)) {
      const isOptional = pkgNode.peerDependenciesMeta?.[peerName]?.optional === true;
      const resolved = resolvePeerInLockfile(packages, pkgPath, peerName);

      if (!resolved || !resolved.node.version) {
        if (
          isOptional ||
          isPeerOverriddenInManifest(manifestOverrides, pkgName, pkgNode.version, peerName, '')
        ) {
          continue;
        }
        violations.push({
          filePath: lockRelPath,
          lineNumber: 1,
          lineContent: '',
          imageRef: `${pkgName} -> ${peerName}`,
          reason: `${lockRelPath} package "${pkgPath}" (${pkgNode.version ?? 'unknown'}) requires non-optional peerDependency "${peerName}@${peerRange}", which is missing from the lockfile graph.`,
        });
        continue;
      }

      if (resolved.node.resolved?.startsWith('file:')) {
        continue;
      }

      if (satisfiesSemverRange(resolved.node.version, peerRange)) {
        continue;
      }

      if (
        isPeerOverriddenInManifest(
          manifestOverrides,
          pkgName,
          pkgNode.version,
          peerName,
          resolved.node.version
        )
      ) {
        continue;
      }

      violations.push({
        filePath: lockRelPath,
        lineNumber: 1,
        lineContent: '',
        imageRef: `${pkgName} -> ${peerName}`,
        reason: `${lockRelPath} package "${pkgPath}" (${pkgNode.version ?? 'unknown'}) requires peerDependency "${peerName}@${peerRange}", which conflicts with resolved "${resolved.path}@${resolved.node.version}".`,
      });
    }
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const standaloneOnly = args.includes('--standalone-only');
  const requireStandalone = args.includes('--require-standalone') || standaloneOnly;
  const unknownFlags = args.filter(
    (arg) => arg !== '--require-standalone' && arg !== '--standalone-only'
  );
  if (unknownFlags.length > 0) {
    console.error(`❌ Unknown option(s) passed to check-docker-build.ts: ${unknownFlags.join(', ')}`);
    process.exit(1);
  }

  console.log(
    standaloneOnly
      ? '🔍 Checking .next/standalone output portability (--standalone-only)...'
      : '🔍 Checking standalone & container portability, digest pins, and APT cache rules...'
  );
  const { violations } = checkDockerBuild(ROOT_DIR, { requireStandalone, standaloneOnly });

  if (violations.length > 0) {
    console.error(`\n❌ Found ${violations.length} standalone or container configuration violation(s):\n`);
    violations.forEach((v, idx) => {
      console.error(`  [${idx + 1}] ${v.filePath}:${v.lineNumber}`);
      if (v.lineContent) {
        console.error(`      Line: "${v.lineContent}"`);
      }
      console.error(`      Reason: ${v.reason}\n`);
    });

    console.error(`
================================================================================
ACTIONABLE REMEDIATION:
--------------------------------------------------------------------------------
1. Pin all external container images across Dockerfile, docker-compose.yml, and
   .github/workflows/*.yml to matching multi-architecture @sha256:<64-hex> digests.
2. In Dockerfile APT RUN blocks, mount BuildKit caches for /var/cache/apt and
   /var/lib/apt, run "rm -f /etc/apt/apt.conf.d/docker-clean" before "apt-get",
   pass "--no-install-recommends" to "apt-get install", and do not delete
   "/var/lib/apt/lists/*" inside the cache mount.
3. Ensure next.config.ts contains output: 'standalone', and Dockerfile and
   docker-entrypoint.sh exist in the repository root.
4. Run 'npm run build' to generate the standalone build bundle at .next/standalone.
================================================================================
`);
    process.exit(1);
  }

  console.log('✅ Standalone & container portability, digest pin, and APT cache checks passed!');
  process.exit(0);
}

const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  (path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)) ||
    process.argv[1].endsWith('check-docker-build.ts') ||
    process.argv[1].endsWith('check-docker-build.js'));

if (isDirectExecution) {
  main();
}
