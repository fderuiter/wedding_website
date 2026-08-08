import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function checkGitRepo() {
  try {
    const gitDir = path.join(__dirname, '../.git');
    if (fs.existsSync(gitDir)) {
      return true;
    }
    const isInside = execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' }).toString().trim();
    return isInside === 'true';
  } catch {
    return false;
  }
}

if (!checkGitRepo()) {
  console.log('Not inside a Git repository. Skipping Git hooks configuration.');
  process.exit(0);
}

try {
  console.log('Configuring local Git hooks path...');
  execSync('git config core.hooksPath .githooks', { stdio: 'inherit' });
  console.log('Successfully configured Git hooks path to .githooks');

  // Set executable permissions on .githooks/pre-commit natively
  const preCommitPath = path.join(__dirname, '../.githooks/pre-commit');
  if (fs.existsSync(preCommitPath)) {
    fs.chmodSync(preCommitPath, 0o755);
    console.log('Successfully set executable permissions on .githooks/pre-commit');
  } else {
    console.warn('Warning: .githooks/pre-commit not found.');
  }
} catch (err) {
  console.error('Failed to configure Git hooks:', err.message);
  process.exit(1);
}
