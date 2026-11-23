import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const exportRootDir = path.join(rootDir, '.next-export');
const exportCacheDir = path.join(exportRootDir, 'cache');
const rootOutDir = path.join(rootDir, 'out');

const ROOT_FILES_TO_STAGE = [
  'package.json',
  'next.config.ts',
  'postcss.config.mjs',
  'tsconfig.json',
  'tsconfig.build.json',
  'next-env.d.ts',
];

let stageDir = null;
let cacheMovedIntoStage = false;
let cleanedUp = false;

function moveOrCopyDir(sourceDir, targetDir) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  try {
    fs.renameSync(sourceDir, targetDir);
  } catch {
    fs.cpSync(sourceDir, targetDir, { recursive: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
}

function persistStageCache() {
  if (!stageDir) {
    return;
  }
  const stagedCacheDir = path.join(stageDir, '.next', 'cache');
  if (fs.existsSync(stagedCacheDir)) {
    try {
      moveOrCopyDir(stagedCacheDir, exportCacheDir);
      cacheMovedIntoStage = false;
    } catch (err) {
      console.error('Failed to persist static export build cache:', err);
    }
  }
}

function cleanup() {
  if (cleanedUp) {
    return;
  }
  cleanedUp = true;

  if (cacheMovedIntoStage) {
    persistStageCache();
  }

  if (stageDir && fs.existsSync(stageDir)) {
    try {
      fs.rmSync(stageDir, { recursive: true, force: true });
    } catch (err) {
      console.error('Failed to remove staged export workspace:', err);
    }
  }
}

function handleSignal(signal) {
  cleanup();
  process.exit(signal === 'SIGINT' ? 130 : 143);
}

process.on('SIGINT', () => handleSignal('SIGINT'));
process.on('SIGTERM', () => handleSignal('SIGTERM'));
process.on('SIGHUP', () => handleSignal('SIGHUP'));
process.on('exit', () => cleanup());

function stageWorkspace() {
  fs.mkdirSync(exportRootDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(exportRootDir, 'stage-'));

  for (const relFile of ROOT_FILES_TO_STAGE) {
    const srcPath = path.join(rootDir, relFile);
    if (fs.existsSync(srcPath)) {
      fs.cpSync(srcPath, path.join(dir, relFile));
    }
  }

  const publicSrc = path.join(rootDir, 'public');
  if (fs.existsSync(publicSrc)) {
    fs.cpSync(publicSrc, path.join(dir, 'public'), { recursive: true });
  }

  const srcSourceDir = path.join(rootDir, 'src');
  const srcTargetDir = path.join(dir, 'src');
  fs.cpSync(srcSourceDir, srcTargetDir, {
    recursive: true,
    filter: (sourcePath) => {
      const rel = path.relative(srcSourceDir, sourcePath).replace(/\\/g, '/');
      return rel !== 'app/api' && !rel.startsWith('app/api/');
    },
  });

  if (fs.existsSync(exportCacheDir)) {
    const stagedNextCacheDir = path.join(dir, '.next', 'cache');
    moveOrCopyDir(exportCacheDir, stagedNextCacheDir);
    cacheMovedIntoStage = true;
  }

  return dir;
}

function resolveStagedExportOutput(dir) {
  const candidates = [
    path.join(dir, '.next-export'),
    path.join(dir, 'out'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  return null;
}

try {
  stageDir = stageWorkspace();

  const nextBin = path.join(
    rootDir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'next.cmd' : 'next'
  );

  const child = spawn(nextBin, ['build'], {
    cwd: stageDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      STATIC_EXPORT: 'true',
    },
  });

  child.on('error', (err) => {
    cleanup();
    console.error('Failed to spawn next build:', err);
    process.exit(1);
  });

  child.on('close', (code) => {
    const exitCode = code ?? 1;
    if (exitCode !== 0) {
      cleanup();
      process.exit(exitCode);
    }

    try {
      persistStageCache();
      const stagedExportDir = resolveStagedExportOutput(stageDir);
      if (!stagedExportDir) {
        throw new Error('Static export completed without generating index.html in staged output.');
      }
      moveOrCopyDir(stagedExportDir, rootOutDir);
    } catch (copyErr) {
      cleanup();
      console.error('Failed to finalize static export output:', copyErr);
      process.exit(1);
    }

    cleanup();
    process.exit(0);
  });
} catch (error) {
  cleanup();
  console.error('Export build failed:', error);
  process.exit(1);
}
