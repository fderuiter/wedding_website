import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  schema?: Record<string, unknown>;
}

interface OpenApiOperation {
  summary: string;
  description: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    required?: boolean;
    content: Record<string, { schema: Record<string, unknown> }>;
  };
  security?: Array<Record<string, string[]>>;
  responses: Record<string, unknown>;
}

interface OpenApiDocument {
  openapi: string;
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

  it('discovers all 69 route files (.ts and .tsx) and 96 HTTP operations including GET /api/og', () => {
    expect(openapi.openapi).toBe('3.0.3');

    const routePaths = Object.keys(openapi.paths);
    expect(routePaths).toHaveLength(69);

    const operations = getAllOperations();
    expect(operations).toHaveLength(96);

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

  it('emits requestBody contracts for all 53 body operations including all 9 previously missing operations', () => {
    const operations = getAllOperations();
    const bodyOperations = operations.filter(({ operation }) => Boolean(operation.requestBody));
    expect(bodyOperations).toHaveLength(53);

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

  it('defines components.securitySchemes across all 88 protected operations and query parameters across all 17 query operations', () => {
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
    expect(protectedOps).toHaveLength(88);

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
});
