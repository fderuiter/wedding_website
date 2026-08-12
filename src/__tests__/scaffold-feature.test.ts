import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

describe('CLI Scaffolding Tool - Base Class Inheritance Alignment', () => {
  const featureName = 'scaffold-test-feature';
  const featureDir = path.join(__dirname, '..', 'features', featureName);

  beforeAll(() => {
    // Clean up if it somehow already exists
    if (fs.existsSync(featureDir)) {
      fs.rmSync(featureDir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    // Clean up after the test runs
    if (fs.existsSync(featureDir)) {
      fs.rmSync(featureDir, { recursive: true, force: true });
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

    // 3. Passes repository instance to parent constructor inside constructor
    expect(serviceContent).toContain('constructor() {');
    expect(serviceContent).toContain("super(new ScaffoldTestFeatureRepository(), 'ScaffoldTestFeature');");

    // 4. Omits manual CRUD operations
    expect(serviceContent).not.toContain('findMany(');
    expect(serviceContent).not.toContain('findById(');
    expect(serviceContent).not.toContain('create(');
    expect(serviceContent).not.toContain('update(');
    expect(serviceContent).not.toContain('delete(');
  });
});
