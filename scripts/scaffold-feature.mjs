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
const camelCase = featureName.split('-').map((word, index) => index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)).join('');
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
fs.writeFileSync(path.join(featureDir, 'repository.ts'), `import { BaseRepository } from '@/core/infrastructure/repository';\nimport { ${pascalCase} } from './types';\n\nexport class ${pascalCase}Repository extends BaseRepository<${pascalCase}> {\n  constructor() {\n    super('${camelCase}');\n  }\n}\n`);
fs.writeFileSync(path.join(featureDir, 'service.ts'), `import { BaseService } from '@/core/infrastructure/service';\nimport { ${pascalCase}Repository } from './repository';\nimport { ${pascalCase} } from './types';\n\nexport class ${pascalCase}Service extends BaseService<${pascalCase}> {\n  constructor() {\n    super(new ${pascalCase}Repository(), '${pascalCase}');\n  }\n}\n`);
fs.writeFileSync(path.join(featureDir, 'index.ts'), 'export * from \'./types\';\nexport * from \'./schemas\';\nexport * from \'./repository\';\nexport * from \'./service\';\n');

console.log(`Successfully scaffolded feature ${featureName}`);
