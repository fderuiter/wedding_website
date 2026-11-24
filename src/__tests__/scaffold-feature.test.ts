import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

describe('CLI Scaffolding Tool - Base Class Inheritance Alignment', () => {
  const featureName = 'scaffold-test-feature';
  const rootDir = path.join(__dirname, '..', '..');
  const featureDir = path.join(__dirname, '..', 'features', featureName);
  const featureModulesDocPath = path.join(rootDir, 'FEATURE_MODULES.md');
  let originalFeatureModulesMd = '';

  beforeAll(() => {
    originalFeatureModulesMd = fs.readFileSync(featureModulesDocPath, 'utf8');
    // Clean up if it somehow already exists
    if (fs.existsSync(featureDir)) {
      fs.rmSync(featureDir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    // Clean up after the test runs and restore FEATURE_MODULES.md
    if (fs.existsSync(featureDir)) {
      fs.rmSync(featureDir, { recursive: true, force: true });
    }
    if (originalFeatureModulesMd) {
      fs.writeFileSync(featureModulesDocPath, originalFeatureModulesMd, 'utf8');
    }
  });

  it('generates a working feature that implements BaseRepository and BaseService', () => {
    // Run the CLI scaffolding script via node subprocess
    const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'scaffold-feature.mjs');
    const output = execSync(`node ${scriptPath} ${featureName}`).toString();

    expect(output).toContain(`Successfully scaffolded feature ${featureName}`);
    expect(fs.existsSync(featureDir)).toBe(true);

    // Verify repository.ts
    const repoPath = path.join(featureDir, 'repository.ts');
    expect(fs.existsSync(repoPath)).toBe(true);
    const repoContent = fs.readFileSync(repoPath, 'utf8');

    // 1. Omit broken interface imports
    expect(repoContent).not.toContain('@/core/infrastructure/interfaces');
    expect(repoContent).not.toContain('IRepository');

    // 2. Extends BaseRepository
    expect(repoContent).toContain("import { BaseRepository } from '@/core/infrastructure/repository';");
    expect(repoContent).toContain('class ScaffoldTestFeatureRepository extends BaseRepository<ScaffoldTestFeature>');

    // 3. Omits manual CRUD operations
    expect(repoContent).not.toContain('findMany');
    expect(repoContent).not.toContain('findUnique');
    expect(repoContent).not.toContain('create');
    expect(repoContent).not.toContain('update');
    expect(repoContent).not.toContain('delete');

    // 4. Instantiates modelName as camelCase of the kebab-case featureName
    expect(repoContent).toContain("super('scaffoldTestFeature');");

    // Verify service.ts
    const servicePath = path.join(featureDir, 'service.ts');
    expect(fs.existsSync(servicePath)).toBe(true);
    const serviceContent = fs.readFileSync(servicePath, 'utf8');

    // 1. Omit broken interface imports & audit snapshot imports since BaseService handles it
    expect(serviceContent).not.toContain('@/core/infrastructure/interfaces');
    expect(serviceContent).not.toContain('IService');
    expect(serviceContent).not.toContain('createAuditSnapshot');

    // 2. Extends BaseService
    expect(serviceContent).toContain("import { BaseService } from '@/core/infrastructure/service';");
    expect(serviceContent).toContain('class ScaffoldTestFeatureService extends BaseService<ScaffoldTestFeature>');

    // 3. Passes repository instance and schema to parent constructor inside constructor
    expect(serviceContent).toContain('constructor() {');
    expect(serviceContent).toContain(
      "super(new ScaffoldTestFeatureRepository(), 'ScaffoldTestFeature', ScaffoldTestFeatureSchema);"
    );

    // 4. Omits manual CRUD operations
    expect(serviceContent).not.toContain('findMany(');
    expect(serviceContent).not.toContain('findById(');
    expect(serviceContent).not.toContain('create(');
    expect(serviceContent).not.toContain('update(');
    expect(serviceContent).not.toContain('delete(');

    // Verify index.ts uses explicit named value and type exports rather than wildcard re-exports
    const indexPath = path.join(featureDir, 'index.ts');
    expect(fs.existsSync(indexPath)).toBe(true);
    const indexContent = fs.readFileSync(indexPath, 'utf8');
    expect(indexContent).not.toContain('export *');
    expect(indexContent).toContain("export { ScaffoldTestFeatureSchema } from './schemas';");
    expect(indexContent).toContain("export { ScaffoldTestFeatureRepository } from './repository';");
    expect(indexContent).toContain("export type { ScaffoldTestFeature } from './types';");
    expect(indexContent).toContain("export { ScaffoldTestFeatureService } from './service';");

    // Verify starter barrel test file is generated for Knip compliance
    const starterTestPath = path.join(featureDir, '__tests__', `${featureName}.test.ts`);
    expect(fs.existsSync(starterTestPath)).toBe(true);
    expect(fs.readFileSync(starterTestPath, 'utf8')).toContain(`@/features/${featureName}`);

    // Verify FEATURE_MODULES.md was automatically synchronized with the new feature barrel
    const updatedFeatureModulesMd = fs.readFileSync(featureModulesDocPath, 'utf8');
    expect(updatedFeatureModulesMd).toContain(
      `| \`${featureName}\` | \`src/features/${featureName}/index.ts\` |`
    );
  });
});
