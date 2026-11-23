import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

const standaloneDir = path.join(rootDir, '.next', 'standalone');
const standaloneServerPath = path.join(standaloneDir, 'server.js');
const sourceHelperPath = path.join(__dirname, 'socket-ip-boundary.js');
const targetHelperPath = path.join(standaloneDir, 'socket-ip-boundary.js');

const PATCH_MARKER = '/* wedding_website:socket-ip-boundary */';

if (fs.existsSync(standaloneServerPath) && fs.existsSync(sourceHelperPath)) {
  fs.copyFileSync(sourceHelperPath, targetHelperPath);

  const serverContent = fs.readFileSync(standaloneServerPath, 'utf8');
  if (!serverContent.includes(PATCH_MARKER)) {
    const usesEsmImport = /^\s*import\s+/m.test(serverContent);
    const preamble = usesEsmImport
      ? `${PATCH_MARKER}\nimport { installHttpSocketIpBoundary } from './socket-ip-boundary.js';\ninstallHttpSocketIpBoundary();\n`
      : `${PATCH_MARKER}\nimport('./socket-ip-boundary.js').then((m) => m.installHttpSocketIpBoundary());\n`;

    fs.writeFileSync(standaloneServerPath, `${preamble}${serverContent}`, 'utf8');
  }
}
