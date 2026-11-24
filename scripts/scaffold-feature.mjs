import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rawArgs = process.argv.slice(2);
let rootDir = path.resolve(__dirname, '..');
let featureName = '';

for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--root' && rawArgs[i + 1]) {
    rootDir = path.resolve(rawArgs[i + 1]);
    i++;
  } else if (!featureName && !rawArgs[i].startsWith('-')) {
    featureName = rawArgs[i];
  }
}

if (!featureName) {
  console.error('Please provide a feature name (kebab-case)');
  process.exit(1);
}

// Check for valid kebab-case naming
if (!/^[a-z0-9-]+$/.test(featureName)) {
  console.error('Feature name must be kebab-case');
  process.exit(1);
}

const pascalCase = featureName
  .split('-')
  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  .join('');
const camelCase = featureName
  .split('-')
  .map((word, index) => (index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
  .join('');
const featureDir = path.join(rootDir, 'src', 'features', featureName);

if (fs.existsSync(featureDir)) {
  console.error(`Feature ${featureName} already exists`);
  process.exit(1);
}

// Create directories
['api', 'components', 'hooks', 'lib', '__tests__'].forEach((dir) => {
  fs.mkdirSync(path.join(featureDir, dir), { recursive: true });
});

// Create files
fs.writeFileSync(
  path.join(featureDir, 'schemas.ts'),
  `import { z } from 'zod';\n\nexport const ${pascalCase}Schema = z.object({\n  id: z.string(),\n});\n`
);
fs.writeFileSync(
  path.join(featureDir, 'types.ts'),
  `export interface ${pascalCase} {\n  id: string;\n}\n`
);
fs.writeFileSync(
  path.join(featureDir, 'repository.ts'),
  `import { BaseRepository } from '@/core/infrastructure/repository';\nimport type { ${pascalCase} } from './types';\n\nexport class ${pascalCase}Repository extends BaseRepository<${pascalCase}> {\n  constructor() {\n    super('${camelCase}');\n  }\n}\n`
);
fs.writeFileSync(
  path.join(featureDir, 'service.ts'),
  `import { BaseService } from '@/core/infrastructure/service';\nimport { ${pascalCase}Repository } from './repository';\nimport { ${pascalCase}Schema } from './schemas';\nimport type { ${pascalCase} } from './types';\n\nexport class ${pascalCase}Service extends BaseService<${pascalCase}> {\n  constructor() {\n    super(new ${pascalCase}Repository(), '${pascalCase}', ${pascalCase}Schema);\n  }\n}\n`
);
fs.writeFileSync(
  path.join(featureDir, 'index.ts'),
  `export { ${pascalCase}Schema } from './schemas';\nexport { ${pascalCase}Repository } from './repository';\nexport type { ${pascalCase} } from './types';\nexport { ${pascalCase}Service } from './service';\n`
);
fs.writeFileSync(
  path.join(featureDir, '__tests__', `${featureName}.test.ts`),
  `import {\n  ${pascalCase}Repository,\n  ${pascalCase}Schema,\n  ${pascalCase}Service,\n  type ${pascalCase},\n} from '@/features/${featureName}';\n\ndescribe('${pascalCase} feature module', () => {\n  it('validates schema payloads and exposes repository and service', () => {\n    const record: ${pascalCase} = ${pascalCase}Schema.parse({ id: 'sample-id' });\n    expect(record.id).toBe('sample-id');\n    expect(new ${pascalCase}Repository()).toBeInstanceOf(${pascalCase}Repository);\n    expect(new ${pascalCase}Service()).toBeInstanceOf(${pascalCase}Service);\n  });\n});\n`
);

const featureModulesDocPath = path.join(rootDir, 'FEATURE_MODULES.md');
const generateDocsScriptPath = path.resolve(__dirname, 'generate-docs.ts');
const tsxCliPath = path.resolve(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

if (fs.existsSync(featureModulesDocPath) && fs.existsSync(generateDocsScriptPath)) {
  const syncSnippet = `import { updateFeatureModulesMd } from ${JSON.stringify(generateDocsScriptPath)}; updateFeatureModulesMd(process.argv[1]);`;
  if (fs.existsSync(tsxCliPath)) {
    execFileSync(process.execPath, [tsxCliPath, '-e', syncSnippet, rootDir], {
      cwd: rootDir,
      stdio: 'inherit',
    });
  } else {
    execFileSync('npx', ['tsx', '-e', syncSnippet, rootDir], {
      cwd: rootDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  }
}

console.log(`Successfully scaffolded feature ${featureName}`);
