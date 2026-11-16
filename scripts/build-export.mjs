import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const apiDir = path.join(rootDir, 'src', 'app', 'api');
const backupDir = path.join(rootDir, '.api-backup-export');

let moved = false;

function restore() {
  if (moved && fs.existsSync(backupDir)) {
    try {
      if (fs.existsSync(apiDir)) {
        fs.rmSync(apiDir, { recursive: true, force: true });
      }
      fs.renameSync(backupDir, apiDir);
      moved = false;
    } catch (err) {
      console.error('Failed to restore API directory:', err);
    }
  }
}

function handleSignal(signal) {
  restore();
  process.exit(signal === 'SIGINT' ? 130 : 143);
}

process.on('SIGINT', () => handleSignal('SIGINT'));
process.on('SIGTERM', () => handleSignal('SIGTERM'));
process.on('SIGHUP', () => handleSignal('SIGHUP'));
process.on('exit', () => restore());

try {
  if (fs.existsSync(apiDir)) {
    if (fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
    fs.renameSync(apiDir, backupDir);
    moved = true;
  }

  const nextBin = path.join(rootDir, 'node_modules', '.bin', 'next');
  const child = spawn(nextBin, ['build'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      STATIC_EXPORT: 'true',
    },
  });

  child.on('error', (err) => {
    restore();
    console.error('Failed to spawn next build:', err);
    process.exit(1);
  });

  child.on('close', (code) => {
    restore();
    process.exit(code ?? 0);
  });
} catch (error) {
  restore();
  console.error('Export build failed:', error);
  process.exit(1);
}
