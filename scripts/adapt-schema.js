import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const schemaPath = path.join(rootDir, 'prisma', 'schema.prisma');
const backupPath = path.join(rootDir, 'prisma', 'schema.prisma.backup');

export function adapt() {
  const dbUrl = process.env.DATABASE_URL || '';
  const isSqlite = dbUrl.startsWith('file:') || dbUrl.startsWith('sqlite:') || dbUrl.includes('.db');

  if (isSqlite) {
    console.log('Adapting Prisma schema for SQLite...');
    if (!fs.existsSync(schemaPath)) {
      console.error('schema.prisma not found!');
      return;
    }
    // Backup if not already backed up
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(schemaPath, backupPath);
    }
    let content = fs.readFileSync(backupPath, 'utf8');
    
    // Replace provider
    content = content.replace(/provider\s*=\s*"postgresql"/g, 'provider = "sqlite"');
    
    // Replace NOW() with now()
    content = content.replace(/@default\(dbgenerated\("NOW\(\)"\)\)/g, '@default(now())');
    
    // Replace tags String[] with tags Json
    content = content.replace(/tags\s+String\[\]/g, 'tags      Json');
    
    fs.writeFileSync(schemaPath, content, 'utf8');
    console.log('Schema successfully adapted for SQLite.');
  } else {
    restore();
  }
}

export function restore() {
  if (fs.existsSync(backupPath)) {
    console.log('Restoring original Prisma schema for PostgreSQL...');
    fs.copyFileSync(backupPath, schemaPath);
    fs.unlinkSync(backupPath);
    console.log('Original schema restored.');
  }
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === 'restore') {
    restore();
  } else {
    adapt();
  }
}
