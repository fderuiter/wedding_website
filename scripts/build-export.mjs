import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(SCRIPT_DIR, '..');

const ROOT_CONFIG_FILES = [
  'package.json',
  'next.config.ts',
  'postcss.config.mjs',
  'tsconfig.json',
  'tsconfig.build.json',
];

export function restoreLegacyApiBackup(targetRoot = rootDir) {
  const apiDir = path.join(targetRoot, 'src', 'app', 'api');
  const legacyBackupDir = path.join(targetRoot, '.api-backup-export');
  if (!fs.existsSync(apiDir) && fs.existsSync(legacyBackupDir)) {
    fs.mkdirSync(path.dirname(apiDir), { recursive: true });
    fs.renameSync(legacyBackupDir, apiDir);
    return true;
  }
  return false;
}

export function stageExportWorkspace(targetRoot = rootDir) {
  restoreLegacyApiBackup(targetRoot);

  const stageDir = path.join(targetRoot, '.next', 'export-stage');
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  for (const relFile of ROOT_CONFIG_FILES) {
    const srcFile = path.join(targetRoot, relFile);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, path.join(stageDir, relFile));
    }
  }

  const assetsDir = path.join(targetRoot, 'assets');
  if (fs.existsSync(assetsDir)) {
    fs.cpSync(assetsDir, path.join(stageDir, 'assets'), { recursive: true });
  }

  const publicDir = path.join(targetRoot, 'public');
  if (fs.existsSync(publicDir)) {
    const uploadsDir = path.resolve(publicDir, 'uploads');
    const mockWorkerPath = path.resolve(publicDir, 'mockServiceWorker.js');
    fs.cpSync(publicDir, path.join(stageDir, 'public'), {
      recursive: true,
      filter: (sourcePath) => {
        const resolved = path.resolve(sourcePath);
        if (resolved === mockWorkerPath) {
          return false;
        }
        if (resolved === uploadsDir || resolved.startsWith(`${uploadsDir}${path.sep}`)) {
          return false;
        }
        return true;
      },
    });
  }

  const srcDir = path.join(targetRoot, 'src');
  if (fs.existsSync(srcDir)) {
    const apiDir = path.resolve(srcDir, 'app', 'api');
    fs.cpSync(srcDir, path.join(stageDir, 'src'), {
      recursive: true,
      filter: (sourcePath) => {
        const resolved = path.resolve(sourcePath);
        if (resolved === apiDir || resolved.startsWith(`${apiDir}${path.sep}`)) {
          return false;
        }
        return true;
      },
    });
  }

  return stageDir;
}

export function promoteStagedExportOutput(
  targetRoot = rootDir,
  stageDir = path.join(targetRoot, '.next', 'export-stage')
) {
  const stagedOutDir = path.join(stageDir, 'out');
  const rootOutDir = path.join(targetRoot, 'out');

  if (!fs.existsSync(stagedOutDir)) {
    throw new Error(`Expected static export output directory at ${stagedOutDir}`);
  }

  fs.rmSync(rootOutDir, { recursive: true, force: true });
  try {
    fs.renameSync(stagedOutDir, rootOutDir);
  } catch {
    fs.cpSync(stagedOutDir, rootOutDir, { recursive: true });
    fs.rmSync(stagedOutDir, { recursive: true, force: true });
  }
  return rootOutDir;
}

export function cleanupExportStage(targetRoot = rootDir) {
  const stageDir = path.join(targetRoot, '.next', 'export-stage');
  if (fs.existsSync(stageDir)) {
    try {
      fs.rmSync(stageDir, { recursive: true, force: true });
    } catch (err) {
      console.error('Failed to clean up export staging directory:', err);
    }
  }
}

function runBuildExport(targetRoot = rootDir) {
  let cleaned = false;
  const cleanup = () => {
    if (!cleaned) {
      cleaned = true;
      cleanupExportStage(targetRoot);
    }
  };

  const onSigint = () => {
    cleanup();
    process.exit(130);
  };
  const onSigterm = () => {
    cleanup();
    process.exit(143);
  };
  const onSighup = () => {
    cleanup();
    process.exit(143);
  };

  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
  process.on('SIGHUP', onSighup);
  process.on('exit', cleanup);

  try {
    const stageDir = stageExportWorkspace(targetRoot);
    const nextBin = path.join(
      targetRoot,
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
      try {
        if (code === 0) {
          promoteStagedExportOutput(targetRoot, stageDir);
        }
      } catch (err) {
        console.error('Failed to promote static export output:', err);
        cleanup();
        process.exit(1);
        return;
      }
      cleanup();
      process.exit(code ?? 0);
    });
  } catch (error) {
    cleanup();
    console.error('Export build failed:', error);
    process.exit(1);
  }
}

const isDirectCall =
  typeof process.argv[1] === 'string' &&
  process.argv[1].endsWith('build-export.mjs');

if (isDirectCall) {
  runBuildExport();
}
