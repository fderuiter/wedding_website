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

  const normalizedKey = normalizeImageKey(imageName);
  const existing = pinnedOccurrences.get(normalizedKey) ?? [];
  existing.push({
    filePath,
    lineNumber,
    lineContent,
    imageName,
    digest: digest.toLowerCase(),
  });
  pinnedOccurrences.set(normalizedKey, existing);
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
  if (!/COPY\s+--from=prisma-cli\b[^\n]*\/opt\/prisma-cli/.test(dockerfileContent)) {
    violations.push({
      filePath: relPath,
      lineNumber: 1,
      lineContent: '',
      imageRef: '/opt/prisma-cli',
      reason: 'Dockerfile runner stage must copy the isolated Prisma CLI directory (/opt/prisma-cli).',
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
  let foundNodeBaseImage = false;
  let currentStage: string | null = null;
  let hasBuilderStage = false;
  let seenBuilderNpmCi = false;
  let builderNpmCiLine = 1;
  let seenBuilderBuildDocker = false;
  const builderCopiedBeforeNpmCi: string[] = [];
  const builderCopiedAfterNpmCi = new Set<string>();

  for (const instr of instructions) {
    const fromMatch = instr.text.match(/^FROM\s+(.*)$/i);
    if (fromMatch) {
      const rest = fromMatch[1].trim();
      const parsedFrom = rest.match(/^(?:--\S+\s+)*(\S+)(?:\s+AS\s+([a-zA-Z0-9._-]+))?\s*$/i);
      if (parsedFrom) {
        const imageSpec = parsedFrom[1];
        const stageAlias = parsedFrom[2];
        const lowerImage = imageSpec.toLowerCase();

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
          currentStage = normalizedAlias;
          if (normalizedAlias === 'builder') {
            hasBuilderStage = true;
          }
        } else {
          currentStage = null;
        }
      }
      continue;
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
        'next-env.d.ts',
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

function checkDockerComposeFile(
  composePath: string,
  baseDir: string,
  violations: Violation[],
  pinnedOccurrences: Map<string, PinnedImageOccurrence[]>
): void {
  const relPath = path.relative(baseDir, composePath).replace(/\\/g, '/');
  const content = fs.readFileSync(composePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const lineCounter = new LineCounter();
  const doc = parseDocument(content, { version: '1.2', strict: true, lineCounter });

  recordYamlDiagnostics(doc, relPath, lines, violations);

  if (relPath === 'docker-compose.yml') {
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
            'docker-compose.yml must remain provider-neutral and omit GitHub Actions BuildKit cache backends ("type=gha"); move CI cache_from overrides to docker-compose.ci.yml.',
        });
      }
      if (/\bGHA_CACHE_SCOPE\b/.test(trimmed)) {
        violations.push({
          filePath: relPath,
          lineNumber: idx + 1,
          lineContent: trimmed,
          imageRef: 'GHA_CACHE_SCOPE',
          reason:
            'docker-compose.yml must omit "GHA_CACHE_SCOPE"; isolate CI cache scope configuration in docker-compose.ci.yml.',
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

  if (relPath === 'docker-compose.ci.yml') {
    for (const requiredService of ['migration', 'app']) {
      const svcNode = servicesNode.get(requiredService, true);
      const buildNode = isMap(svcNode) ? svcNode.get('build', true) : undefined;
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
          imageRef: `${requiredService}.build.cache_from`,
          reason: `docker-compose.ci.yml service "${requiredService}" must configure build.cache_from with "type=gha,scope=\${GHA_CACHE_SCOPE:-app-amd64}".`,
        });
      }

      const cacheToNode = isMap(buildNode) ? buildNode.get('cache_to', true) : undefined;
      if (cacheToNode !== undefined) {
        const offset = isMap(cacheToNode) || isSeq(cacheToNode) || isScalar(cacheToNode)
          ? (cacheToNode.range?.[0] ?? 0)
          : 0;
        const lineNumber = lineCounter.linePos(offset).line;
        violations.push({
          filePath: relPath,
          lineNumber,
          lineContent: (lines[lineNumber - 1] ?? '').trim(),
          imageRef: `${requiredService}.build.cache_to`,
          reason: `docker-compose.ci.yml service "${requiredService}" must not configure build.cache_to.`,
        });
      }
    }
  }

  for (const svcPair of servicesNode.items) {
    const svcMap = svcPair.value;
    if (!isMap(svcMap)) {
      continue;
    }

    // Skip local Compose services that build from source (e.g. migration and app)
    const buildNode = svcMap.get('build', true);
    if (buildNode !== undefined && (!isScalar(buildNode) || buildNode.value !== null)) {
      continue;
    }

    const imageNode = svcMap.get('image', true);
    if (isScalar(imageNode) && typeof imageNode.value === 'string') {
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

export function checkDockerBuild(rootDir: string = ROOT_DIR): {
  violations: Violation[];
} {
  const violations: Violation[] = [];
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
        engines?: { node?: string };
        devEngines?: { runtime?: { name?: string; version?: string } };
        devDependencies?: Record<string, string>;
      };
      const enginesNode = pkg.engines?.node ?? '';
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

      const devRuntimeVersion = pkg.devEngines?.runtime?.version;
      if (devRuntimeVersion !== undefined) {
        const devNodeMajor = parseLeadingMajorVersion(devRuntimeVersion);
        if (!devNodeMajor || (expectedNodeMajor && devNodeMajor !== expectedNodeMajor)) {
          violations.push({
            filePath: 'package.json',
            lineNumber: 1,
            lineContent: `"version": "${devRuntimeVersion}"`,
            imageRef: 'devEngines.runtime.version',
            reason: `package.json devEngines.runtime.version ("${devRuntimeVersion}") does not match .nvmrc ("${expectedNodeMajor ?? 'unknown'}").`,
          });
        }
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

  // 2. Check docker-compose.yml (and docker-compose.ci.yml if present)
  const composePath = path.join(rootDir, 'docker-compose.yml');
  if (!fs.existsSync(composePath)) {
    violations.push({
      filePath: 'docker-compose.yml',
      lineNumber: 1,
      lineContent: '',
      imageRef: 'docker-compose.yml',
      reason: 'docker-compose.yml is missing from repository root.',
    });
  } else {
    checkDockerComposeFile(composePath, rootDir, violations, pinnedOccurrences);
  }

  const ciComposePath = path.join(rootDir, 'docker-compose.ci.yml');
  if (fs.existsSync(ciComposePath)) {
    checkDockerComposeFile(ciComposePath, rootDir, violations, pinnedOccurrences);
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

  // 4. Verify matching @sha256 digests across Dockerfile, docker-compose.yml, and .github/workflows/*.yml
  for (const [normalizedImage, occurrences] of pinnedOccurrences.entries()) {
    const canonical = occurrences[0];
    for (const occ of occurrences.slice(1)) {
      if (occ.digest !== canonical.digest) {
        violations.push({
          filePath: occ.filePath,
          lineNumber: occ.lineNumber,
          lineContent: occ.lineContent,
          imageRef: `${occ.imageName}@${occ.digest}`,
          reason: `Image "${normalizedImage}" digest "${occ.digest}" does not match "${canonical.digest}" at ${canonical.filePath}:${canonical.lineNumber}. All references to "${normalizedImage}" must share the same @sha256 digest.`,
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
      !/RUN_MIGRATIONS[^\n]*"true"/.test(entrypointContent) ||
      !/RUN_MIGRATIONS[^\n]*"1"/.test(entrypointContent)
    ) {
      violations.push({
        filePath: 'docker-entrypoint.sh',
        lineNumber: 1,
        lineContent: '',
        imageRef: 'RUN_MIGRATIONS',
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

  // 7. Check if build was executed and generated standalone directory
  const standaloneDir = path.join(rootDir, '.next', 'standalone');
  if (fs.existsSync(path.join(rootDir, '.next'))) {
    if (!fs.existsSync(standaloneDir)) {
      violations.push({
        filePath: '.next/standalone',
        lineNumber: 1,
        lineContent: '',
        imageRef: '.next/standalone',
        reason: '.next directory exists but .next/standalone was not generated. Ensure Next.js build produces standalone output.',
      });
    } else {
      const serverJs = path.join(standaloneDir, 'server.js');
      if (!fs.existsSync(serverJs)) {
        violations.push({
          filePath: '.next/standalone/server.js',
          lineNumber: 1,
          lineContent: '',
          imageRef: 'server.js',
          reason: '.next/standalone/server.js is missing.',
        });
      }
      if (fs.existsSync(path.join(standaloneDir, 'public', 'public'))) {
        violations.push({
          filePath: '.next/standalone/public/public',
          lineNumber: 1,
          lineContent: '',
          imageRef: 'public/public',
          reason: '.next/standalone/public/public nested copy detected.',
        });
      }
      if (fs.existsSync(path.join(standaloneDir, 'public', 'mockServiceWorker.js'))) {
        violations.push({
          filePath: '.next/standalone/public/mockServiceWorker.js',
          lineNumber: 1,
          lineContent: '',
          imageRef: 'mockServiceWorker.js',
          reason: '.next/standalone/public/mockServiceWorker.js must not be bundled in standalone output.',
        });
      }
    }
  }

  return { violations };
}

function main(): void {
  console.log('🔍 Checking standalone & container portability, digest pins, and APT cache rules...');

  const { violations } = checkDockerBuild(ROOT_DIR);

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
