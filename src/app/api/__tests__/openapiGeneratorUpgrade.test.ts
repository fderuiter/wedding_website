/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { z } from 'zod';
import {
  AdminEntityCreateSchema,
  AdminEntityUpdateSchema,
} from '@/utils/adminEntitySchemas';

interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  schema?: Record<string, unknown>;
}

interface OpenApiResponseObject {
  description: string;
  headers?: Record<string, Record<string, unknown>>;
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
  servers?: Array<{ url: string; description?: string }>;
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, Record<string, unknown>>;
  components?: {
    securitySchemes?: Record<string, Record<string, unknown>>;
    schemas?: Record<string, Record<string, unknown>>;
  };
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head'] as const;

function resolveJsonPointer(root: Record<string, unknown>, ref: string): Record<string, unknown> {
  const clean = ref.replace(/^[^#]*#\//, '');
  const parts = clean
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current: unknown = root;
  for (const part of parts) {
    if (!current || typeof current !== 'object') {
      throw new Error(`Unresolvable $ref: ${ref}`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (!current || typeof current !== 'object') {
    throw new Error(`Invalid target for $ref: ${ref}`);
  }
  return current as Record<string, unknown>;
}

function validateOpenApiSchema(
  schemaNode: Record<string, unknown>,
  value: unknown,
  rootDoc: Record<string, unknown>
): boolean {
  if (typeof schemaNode.$ref === 'string') {
    return validateOpenApiSchema(resolveJsonPointer(rootDoc, schemaNode.$ref), value, rootDoc);
  }

  if (value === null) {
    return schemaNode.nullable === true;
  }

  if (Array.isArray(schemaNode.enum)) {
    if (!schemaNode.enum.includes(value)) return false;
  }

  if (typeof schemaNode.type === 'string') {
    switch (schemaNode.type) {
      case 'string':
        if (typeof value !== 'string') return false;
        if (typeof schemaNode.minLength === 'number' && value.length < schemaNode.minLength) return false;
        if (typeof schemaNode.maxLength === 'number' && value.length > schemaNode.maxLength) return false;
        break;
      case 'number':
      case 'integer':
        if (typeof value !== 'number' || Number.isNaN(value)) return false;
        if (schemaNode.type === 'integer' && !Number.isInteger(value)) return false;
        if (typeof schemaNode.minimum === 'number') {
          if (schemaNode.exclusiveMinimum === true ? value <= schemaNode.minimum : value < schemaNode.minimum) {
            return false;
          }
        }
        if (typeof schemaNode.maximum === 'number') {
          if (schemaNode.exclusiveMaximum === true ? value >= schemaNode.maximum : value > schemaNode.maximum) {
            return false;
          }
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') return false;
        break;
      case 'array':
        if (!Array.isArray(value)) return false;
        if (typeof schemaNode.minItems === 'number' && value.length < schemaNode.minItems) return false;
        if (typeof schemaNode.maxItems === 'number' && value.length > schemaNode.maxItems) return false;
        if (schemaNode.items && typeof schemaNode.items === 'object' && !Array.isArray(schemaNode.items)) {
          for (const item of value) {
            if (!validateOpenApiSchema(schemaNode.items as Record<string, unknown>, item, rootDoc)) {
              return false;
            }
          }
        }
        break;
      case 'object':
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        break;
      default:
        break;
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(schemaNode.required)) {
      for (const reqKey of schemaNode.required) {
        if (typeof reqKey === 'string' && (!Object.prototype.hasOwnProperty.call(obj, reqKey) || obj[reqKey] === undefined)) {
          return false;
        }
      }
    }
    if (schemaNode.properties && typeof schemaNode.properties === 'object' && !Array.isArray(schemaNode.properties)) {
      const props = schemaNode.properties as Record<string, Record<string, unknown>>;
      for (const [propKey, propSchema] of Object.entries(props)) {
        if (Object.prototype.hasOwnProperty.call(obj, propKey) && obj[propKey] !== undefined) {
          if (!validateOpenApiSchema(propSchema, obj[propKey], rootDoc)) {
            return false;
          }
        }
      }
      if (schemaNode.additionalProperties === false) {
        for (const key of Object.keys(obj)) {
          if (!Object.prototype.hasOwnProperty.call(props, key)) {
            return false;
          }
        }
      }
    }
  }

  if (Array.isArray(schemaNode.allOf)) {
    for (const sub of schemaNode.allOf) {
      if (sub && typeof sub === 'object' && !validateOpenApiSchema(sub as Record<string, unknown>, value, rootDoc)) {
        return false;
      }
    }
  }

  if (Array.isArray(schemaNode.anyOf)) {
    const matched = schemaNode.anyOf.some(
      (sub) => sub && typeof sub === 'object' && validateOpenApiSchema(sub as Record<string, unknown>, value, rootDoc)
    );
    if (!matched) return false;
  }

  if (Array.isArray(schemaNode.oneOf)) {
    const matches = schemaNode.oneOf.filter(
      (sub) => sub && typeof sub === 'object' && validateOpenApiSchema(sub as Record<string, unknown>, value, rootDoc)
    );
    if (matches.length !== 1) return false;
  }

  return true;
}

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

  it('discovers all 82 route files (.ts and .tsx) and 115 HTTP operations including GET /api/live, GET /api/og, GET & DELETE /api/guest/session, GET & HEAD /api/uploads/{path}, GET /api/admin/broadcast/{id}, GET /api/admin/geocode, and POST /api/admin/invitation-codes/merge', () => {
    expect(openapi.openapi).toBe('3.0.3');
    expect(Array.isArray(openapi.servers)).toBe(true);
    expect((openapi.servers ?? []).length).toBeGreaterThanOrEqual(1);

    const routePaths = Object.keys(openapi.paths);
    expect(routePaths).toHaveLength(82);

    const operations = getAllOperations();
    expect(operations).toHaveLength(115);

    expect(openapi.paths['/api/guest/session']?.get).toBeDefined();
    expect(openapi.paths['/api/guest/session']?.delete).toBeDefined();
    expect(openapi.paths['/api/uploads/{path}']?.get).toBeDefined();
    expect(openapi.paths['/api/uploads/{path}']?.head).toBeDefined();
    expect(openapi.paths['/api/admin/broadcast/{id}']?.get).toBeDefined();
    expect(openapi.paths['/api/admin/geocode']?.get).toBeDefined();
    expect(openapi.paths['/api/admin/invitation-codes/merge']?.post).toBeDefined();

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

      for (const [status, resObj] of Object.entries(operation.responses)) {
        for (const [mediaType, mediaObj] of Object.entries(resObj.content ?? {})) {
          violations.push(
            ...collectSchemaViolations(mediaObj.schema, `${method} ${routePath} response:${status}[${mediaType}]`)
          );
          nullableCount += countNullableProperties(mediaObj.schema);
        }
      }
    }

    for (const [schemaName, schemaObj] of Object.entries(openapi.components?.schemas ?? {})) {
      violations.push(...collectSchemaViolations(schemaObj, `components.schemas.${schemaName}`));
      nullableCount += countNullableProperties(schemaObj);
    }

    expect(violations).toEqual([]);
    expect(nullableCount).toBeGreaterThan(0);
  });

  it('emits requestBody contracts for all 61 body operations including all 9 previously missing operations', () => {
    const operations = getAllOperations();
    const bodyOperations = operations.filter(({ operation }) => Boolean(operation.requestBody));
    expect(bodyOperations).toHaveLength(61);

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
      anyOf?: unknown[];
      description?: string;
    };

    expect(schema.properties).toBeDefined();
    expect(schema.properties?.password).toBeDefined();
    expect(schema.properties?.sampleArchetype).toBeDefined();
    expect(schema.properties?.sampleModules).toBeDefined();
    expect(schema.properties?.partner1Name).toBeDefined();
    expect(schema.properties?.weddingDate).toBeDefined();

    expect(schema.required ?? []).toHaveLength(0);
    expect(Array.isArray(schema.anyOf)).toBe(true);
    expect(schema.description).toMatch(/ADMIN_PASSWORD_HASH/);
  });

  it('defines components.securitySchemes across all 100 protected operations and query parameters across all 23 query operations', () => {
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
    expect(protectedOps).toHaveLength(100);

    const unprotectedOpKeys = operations
      .filter(({ operation }) => !operation.security || operation.security.length === 0)
      .map(({ method, routePath }) => `${method} ${routePath}`)
      .sort();

    expect(unprotectedOpKeys).toEqual([
      'DELETE /api/guest/session',
      'GET /api/admin/setup',
      'GET /api/guest/session',
      'GET /api/health',
      'GET /api/live',
      'GET /api/ready',
      'GET /api/registry/claim',
      'GET /api/registry/validate-code',
      'GET /api/uploads/{path}',
      'HEAD /api/uploads/{path}',
      'POST /api/admin/login',
      'POST /api/admin/setup',
      'POST /api/guest/address/public',
      'POST /api/guest/login',
      'POST /api/registry/claim',
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

    // Verify 23 query operations
    const queryOps = operations.filter(({ operation }) =>
      (operation.parameters ?? []).some((param) => param.in === 'query')
    );
    expect(queryOps).toHaveLength(23);

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

  it('emits multi-branch anyOf schemas for POST /api/rsvp and POST /api/admin/invitation-codes/batch without exclusive oneOf collisions', () => {
    const rsvpPost = openapi.paths['/api/rsvp']?.post as OpenApiOperation;
    const rsvpSchema = rsvpPost.requestBody?.content['application/json']?.schema as {
      type?: string;
      anyOf?: Array<{ properties?: Record<string, unknown> }>;
    };
    expect(rsvpSchema.type).toBe('object');
    expect(rsvpSchema.anyOf).toHaveLength(2);
    expect(
      rsvpSchema.anyOf?.some((branch) => Boolean(branch.properties?.rsvps))
    ).toBe(true);
    expect(
      rsvpSchema.anyOf?.some((branch) => Boolean(branch.properties?.subEventId))
    ).toBe(true);

    const inviteBatchPost = openapi.paths['/api/admin/invitation-codes/batch']
      ?.post as OpenApiOperation;
    const inviteBatchSchema = inviteBatchPost.requestBody?.content['application/json']?.schema as {
      type?: string;
      anyOf?: Array<{ properties?: Record<string, unknown> }>;
    };
    expect(inviteBatchSchema.type).toBe('object');
    expect(inviteBatchSchema.anyOf).toHaveLength(3);
    expect(
      inviteBatchSchema.anyOf?.some(
        (branch) => Boolean(branch.properties?.ids && !branch.properties?.tags)
      )
    ).toBe(true);
    expect(
      inviteBatchSchema.anyOf?.some(
        (branch) => Boolean(branch.properties?.ids && branch.properties?.tags && branch.properties?.action)
      )
    ).toBe(true);
    expect(
      inviteBatchSchema.anyOf?.some((branch) => Boolean(branch.properties?.records))
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

  it('emits {entity} path enums on all 10 admin entity operations and 7-branch anyOf schemas resolved from src/features/admin/registry.ts on entity POST/PUT', () => {
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
      anyOf?: unknown[];
    };
    expect(entityCreateSchema.type).toBe('object');
    expect(entityCreateSchema.anyOf).toHaveLength(7);

    const entityUpdateSchema = (openapi.paths['/api/admin/{entity}/{id}']?.put as OpenApiOperation)
      .requestBody?.content['application/json']?.schema as {
      type?: string;
      anyOf?: unknown[];
    };
    expect(entityUpdateSchema.type).toBe('object');
    expect(entityUpdateSchema.anyOf).toHaveLength(7);
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

  it('defines top-level domain tags and assigns declared tags across all 115 operations', () => {
    expect(Array.isArray(openapi.tags)).toBe(true);
    expect((openapi.tags ?? []).length).toBeGreaterThanOrEqual(12);

    const declaredTags = new Set((openapi.tags ?? []).map((t) => t.name));
    const operations = getAllOperations();
    expect(operations).toHaveLength(115);

    for (const { operation } of operations) {
      expect(Array.isArray(operation.tags)).toBe(true);
      expect((operation.tags ?? []).length).toBeGreaterThan(0);
      for (const tag of operation.tags ?? []) {
        expect(declaredTags.has(tag)).toBe(true);
      }
    }
  });

  it('emits verified HTTP 200 and 503 application/json probe schemas for /api/live, /api/health, and /api/ready', () => {
    const rootDoc = openapi as unknown as Record<string, unknown>;

    const liveGet = openapi.paths['/api/live']?.get as OpenApiOperation;
    expect(Object.keys(liveGet.responses).sort()).toEqual(['200', '500']);
    expect(liveGet.responses['200']?.content?.['application/json']?.schema).toEqual({
      type: 'object',
      required: ['status', 'timestamp'],
      properties: {
        status: { type: 'string', enum: ['alive'] },
        timestamp: { type: 'string', format: 'date-time' },
      },
    });

    const healthGet = openapi.paths['/api/health']?.get as OpenApiOperation;
    expect(Object.keys(healthGet.responses).sort()).toEqual(['200', '500', '503']);
    expect(healthGet.responses['200']?.content?.['application/json']?.schema).toEqual({
      type: 'object',
      required: ['success', 'data'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          required: ['status', 'timestamp', 'database'],
          properties: {
            status: { type: 'string', enum: ['ok'] },
            database: { type: 'string', enum: ['connected'] },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
      },
    });

    const rawHealth500Schema = healthGet.responses['500']?.content?.['application/json']?.schema as {
      $ref?: string;
    };
    expect(rawHealth500Schema).toEqual({ $ref: '#/components/schemas/ApiErrorEnvelope' });

    const resolvedHealth500Schema = resolveJsonPointer(rootDoc, rawHealth500Schema.$ref!) as {
      type?: string;
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(resolvedHealth500Schema.type).toBe('object');
    expect(resolvedHealth500Schema.required).toEqual(['success', 'error']);
    expect(resolvedHealth500Schema.properties?.success).toEqual({ type: 'boolean', enum: [false] });
    expect(resolvedHealth500Schema.properties?.error).toEqual({ type: 'string' });
    expect(resolvedHealth500Schema.properties?.referenceId).toEqual({ type: 'string' });

    expect(healthGet.responses['503']?.content?.['application/json']?.schema).toEqual({
      type: 'object',
      required: ['success', 'status', 'timestamp', 'database', 'error'],
      properties: {
        success: { type: 'boolean', enum: [false] },
        status: { type: 'string', enum: ['degraded'] },
        database: { type: 'string', enum: ['disconnected'] },
        timestamp: { type: 'string', format: 'date-time' },
        error: { type: 'string', enum: ['Database connection failed'] },
      },
    });

    const readyGet = openapi.paths['/api/ready']?.get as OpenApiOperation;
    expect(Object.keys(readyGet.responses).sort()).toEqual(['200', '503']);
    expect(readyGet.responses['200']?.content?.['application/json']?.schema).toEqual({
      type: 'object',
      required: ['status', 'database', 'timestamp'],
      properties: {
        status: { type: 'string', enum: ['ready'] },
        database: { type: 'string', enum: ['connected'] },
        timestamp: { type: 'string', format: 'date-time' },
      },
    });
    expect(readyGet.responses['503']?.content?.['application/json']?.schema).toEqual({
      type: 'object',
      required: ['status', 'database', 'error', 'timestamp'],
      properties: {
        status: { type: 'string', enum: ['unhealthy'] },
        database: { type: 'string', enum: ['disconnected', 'connected'] },
        error: { type: 'string' },
        timestamp: { type: 'string', format: 'date-time' },
      },
    });
  });

  it('validates all 7 entity creates/updates, photo moderation forms, and invitation batch payloads without union collisions while rejecting empty {} on all 7 structurally guarded operations', () => {
    // Direct check on AdminEntityCreateSchema & AdminEntityUpdateSchema (z.union -> anyOf, non-colliding)
    const createJsonSchema = z.toJSONSchema(AdminEntityCreateSchema, {
      target: 'openapi-3.0',
      io: 'input',
      unrepresentable: 'any',
    }) as Record<string, unknown>;
    const updateJsonSchema = z.toJSONSchema(AdminEntityUpdateSchema, {
      target: 'openapi-3.0',
      io: 'input',
      unrepresentable: 'any',
    }) as Record<string, unknown>;
    expect(Array.isArray(createJsonSchema.anyOf)).toBe(true);
    expect(createJsonSchema.oneOf).toBeUndefined();
    expect(Array.isArray(updateJsonSchema.anyOf)).toBe(true);
    expect(updateJsonSchema.oneOf).toBeUndefined();
    expect(AdminEntityUpdateSchema.safeParse({ price: 249.99 }).success).toBe(true);

    const rootDoc = openapi as unknown as Record<string, unknown>;
    function compileRequestSchema(routePath: string, method: string) {
      const op = openapi.paths[routePath]?.[method] as OpenApiOperation;
      const schema = op.requestBody?.content['application/json']?.schema as Record<string, unknown>;
      return (payload: unknown) => validateOpenApiSchema(schema, payload, rootDoc);
    }

    // 1. All 7 entity creates
    const validateEntityCreate = compileRequestSchema('/api/admin/{entity}', 'post');
    const entityCreates = [
      { type: 'page', tags: ['home'], data: { title: 'Welcome', body: 'Hello' } },
      { name: 'Jane Doe', role: 'Maid of Honor', bio: 'Best friend', order: 1 },
      {
        name: 'Botanical Garden',
        description: 'Lush gardens',
        category: 'Nature',
        directions: '5 min walk',
        latitude: 37.77,
        longitude: -122.41,
        isVisible: true,
      },
      { name: 'Stand Mixer', price: 299.99, category: 'Kitchen' },
      { guestName: 'The Smith Family', maxGuests: 4 },
      { name: 'Table 1', capacity: 8 },
      { title: 'Welcome Drinks', startTime: '2026-06-19T18:00:00Z' },
    ];
    for (const payload of entityCreates) {
      expect(validateEntityCreate(payload)).toBe(true);
    }

    // 2. All 7 entity updates (partial updates without exclusive union collision)
    const validateEntityUpdate = compileRequestSchema('/api/admin/{entity}/{id}', 'put');
    const entityUpdates = [
      { tags: ['home', 'featured'] },
      { role: 'Best Woman' },
      { isVisible: false },
      { price: 249.99 },
      { maxGuests: 5 },
      { capacity: 10 },
      { location: 'Rooftop Terrace' },
    ];
    for (const payload of entityUpdates) {
      expect(validateEntityUpdate(payload)).toBe(true);
    }

    // 3. Photo moderation forms
    const validatePhotoIdPatch = compileRequestSchema('/api/admin/photos/{id}', 'patch');
    expect(validatePhotoIdPatch({ action: 'approve' })).toBe(true);
    expect(validatePhotoIdPatch({ status: 'APPROVED' })).toBe(true);

    const validateModQueuePatch = compileRequestSchema('/api/admin/photos/moderation', 'patch');
    expect(validateModQueuePatch({ id: 'photo-1', action: 'approve' })).toBe(true);
    expect(validateModQueuePatch({ ids: ['photo-1', 'photo-2'], status: 'APPROVED' })).toBe(true);
    expect(validateModQueuePatch({ action: 'approve' })).toBe(false);

    const validateModBatchPost = compileRequestSchema('/api/admin/photos/moderation/batch', 'post');
    expect(validateModBatchPost({ photoIds: ['photo-1'], action: 'reject' })).toBe(true);
    expect(validateModBatchPost({ photoIds: [] })).toBe(false);

    // 4. Invitation batch payloads
    const validateInvBatchPost = compileRequestSchema('/api/admin/invitation-codes/batch', 'post');
    expect(
      validateInvBatchPost({
        ids: ['123e4567-e89b-12d3-a456-426614174000'],
        tags: ['vip'],
        action: 'add',
      })
    ).toBe(true);
    expect(validateInvBatchPost({ ids: ['id-1'], updates: { maxGuests: 4 } })).toBe(true);
    expect(validateInvBatchPost({ records: [{ guestName: 'John Doe' }] })).toBe(true);

    // 5. Reject empty {} across all 7 structurally guarded operations
    const guardedOperations: Array<[string, string]> = [
      ['/api/guest/lookup', 'post'],
      ['/api/admin/photos/moderation/batch', 'post'],
      ['/api/registry/contribute', 'post'],
      ['/api/admin/invitation-codes/merge', 'post'],
      ['/api/admin/photos/{id}', 'patch'],
      ['/api/admin/photos/moderation', 'patch'],
      ['/api/admin/setup', 'post'],
    ];
    for (const [routePath, method] of guardedOperations) {
      const validate = compileRequestSchema(routePath, method);
      expect(validate({})).toBe(false);
    }

    // Verify MergeInvitationCodesSchema documents disjoint primaryId/secondaryIds precondition
    const mergeSchema = (
      openapi.paths['/api/admin/invitation-codes/merge']?.post as OpenApiOperation
    ).requestBody?.content['application/json']?.schema as { description?: string };
    expect(mergeSchema.description).toMatch(/primaryId/);
    expect(mergeSchema.description).toMatch(/secondaryIds/);
  });

  it('infers 2xx response schemas and 4xx/5xx error envelopes across all 115 operations, including binary uploads and backup export', () => {
    const operations = getAllOperations();
    expect(operations).toHaveLength(115);

    for (const { routePath, method, operation } of operations) {
      const statusCodes = Object.keys(operation.responses);
      const successCodes = statusCodes.filter((code) => code.startsWith('2'));
      const errorCodes = statusCodes.filter((code) => code.startsWith('4') || code.startsWith('5'));

      expect(successCodes.length).toBeGreaterThan(0);
      expect(errorCodes.length).toBeGreaterThan(0);

      for (const code of [...successCodes, ...errorCodes]) {
        const resObj = operation.responses[code];
        const mediaEntries = Object.entries(resObj.content ?? {});
        expect(mediaEntries.length).toBeGreaterThan(0);
        for (const [, mediaObj] of mediaEntries) {
          expect(mediaObj.schema).toBeDefined();
          expect(Object.keys(mediaObj.schema).length).toBeGreaterThan(0);
        }
      }

      if (routePath === '/api/uploads/{path}' && (method === 'GET' || method === 'HEAD')) {
        const okRes = operation.responses['200'];
        expect(okRes.content?.['application/octet-stream']?.schema).toEqual({
          type: 'string',
          format: 'binary',
        });
        expect(Object.keys(okRes.headers ?? {})).toEqual(
          expect.arrayContaining([
            'Content-Type',
            'Content-Length',
            'Last-Modified',
            'Cache-Control',
            'X-Content-Type-Options',
          ])
        );
      }
    }

    const maintenanceExport = openapi.paths['/api/admin/maintenance/export']
      ?.get as OpenApiOperation;
    const backupSchema = maintenanceExport.responses['200']?.content?.['application/json']
      ?.schema as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(backupSchema.required).toEqual(expect.arrayContaining(['appConfig', 'registryItem']));
    expect(backupSchema.properties?.appConfig).toBeDefined();
    expect(maintenanceExport.responses['200']?.headers?.['Content-Disposition']).toBeDefined();
  });
});
