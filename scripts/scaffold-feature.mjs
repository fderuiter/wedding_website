import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const featureName = process.argv[2];

if (!featureName) {
  console.error('Please provide a feature name (kebab-case)');
  process.exit(1);
}

// Check for valid kebab-case naming
if (!/^[a-z0-9-]+$/.test(featureName)) {
  console.error('Feature name must be kebab-case');
  process.exit(1);
}

const pascalCase = featureName.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('');
const featureDir = path.join(__dirname, '..', 'src', 'features', featureName);

if (fs.existsSync(featureDir)) {
  console.error(`Feature ${featureName} already exists`);
  process.exit(1);
}

// Create directories
['api', 'components', 'hooks', 'lib'].forEach(dir => {
  fs.mkdirSync(path.join(featureDir, dir), { recursive: true });
});

// Create files
fs.writeFileSync(path.join(featureDir, 'schemas.ts'), `import { z } from 'zod';\n\nexport const ${pascalCase}Schema = z.object({\n  id: z.string(),\n});\n`);
fs.writeFileSync(path.join(featureDir, 'types.ts'), `export interface ${pascalCase} {\n  id: string;\n}\n`);
fs.writeFileSync(path.join(featureDir, 'repository.ts'), `import { IRepository } from '@/core/infrastructure/interfaces';\nimport { prisma } from '@/lib/prisma';\nimport { ${pascalCase} } from './types';\n\nexport class ${pascalCase}Repository implements IRepository<${pascalCase}> {\n  async findMany(args?: any) { return (prisma as any).${featureName.replace(/-/g, '')}.findMany(args); }\n  async findUnique(id: string) { return (prisma as any).${featureName.replace(/-/g, '')}.findUnique({ where: { id } }); }\n  async create(data: any) { return (prisma as any).${featureName.replace(/-/g, '')}.create({ data }); }\n  async update(id: string, data: any) { return (prisma as any).${featureName.replace(/-/g, '')}.update({ where: { id }, data }); }\n  async delete(id: string) { return (prisma as any).${featureName.replace(/-/g, '')}.delete({ where: { id } }); }\n}\n`);
fs.writeFileSync(path.join(featureDir, 'service.ts'), `import { IService } from '@/core/infrastructure/interfaces';\nimport { ${pascalCase}Repository } from './repository';\nimport { ${pascalCase} } from './types';\nimport { createAuditSnapshot } from '@/lib/audit';\n\nexport class ${pascalCase}Service implements IService<${pascalCase}> {\n  constructor(private repo: ${pascalCase}Repository) {}\n\n  async findMany(args?: any) { return this.repo.findMany(args); }\n  async findById(id: string) { return this.repo.findUnique(id); }\n  async create(data: any, author: string = 'System') {\n    const record = await this.repo.create(data);\n    await createAuditSnapshot('${pascalCase}', record.id, record, author);\n    return record;\n  }\n  async update(id: string, data: any, author: string = 'System') {\n    const record = await this.repo.update(id, data);\n    await createAuditSnapshot('${pascalCase}', record.id, record, author);\n    return record;\n  }\n  async delete(id: string, author?: string) {\n    return this.repo.delete(id);\n  }\n}\n`);
fs.writeFileSync(path.join(featureDir, 'index.ts'), `export * from './types';\nexport * from './schemas';\nexport * from './repository';\nexport * from './service';\n`);

console.log(`Successfully scaffolded feature ${featureName}`);
