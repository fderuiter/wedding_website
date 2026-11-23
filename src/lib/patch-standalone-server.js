import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

const standaloneDir = path.join(rootDir, '.next', 'standalone');
const standaloneServerPath = path.join(standaloneDir, 'server.js');
const sourceHelperPath = path.join(__dirname, 'socket-ip-boundary.js');
const targetHelperDir = path.join(standaloneDir, 'src', 'lib');
const targetHelperPath = path.join(targetHelperDir, 'socket-ip-boundary.js');

const PATCH_MARKER = '/* wedding_website:socket-ip-boundary */';

if (fs.existsSync(standaloneServerPath) && fs.existsSync(sourceHelperPath)) {
  fs.mkdirSync(targetHelperDir, { recursive: true });
  fs.copyFileSync(sourceHelperPath, targetHelperPath);

  const serverContent = fs.readFileSync(standaloneServerPath, 'utf8');
  if (!serverContent.includes(PATCH_MARKER)) {
    const usesEsmImport = /^\s*import\s+/m.test(serverContent);
    const preamble = usesEsmImport
      ? `${PATCH_MARKER}\nimport { installHttpSocketIpBoundary } from './src/lib/socket-ip-boundary.js';\ninstallHttpSocketIpBoundary();\n`
      : `${PATCH_MARKER}\nimport('./src/lib/socket-ip-boundary.js').then((m) => m.installHttpSocketIpBoundary());\n`;

    fs.writeFileSync(standaloneServerPath, `${preamble}${serverContent}`, 'utf8');
  }
}
