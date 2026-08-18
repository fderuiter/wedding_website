import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

describe('AST Method Scope Disambiguation and Expanded Registry in OpenAPI Generator', () => {
  const openapiPath = path.resolve(process.cwd(), 'public/openapi.json');

  beforeAll(() => {
    // Regenerate OpenAPI specification
    execSync('npx tsx scripts/generate-openapi.ts', { stdio: 'inherit' });
  });

  it('correctly assigns DatabaseBackupSchema to POST /api/admin/maintenance/import instead of ImportBackupSchema', () => {
    const openapi = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
    const importRoute = openapi.paths['/api/admin/maintenance/import'];

    expect(importRoute).toBeDefined();
    expect(importRoute.post).toBeDefined();
    expect(importRoute.post.requestBody).toBeDefined();

    const schema = importRoute.post.requestBody.content['application/json'].schema;
    expect(schema).toBeDefined();
    expect(schema.properties).toBeDefined();

    // DatabaseBackupSchema defines detailed schemas for appConfig items rather than empty items
    expect(schema.properties.appConfig).toBeDefined();
    expect(schema.properties.appConfig.items).toBeDefined();
    expect(schema.properties.appConfig.items.properties).toBeDefined();
    expect(schema.properties.appConfig.items.properties.brideName).toBeDefined();
    expect(schema.properties.appConfig.items.properties.groomName).toBeDefined();

    expect(schema.properties.contentNode).toBeDefined();
    expect(schema.properties.registryItem).toBeDefined();
    expect(schema.properties.weddingPartyMember).toBeDefined();
    expect(schema.properties.attraction).toBeDefined();
    expect(schema.properties.contributor).toBeDefined();
  });

  it('scopes schema resolution per method handler on multi-method routes', () => {
    const openapi = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
    const entityRoute = openapi.paths['/api/admin/{entity}'];

    expect(entityRoute).toBeDefined();
    expect(entityRoute.post).toBeDefined();
    expect(entityRoute.post.requestBody).toBeDefined();

    expect(entityRoute.put).toBeDefined();
    expect(entityRoute.put.requestBody).toBeDefined();

    const postSchema = entityRoute.post.requestBody.content['application/json'].schema;
    const putSchema = entityRoute.put.requestBody.content['application/json'].schema;

    // POST /api/admin/[entity] uses AdminEntityCreateSchema (record schema)
    expect(postSchema.type).toBe('object');

    // PUT /api/admin/[entity] uses AdminEntityReorderSchema
    expect(putSchema.properties).toBeDefined();
    expect(putSchema.properties.action).toBeDefined();
    expect(putSchema.properties.orderedIds).toBeDefined();
  });

  it('does not assign a request body schema to POST routes that do not accept a request payload', () => {
    const openapi = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
    const restoreRoute = openapi.paths['/api/admin/versions/{id}/restore'];

    expect(restoreRoute).toBeDefined();
    expect(restoreRoute.post).toBeDefined();
    expect(restoreRoute.post.requestBody).toBeUndefined();
  });
});
