import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  schema?: Record<string, unknown>;
}

interface OpenApiResponseObject {
  description: string;
  content?: Record<string, { schema: Record<string, unknown> }>;
}

interface OpenApiOperation {
  tags?: string[];
  summary: string;
  description: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    required?: boolean;
    content: Record<string, { schema: Record<string, unknown> }>;
  };
  security?: Array<Record<string, string[]>>;
  responses: Record<string, OpenApiResponseObject>;
}

interface OpenApiDocument {
  openapi: string;
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, Record<string, unknown>>;
  components?: {
    securitySchemes?: Record<string, Record<string, unknown>>;
  };
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

function collectSchemaViolations(node: unknown, pointer = ''): string[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => collectSchemaViolations(item, `${pointer}[${index}]`));
  }

  const record = node as Record<string, unknown>;
  const violations: string[] = [];

  for (const forbiddenKey of ['$schema', 'const', 'propertyNames']) {
    if (Object.prototype.hasOwnProperty.call(record, forbiddenKey)) {
      violations.push(`${pointer}.${forbiddenKey}`);
    }
  }

  if (Array.isArray(record.type)) {
    violations.push(`${pointer}.type(array)`);
  }

  for (const [key, value] of Object.entries(record)) {
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [propName, propSchema] of Object.entries(value as Record<string, unknown>)) {
        violations.push(...collectSchemaViolations(propSchema, `${pointer}.properties.${propName}`));
      }
    } else {
      violations.push(...collectSchemaViolations(value, `${pointer}.${key}`));
    }
  }

  return violations;
}

function countNullableProperties(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  if (Array.isArray(node)) {
    return node.reduce((sum, item) => sum + countNullableProperties(item), 0);
  }

  const record = node as Record<string, unknown>;
  let count = record.nullable === true ? 1 : 0;
  for (const value of Object.values(record)) {
    count += countNullableProperties(value);
  }
  return count;
}

describe('Upgraded OpenAPI 3.0.3 AST Generator', () => {
  const openapiPath = path.resolve(process.cwd(), 'public/openapi.json');
  let openapi: OpenApiDocument;

  beforeAll(() => {
    execSync('npx tsx scripts/generate-openapi.ts', { stdio: 'inherit' });
    openapi = JSON.parse(fs.readFileSync(openapiPath, 'utf8')) as OpenApiDocument;
  });

  function getAllOperations(): Array<{
    routePath: string;
    method: string;
    operation: OpenApiOperation;
  }> {
    const operations: Array<{
      routePath: string;
      method: string;
      operation: OpenApiOperation;
    }> = [];

    for (const [routePath, pathItem] of Object.entries(openapi.paths)) {
      for (const method of HTTP_METHODS) {
        const op = pathItem[method];
        if (op && typeof op === 'object') {
          operations.push({
            routePath,
            method: method.toUpperCase(),
            operation: op as OpenApiOperation,
          });
        }
      }
    }

    return operations;
  }

  it('discovers all 70 route files (.ts and .tsx) and 97 HTTP operations including GET /api/og', () => {
    expect(openapi.openapi).toBe('3.0.3');

    const routePaths = Object.keys(openapi.paths);
    expect(routePaths).toHaveLength(70);

    const operations = getAllOperations();
    expect(operations).toHaveLength(97);

    const ogRoute = openapi.paths['/api/og'];
    expect(ogRoute).toBeDefined();
    const ogGet = ogRoute.get as OpenApiOperation;
    expect(ogGet).toBeDefined();

    const ogQueryNames = (ogGet.parameters ?? [])
      .filter((param) => param.in === 'query')
      .map((param) => param.name);

    expect(ogQueryNames).toEqual(expect.arrayContaining(['p1', 'p2', 'title', 'primary', 'secondary']));
    expect(ogQueryNames).toHaveLength(5);
  });

  it('omits JSON Schema Draft 2020-12 keywords across all requestBody and parameter schemas and uses nullable: true', () => {
    const operations = getAllOperations();
    const violations: string[] = [];
    let nullableCount = 0;

    for (const { routePath, method, operation } of operations) {
      if (operation.requestBody) {
        for (const [mediaType, mediaObj] of Object.entries(operation.requestBody.content)) {
          violations.push(
            ...collectSchemaViolations(mediaObj.schema, `${method} ${routePath} [${mediaType}]`)
          );
          nullableCount += countNullableProperties(mediaObj.schema);
        }
      }

      for (const param of operation.parameters ?? []) {
        if (param.schema) {
          violations.push(
            ...collectSchemaViolations(param.schema, `${method} ${routePath} param:${param.name}`)
          );
        }
      }
    }

    expect(violations).toEqual([]);
    expect(nullableCount).toBeGreaterThan(0);
  });

  it('emits requestBody contracts for all 54 body operations including all 9 previously missing operations', () => {
    const operations = getAllOperations();
    const bodyOperations = operations.filter(({ operation }) => Boolean(operation.requestBody));
    expect(bodyOperations).toHaveLength(54);

    const previouslyMissingOps = [
      { routePath: '/api/admin/{entity}/batch', method: 'post', expectedProps: ['ids'] },
      { routePath: '/api/admin/{entity}/batch', method: 'put', expectedProps: ['ids'] },
      { routePath: '/api/admin/{entity}/batch', method: 'patch', expectedProps: ['ids'] },
      { routePath: '/api/admin/{entity}/batch', method: 'delete', expectedProps: ['ids'] },
      { routePath: '/api/admin/invitation-codes/batch', method: 'put', expectedProps: ['ids'] },
      { routePath: '/api/admin/invitation-codes/batch', method: 'patch', expectedProps: ['ids'] },
      { routePath: '/api/admin/invitation-codes/batch', method: 'delete', expectedProps: ['ids'] },
      { routePath: '/api/media/export', method: 'post', expectedProps: ['ids', 'tag', 'category'] },
      { routePath: '/api/registry/webhook/stripe', method: 'post', expectedProps: ['type', 'data'] },
    ];

    for (const { routePath, method, expectedProps } of previouslyMissingOps) {
      const op = openapi.paths[routePath]?.[method] as OpenApiOperation | undefined;
      expect(op).toBeDefined();
      expect(op?.requestBody).toBeDefined();

      const jsonSchema = op?.requestBody?.content['application/json']?.schema as
        | { properties?: Record<string, unknown> }
        | undefined;
      expect(jsonSchema).toBeDefined();
      expect(jsonSchema?.properties).toBeDefined();

      for (const prop of expectedProps) {
        expect(jsonSchema?.properties?.[prop]).toBeDefined();
      }
    }
  });

  it('emits multipart/form-data with format: binary on file properties for all 3 upload endpoints', () => {
    const adminUpload = openapi.paths['/api/admin/upload']?.post as OpenApiOperation;
    expect(adminUpload.requestBody?.content['multipart/form-data']).toBeDefined();
    expect(adminUpload.requestBody?.content['application/json']).toBeUndefined();

    const adminUploadProps = adminUpload.requestBody?.content['multipart/form-data'].schema
      .properties as Record<string, Record<string, unknown>>;
    expect(adminUploadProps.file).toEqual({ type: 'string', format: 'binary' });

    for (const photoUploadPath of ['/api/guest/photos/upload', '/api/photos/upload']) {
      const uploadOp = openapi.paths[photoUploadPath]?.post as OpenApiOperation;
      expect(uploadOp.requestBody?.content['multipart/form-data']).toBeDefined();
      expect(uploadOp.requestBody?.content['application/json']).toBeUndefined();

      const props = uploadOp.requestBody?.content['multipart/form-data'].schema.properties as Record<
        string,
        Record<string, unknown>
      >;
      expect(props.files).toEqual({
        minItems: 1,
        maxItems: 10,
        type: 'array',
        items: { type: 'string', format: 'binary' },
      });
    }
  });

  it('documents POST /api/admin/setup with password, sampleArchetype, sampleModules, and optional setup fields', () => {
    const setupPost = openapi.paths['/api/admin/setup']?.post as OpenApiOperation;
    expect(setupPost).toBeDefined();
    expect(setupPost.requestBody).toBeDefined();

    const schema = setupPost.requestBody?.content['application/json']?.schema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    expect(schema.properties).toBeDefined();
    expect(schema.properties?.password).toBeDefined();
    expect(schema.properties?.sampleArchetype).toBeDefined();
    expect(schema.properties?.sampleModules).toBeDefined();
    expect(schema.properties?.partner1Name).toBeDefined();
    expect(schema.properties?.weddingDate).toBeDefined();

    expect(schema.required ?? []).toHaveLength(0);
  });

  it('defines components.securitySchemes across all 89 protected operations and query parameters across all 17 query operations', () => {
    const schemes = openapi.components?.securitySchemes;
    expect(schemes).toBeDefined();
    expect(schemes?.adminCookieAuth).toEqual(
      expect.objectContaining({ type: 'apiKey', in: 'cookie', name: 'admin_auth' })
    );
    expect(schemes?.guestCookieAuth).toEqual(
      expect.objectContaining({ type: 'apiKey', in: 'cookie', name: 'guest_auth' })
    );
    expect(schemes?.guestInviteCookieAuth).toEqual(
      expect.objectContaining({ type: 'apiKey', in: 'cookie', name: 'guest_invite_session' })
    );
    expect(schemes?.cronBearerAuth).toEqual(
      expect.objectContaining({ type: 'http', scheme: 'bearer' })
    );
    expect(schemes?.stripeSignature).toEqual(
      expect.objectContaining({ type: 'apiKey', in: 'header', name: 'stripe-signature' })
    );

    const operations = getAllOperations();
    const protectedOps = operations.filter(
      ({ operation }) => Array.isArray(operation.security) && operation.security.length > 0
    );
    expect(protectedOps).toHaveLength(89);

    const unprotectedOpKeys = operations
      .filter(({ operation }) => !operation.security || operation.security.length === 0)
      .map(({ method, routePath }) => `${method} ${routePath}`)
      .sort();

    expect(unprotectedOpKeys).toEqual([
      'GET /api/admin/setup',
      'GET /api/health',
      'GET /api/ready',
      'GET /api/registry/validate-code',
      'POST /api/admin/login',
      'POST /api/admin/setup',
      'POST /api/guest/address/public',
      'POST /api/guest/login',
    ]);

    // Verify specific security perimeter mappings
    expect((openapi.paths['/api/cron/broadcasts']?.post as OpenApiOperation).security).toEqual([
      { cronBearerAuth: [] },
    ]);
    expect((openapi.paths['/api/registry/webhook/stripe']?.post as OpenApiOperation).security).toEqual([
      { stripeSignature: [] },
    ]);
    expect((openapi.paths['/api/guest/address']?.get as OpenApiOperation).security).toEqual([
      { guestInviteCookieAuth: [] },
    ]);
    expect((openapi.paths['/api/photos/upload']?.post as OpenApiOperation).security).toEqual([
      { guestCookieAuth: [] },
      { guestInviteCookieAuth: [] },
      { adminCookieAuth: [] },
    ]);

    // Verify 17 query operations
    const queryOps = operations.filter(({ operation }) =>
      (operation.parameters ?? []).some((param) => param.in === 'query')
    );
    expect(queryOps).toHaveLength(17);

    // Shared handler GET /api/media/export has query params whereas POST /api/media/export does not
    const mediaExportGetParams = (openapi.paths['/api/media/export']?.get as OpenApiOperation)
      .parameters ?? [];
    const mediaExportPostParams = (openapi.paths['/api/media/export']?.post as OpenApiOperation)
      .parameters ?? [];
    expect(mediaExportGetParams.filter((p) => p.in === 'query').map((p) => p.name)).toEqual(
      expect.arrayContaining(['ids', 'tag', 'category'])
    );
    expect(mediaExportPostParams.filter((p) => p.in === 'query')).toHaveLength(0);
  });

  it('eliminates empty {} properties, typeless nullable fields, and empty {} anyOf branches across all schemas', () => {
    const emptyProperties: string[] = [];
    const typelessNullables: string[] = [];
    const emptyAnyOfBranches: string[] = [];

    function walkSchema(node: unknown, pointer: string) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach((item, index) => walkSchema(item, `${pointer}[${index}]`));
        return;
      }

      const record = node as Record<string, unknown>;
      if (
        record.nullable === true &&
        !record.type &&
        !Array.isArray(record.anyOf) &&
        !Array.isArray(record.oneOf)
      ) {
        typelessNullables.push(pointer);
      }

      if (Array.isArray(record.anyOf)) {
        record.anyOf.forEach((branch, index) => {
          if (branch && typeof branch === 'object' && Object.keys(branch).length === 0) {
            emptyAnyOfBranches.push(`${pointer}.anyOf[${index}]`);
          }
        });
      }

      if (record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)) {
        for (const [propName, propVal] of Object.entries(record.properties as Record<string, unknown>)) {
          if (propVal && typeof propVal === 'object' && Object.keys(propVal).length === 0) {
            emptyProperties.push(`${pointer}.properties.${propName}`);
          }
          walkSchema(propVal, `${pointer}.properties.${propName}`);
        }
      }

      for (const [key, val] of Object.entries(record)) {
        if (key !== 'properties') {
          walkSchema(val, `${pointer}.${key}`);
        }
      }
    }

    for (const { routePath, method, operation } of getAllOperations()) {
      for (const param of operation.parameters ?? []) {
        walkSchema(param.schema, `${method} ${routePath} param:${param.name}`);
      }
      if (operation.requestBody) {
        for (const [mediaType, mediaObj] of Object.entries(operation.requestBody.content)) {
          walkSchema(mediaObj.schema, `${method} ${routePath} [${mediaType}]`);
        }
      }
      for (const [status, resObj] of Object.entries(operation.responses)) {
        for (const [mediaType, mediaObj] of Object.entries(resObj.content ?? {})) {
          walkSchema(mediaObj.schema, `${method} ${routePath} response:${status}[${mediaType}]`);
        }
      }
    }

    expect(emptyProperties).toEqual([]);
    expect(typelessNullables).toEqual([]);
    expect(emptyAnyOfBranches).toEqual([]);
  });

  it('serializes backup dates, typed FeatureSchema/JSON fields, and required backup keys on maintenance import and features routes', () => {
    const importOp = openapi.paths['/api/admin/maintenance/import']?.post as OpenApiOperation;
    const importSchema = importOp.requestBody?.content['application/json']?.schema as {
      required?: string[];
      properties?: Record<string, any>;
    };

    expect(importSchema.required).toEqual(['appConfig', 'registryItem']);

    const appConfigProps = importSchema.properties?.appConfig?.items?.properties;
    expect(appConfigProps?.createdAt).toEqual({ type: 'string', format: 'date-time' });
    expect(appConfigProps?.weddingDate).toEqual(
      expect.objectContaining({ type: 'string', format: 'date-time' })
    );
    expect(appConfigProps?.features?.type).toBe('array');
    expect(appConfigProps?.features?.items?.required).toEqual(['id', 'type']);

    const contentNodeData = importSchema.properties?.contentNode?.items?.properties?.data;
    expect(contentNodeData?.type).toBe('object');

    const snapshotData = importSchema.properties?.snapshotVersion?.items?.properties?.data;
    expect(snapshotData?.type).toBe('object');

    const subEventStart = importSchema.properties?.subEvent?.items?.properties?.startTime;
    expect(subEventStart).toEqual({ type: 'string', format: 'date-time', nullable: true });

    const featuresPut = openapi.paths['/api/admin/features']?.put as OpenApiOperation;
    const featuresSchema = featuresPut.requestBody?.content['application/json']?.schema as {
      properties?: Record<string, any>;
    };
    expect(featuresSchema.properties?.features?.items?.properties?.id).toEqual({ type: 'string' });
    expect(featuresSchema.properties?.features?.items?.properties?.type).toEqual({ type: 'string' });
  });

  it('emits multi-branch oneOf schemas for POST /api/rsvp and POST /api/admin/invitation-codes/batch', () => {
    const rsvpPost = openapi.paths['/api/rsvp']?.post as OpenApiOperation;
    const rsvpSchema = rsvpPost.requestBody?.content['application/json']?.schema as {
      oneOf?: Array<{ properties?: Record<string, unknown> }>;
    };
    expect(rsvpSchema.oneOf).toHaveLength(2);
    expect(
      rsvpSchema.oneOf?.some((branch) => Boolean(branch.properties?.rsvps))
    ).toBe(true);
    expect(
      rsvpSchema.oneOf?.some((branch) => Boolean(branch.properties?.subEventId))
    ).toBe(true);

    const inviteBatchPost = openapi.paths['/api/admin/invitation-codes/batch']
      ?.post as OpenApiOperation;
    const inviteBatchSchema = inviteBatchPost.requestBody?.content['application/json']?.schema as {
      oneOf?: Array<{ properties?: Record<string, unknown> }>;
    };
    expect(inviteBatchSchema.oneOf).toHaveLength(3);
    expect(
      inviteBatchSchema.oneOf?.some(
        (branch) => Boolean(branch.properties?.ids && !branch.properties?.tags)
      )
    ).toBe(true);
    expect(
      inviteBatchSchema.oneOf?.some(
        (branch) => Boolean(branch.properties?.ids && branch.properties?.tags && branch.properties?.action)
      )
    ).toBe(true);
    expect(
      inviteBatchSchema.oneOf?.some((branch) => Boolean(branch.properties?.records))
    ).toBe(true);
  });

  it('documents POST /api/admin/settings with optional id and zero required defaulted fields', () => {
    const settingsPost = openapi.paths['/api/admin/settings']?.post as OpenApiOperation;
    const settingsSchema = settingsPost.requestBody?.content['application/json']?.schema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    expect(settingsSchema.properties?.id).toEqual({ type: 'string', minLength: 1 });
    expect(settingsSchema.required ?? []).toHaveLength(0);

    const settingsPut = openapi.paths['/api/admin/settings']?.put as OpenApiOperation;
    const putSchema = settingsPut.requestBody?.content['application/json']?.schema as {
      required?: string[];
    };
    expect((putSchema.required ?? []).length).toBeGreaterThanOrEqual(19);
  });

  it('emits {entity} path enums on all 10 admin entity operations and 7-branch oneOf schemas on entity POST/PUT', () => {
    const expectedSlugs = [
      'content-nodes',
      'wedding-party',
      'attractions',
      'registry-items',
      'invitation-codes',
      'seating-tables',
      'sub-events',
    ];

    const entityOps = getAllOperations().filter(({ operation }) =>
      (operation.parameters ?? []).some((p) => p.in === 'path' && p.name === 'entity')
    );
    expect(entityOps).toHaveLength(10);

    for (const { operation } of entityOps) {
      const entityParam = operation.parameters?.find((p) => p.in === 'path' && p.name === 'entity');
      expect(entityParam?.schema).toEqual({
        type: 'string',
        enum: expectedSlugs,
      });
    }

    const entityCreateSchema = (openapi.paths['/api/admin/{entity}']?.post as OpenApiOperation)
      .requestBody?.content['application/json']?.schema as {
      type?: string;
      oneOf?: unknown[];
    };
    expect(entityCreateSchema.type).toBe('object');
    expect(entityCreateSchema.oneOf).toHaveLength(7);

    const entityUpdateSchema = (openapi.paths['/api/admin/{entity}/{id}']?.put as OpenApiOperation)
      .requestBody?.content['application/json']?.schema as {
      type?: string;
      oneOf?: unknown[];
    };
    expect(entityUpdateSchema.type).toBe('object');
    expect(entityUpdateSchema.oneOf).toHaveLength(7);
  });

  it('documents 201 Created responses on creation routes and explicit response media types on all 8 export operations', () => {
    for (const creationPath of [
      '/api/guest/photos/upload',
      '/api/media',
      '/api/admin/{entity}',
      '/api/admin/invitation-codes/batch',
    ]) {
      const postOp = openapi.paths[creationPath]?.post as OpenApiOperation;
      expect(postOp.responses['201']).toEqual(
        expect.objectContaining({ description: 'Created' })
      );
    }

    const batchPostOp = openapi.paths['/api/admin/invitation-codes/batch']?.post as OpenApiOperation;
    expect(batchPostOp.responses['200']).toBeDefined();
    expect(batchPostOp.responses['201']).toBeDefined();

    const expectedExportMedia: Array<{
      routePath: string;
      method: 'get' | 'post';
      mediaTypes: string[];
    }> = [
      { routePath: '/api/admin/seating/export', method: 'get', mediaTypes: ['application/pdf', 'text/csv'] },
      { routePath: '/api/admin/invitation-codes/export', method: 'get', mediaTypes: ['text/csv'] },
      { routePath: '/api/admin/thank-you-notes/export', method: 'get', mediaTypes: ['text/csv'] },
      { routePath: '/api/admin/thank-you-notes/export-labels', method: 'get', mediaTypes: ['application/pdf'] },
      { routePath: '/api/media/export', method: 'get', mediaTypes: ['application/zip'] },
      { routePath: '/api/media/export', method: 'post', mediaTypes: ['application/zip'] },
      { routePath: '/api/schedule/{id}/ics', method: 'get', mediaTypes: ['text/calendar'] },
      { routePath: '/api/og', method: 'get', mediaTypes: ['image/png'] },
    ];

    for (const { routePath, method, mediaTypes } of expectedExportMedia) {
      const op = openapi.paths[routePath]?.[method] as OpenApiOperation;
      const content = op.responses['200']?.content ?? {};
      expect(Object.keys(content).sort()).toEqual([...mediaTypes].sort());
    }
  });

  it('defines top-level domain tags and assigns declared tags across all 97 operations', () => {
    expect(Array.isArray(openapi.tags)).toBe(true);
    expect((openapi.tags ?? []).length).toBeGreaterThanOrEqual(12);

    const declaredTags = new Set((openapi.tags ?? []).map((t) => t.name));
    const operations = getAllOperations();
    expect(operations).toHaveLength(97);

    for (const { operation } of operations) {
      expect(Array.isArray(operation.tags)).toBe(true);
      expect((operation.tags ?? []).length).toBeGreaterThan(0);
      for (const tag of operation.tags ?? []) {
        expect(declaredTags.has(tag)).toBe(true);
      }
    }
  });
});
