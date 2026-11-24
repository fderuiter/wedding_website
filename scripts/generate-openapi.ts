process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dummy:dummy@localhost:5432/dummy';
process.env.ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ||
  'scrypt:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

import { Project, SyntaxKind, Node, type CallExpression } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, '..');

const validationUtils = await import('../src/utils/validation.js');
const adminEntitySchemas = await import('../src/utils/adminEntitySchemas.js');
const registrySchemas = await import('../src/features/registry/schemas.js');
const attractionSchemas = await import('../src/features/attractions/schemas.js');
const weddingPartySchemas = await import('../src/features/wedding-party/schemas.js');
const contentSchemas = await import('../src/features/content/schemas.js');
const mediaSchemas = await import('../src/features/media/schemas.js');
const seatingSchemas = await import('../src/features/seating/schemas.js');
const subEventSchemas = await import('../src/features/sub-events/schemas.js');
const broadcastSchemas = await import('../src/features/broadcast/schemas.js');
const backupValidationSchemas = await import('../src/utils/backupValidation.js');
const sampleDataSchemas = await import('../src/lib/sampleData/schemas.js');
const { isProtectedRoute } = await import('../src/lib/routes.js');
const {
  getMiddlewarePublicApiExclusions: parseMiddlewarePublicApiExclusions,
  isMiddlewarePublicApiMethod,
} = await import('./generate-docs.js');
import type { MiddlewareApiExclusions } from './generate-docs.js';

const ALL_SCHEMAS: Record<string, any> = {
  ...validationUtils,
  ...adminEntitySchemas,
  ...registrySchemas,
  ...attractionSchemas,
  ...weddingPartySchemas,
  ...contentSchemas,
  ...mediaSchemas,
  ...seatingSchemas,
  ...subEventSchemas,
  ...broadcastSchemas,
  ...backupValidationSchemas,
  ...sampleDataSchemas,
  AdminEntityBatchDeleteSchema: validationUtils.AdminEntityBatchDeleteSchema,
  MediaExportSchema: validationUtils.MediaExportSchema,
  AdminSetupSchema: validationUtils.AdminSetupSchema,
  StripeWebhookEventSchema: validationUtils.StripeWebhookEventSchema,
};

const IGNORED_PARSE_ARGUMENTS = new Set([
  'updatedConfig',
  'createdConfig',
  'snapshotData',
  'c',
  'normalizedSetupConfig',
]);

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const EXPORT_MEDIA_SCHEMAS: Record<string, Record<string, string>> = {
  'text/csv': { type: 'string' },
  'text/calendar': { type: 'string' },
  'application/pdf': { type: 'string', format: 'binary' },
  'application/zip': { type: 'string', format: 'binary' },
  'image/png': { type: 'string', format: 'binary' },
};

const ERROR_STATUS_DESCRIPTIONS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

const API_ERROR_ENVELOPE_SCHEMA = {
  type: 'object',
  required: ['success', 'error'],
  properties: {
    success: {
      type: 'boolean',
      enum: [false],
    },
    error: {
      type: 'string',
    },
    details: {
      nullable: true,
      anyOf: [
        { type: 'object', additionalProperties: true },
        { type: 'array', items: { type: 'object', additionalProperties: true } },
        { type: 'string' },
      ],
    },
    helpPrompt: {
      type: 'string',
    },
    referenceId: {
      type: 'string',
    },
  },
};

const RAW_JSON_ERROR_SCHEMA = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'string',
    },
  },
};

const OPENAPI_TAGS: Array<{ prefix: string; name: string; description: string }> = [
  {
    prefix: '/api/admin',
    name: 'Admin',
    description: 'Administrative endpoints for site configuration, content management, invitations, seating, broadcasts, and maintenance',
  },
  {
    prefix: '/api/cron',
    name: 'Cron',
    description: 'Scheduled background job endpoints protected by CRON_SECRET bearer authentication',
  },
  {
    prefix: '/api/guest',
    name: 'Guest',
    description: 'Guest authentication, invitation lookup, address collection, and guest photo upload endpoints',
  },
  {
    prefix: '/api/health',
    name: 'Health',
    description: 'Service liveness health check endpoints',
  },
  {
    prefix: '/api/live',
    name: 'Liveness',
    description: 'Process liveness probe endpoints decoupled from database availability',
  },
  {
    prefix: '/api/media',
    name: 'Media',
    description: 'Media asset library CRUD and ZIP archive export endpoints',
  },
  {
    prefix: '/api/og',
    name: 'Open Graph',
    description: 'Dynamic Open Graph social preview image generation endpoints',
  },
  {
    prefix: '/api/photos',
    name: 'Photos',
    description: 'Shared wedding photo gallery and photo upload endpoints',
  },
  {
    prefix: '/api/ready',
    name: 'Readiness',
    description: 'Database and dependency readiness probe endpoints',
  },
  {
    prefix: '/api/registry',
    name: 'Registry',
    description: 'Gift registry catalog, URL scraping, contributions, PaymentIntents, and Stripe webhook endpoints',
  },
  {
    prefix: '/api/rsvp',
    name: 'RSVP',
    description: 'Guest sub-event RSVP submission and availability status endpoints',
  },
  {
    prefix: '/api/schedule',
    name: 'Schedule',
    description: 'Event schedule retrieval and iCalendar (.ics) download endpoints',
  },
  {
    prefix: '/api/uploads',
    name: 'Uploads',
    description: 'Dynamic streaming endpoints for locally stored uploaded media assets in standalone mode',
  },
  {
    prefix: '/api/weather',
    name: 'Weather',
    description: 'Venue weather forecast proxy endpoints',
  },
];

function resolveOperationTag(routePath: string): string {
  for (const tagDef of OPENAPI_TAGS) {
    if (routePath === tagDef.prefix || routePath.startsWith(`${tagDef.prefix}/`)) {
      return tagDef.name;
    }
  }
  return 'General';
}

const project = new Project({ tsConfigFilePath: path.join(rootPath, 'tsconfig.json') });
const extraAppDir = process.env.OPENAPI_EXTRA_APP_DIR
  ? path.resolve(process.env.OPENAPI_EXTRA_APP_DIR)
  : null;
if (extraAppDir && fs.existsSync(extraAppDir)) {
  project.addSourceFilesAtPaths([
    path.join(extraAppDir, 'api/**/route.ts'),
    path.join(extraAppDir, 'api/**/route.tsx'),
  ]);
}
const mainAppPrefix = `${path.join(rootPath, 'src/app').replace(/\\/g, '/')}/api/`;
const extraAppPrefix = extraAppDir ? `${extraAppDir.replace(/\\/g, '/')}/api/` : null;
const routeFiles = project.getSourceFiles().filter((file) => {
  const normalizedPath = file.getFilePath().replace(/\\/g, '/');
  if (normalizedPath.includes('__tests__')) return false;
  const inMainOrExtra =
    normalizedPath.startsWith(mainAppPrefix) ||
    Boolean(extraAppPrefix && normalizedPath.startsWith(extraAppPrefix));
  return inMainOrExtra && /\/route\.(ts|tsx)$/.test(normalizedPath);
});

function extractAdminEntitySlugs(): string[] {
  const registryPath = path.join(rootPath, 'src/features/admin/registry.ts');
  const registryFile = project.getSourceFile(registryPath) ?? project.addSourceFileAtPathIfExists(registryPath);
  if (!registryFile) return [];

  const slugs: string[] = [];
  const seen = new Set<string>();

  for (const computedProp of registryFile.getDescendantsOfKind(SyntaxKind.ComputedPropertyName)) {
    const expr = computedProp.getExpression();
    if (!Node.isPropertyAccessExpression(expr) || expr.getName() !== 'ENTITY_KEY') continue;

    const classExpr = expr.getExpression();
    const typeSym = classExpr.getType().getSymbol();
    const directSym = classExpr.getSymbol();
    const candidateSyms = [typeSym, directSym?.getAliasedSymbol() ?? directSym].filter(Boolean);

    for (const sym of candidateSyms) {
      for (const decl of sym!.getDeclarations()) {
        if (!Node.isClassDeclaration(decl)) continue;
        const staticProp = decl.getStaticProperty('ENTITY_KEY');
        if (staticProp && Node.isPropertyDeclaration(staticProp)) {
          const init = staticProp.getInitializer();
          if (init && (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init))) {
            const slug = init.getLiteralValue();
            if (slug && !seen.has(slug)) {
              seen.add(slug);
              slugs.push(slug);
            }
          }
        }
      }
    }
  }

  return slugs;
}

interface AdminEntitySchemaNames {
  createSchemas: string[];
  updateSchemas: string[];
}

function extractAdminEntitySchemaNames(): AdminEntitySchemaNames {
  const registryPath = path.join(rootPath, 'src/features/admin/registry.ts');
  const registryFile =
    project.getSourceFile(registryPath) ?? project.addSourceFileAtPathIfExists(registryPath);
  if (!registryFile) return { createSchemas: [], updateSchemas: [] };

  const createSchemas: string[] = [];
  const updateSchemas: string[] = [];

  for (const computedProp of registryFile.getDescendantsOfKind(SyntaxKind.ComputedPropertyName)) {
    const expr = computedProp.getExpression();
    if (!Node.isPropertyAccessExpression(expr) || expr.getName() !== 'ENTITY_KEY') continue;

    const propAssign = computedProp.getParent();
    if (!propAssign || !Node.isPropertyAssignment(propAssign)) continue;
    const init = propAssign.getInitializer();
    if (!init || !Node.isObjectLiteralExpression(init)) continue;

    const createProp = init.getProperty('createSchema');
    if (createProp && Node.isPropertyAssignment(createProp)) {
      const createInit = createProp.getInitializer();
      if (createInit && Node.isIdentifier(createInit)) {
        createSchemas.push(createInit.getText());
      }
    }

    const updateProp = init.getProperty('updateSchema');
    if (updateProp && Node.isPropertyAssignment(updateProp)) {
      const updateInit = updateProp.getInitializer();
      if (updateInit && Node.isIdentifier(updateInit)) {
        updateSchemas.push(updateInit.getText());
      }
    }
  }

  return {
    createSchemas: Array.from(new Set(createSchemas)),
    updateSchemas: Array.from(new Set(updateSchemas)),
  };
}
function getMiddlewarePublicApiExclusions(): MiddlewareApiExclusions {
  return parseMiddlewarePublicApiExclusions(rootPath);
}

function isMiddlewarePublicApiRoute(
  routePath: string,
  method: string,
  exclusions: MiddlewareApiExclusions
): boolean {
  return isMiddlewarePublicApiMethod(routePath, method, exclusions);
}

function isMethodGuardCondition(condText: string): boolean {
  const trimmed = condText.trim();
  return (
    /^(?:req|request)\.method\s*===\s*['"][A-Z]+['"]$/.test(trimmed) ||
    /^(?:req|request)\.method\s*!==\s*['"][A-Z]+['"]$/.test(trimmed)
  );
}

function isInsideConditionalBranch(targetNode: Node, scopeRoot: Node | undefined): boolean {
  let current: Node | undefined = targetNode.getParent();
  let child: Node = targetNode;

  while (current && current !== scopeRoot) {
    if (Node.isIfStatement(current)) {
      const condText = current.getExpression().getText();
      if (!isMethodGuardCondition(condText)) {
        const thenStmt = current.getThenStatement();
        const elseStmt = current.getElseStatement();
        if (child === thenStmt || (elseStmt && child === elseStmt)) {
          return true;
        }
      }
    } else if (Node.isCaseClause(current) || Node.isDefaultClause(current)) {
      return true;
    } else if (Node.isConditionalExpression(current)) {
      if (child === current.getWhenTrue() || child === current.getWhenFalse()) {
        return true;
      }
    }

    child = current;
    current = current.getParent();
  }

  return false;
}

function collectMethodScopedNodes(root: Node, method: string): Node[] {
  const collected: Node[] = [];

  function visit(current: Node) {
    if (Node.isIfStatement(current)) {
      const condText = current.getExpression().getText().trim();
      const eqMatch = condText.match(/^(?:req|request)\.method\s*===\s*['"]([A-Z]+)['"]$/);
      if (eqMatch) {
        if (eqMatch[1] === method) {
          visit(current.getThenStatement());
        } else {
          const elseStmt = current.getElseStatement();
          if (elseStmt) visit(elseStmt);
        }
        return;
      }

      const neqMatch = condText.match(/^(?:req|request)\.method\s*!==\s*['"]([A-Z]+)['"]$/);
      if (neqMatch) {
        if (neqMatch[1] !== method) {
          visit(current.getThenStatement());
        } else {
          const elseStmt = current.getElseStatement();
          if (elseStmt) visit(elseStmt);
        }
        return;
      }
    }

    collected.push(current);
    for (const child of current.getChildren()) {
      visit(child);
    }
  }

  visit(root);
  return collected;
}

interface DelegatedHelperGroup {
  nodes: Node[];
  invokedConditionally: boolean;
}

function collectDelegatedHelperRoots(
  sourceNodes: Node[],
  method: string,
  visitedDecls = new Set<Node>(),
  parentConditional = false
): DelegatedHelperGroup[] {
  const groups: DelegatedHelperGroup[] = [];
  const scopeRoot = sourceNodes[0];

  for (const node of sourceNodes) {
    if (!Node.isIdentifier(node)) continue;
    const sym = node.getSymbol();
    if (!sym) continue;
    const targetSym = sym.getAliasedSymbol() ?? sym;

    for (const decl of targetSym.getDeclarations()) {
      if (visitedDecls.has(decl)) continue;
      const filePath = decl.getSourceFile().getFilePath().replace(/\\/g, '/');
      if (filePath.includes('/node_modules/')) continue;
      if (!filePath.includes('/src/app/api/') && !filePath.includes('/src/features/')) continue;

      if (
        Node.isFunctionDeclaration(decl) ||
        Node.isVariableDeclaration(decl) ||
        Node.isArrowFunction(decl) ||
        Node.isFunctionExpression(decl)
      ) {
        visitedDecls.add(decl);
        const invokedConditionally =
          parentConditional || isInsideConditionalBranch(node, scopeRoot);
        const scoped = collectMethodScopedNodes(decl, method);
        groups.push({ nodes: scoped, invokedConditionally });
        groups.push(
          ...collectDelegatedHelperRoots(scoped, method, visitedDecls, invokedConditionally)
        );
      }
    }
  }

  return groups;
}

function extractSchemasFromScopedNodes(
  scopedNodes: Node[],
  entitySchemaNames: AdminEntitySchemaNames
): string[] {
  const scopeRoot = scopedNodes[0];
  const calls = scopedNodes.filter((n): n is CallExpression => Node.isCallExpression(n));

  for (const c of calls) {
    const text = c.getExpression().getText();
    if (text === 'createValidatedRoute') {
      const args = c.getArguments();
      if (args.length > 0 && Node.isObjectLiteralExpression(args[0])) {
        const obj = args[0];
        const schemaProp = obj.getProperty('schema');
        if (schemaProp && Node.isPropertyAssignment(schemaProp)) {
          const init = schemaProp.getInitializer();
          if (init) {
            if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
              const innerCalls = init.getDescendantsOfKind(SyntaxKind.CallExpression);
              if (innerCalls.length > 0) {
                return [innerCalls[0].getExpression().getText().replace(/.*\./, '')];
              }
              const innerIds = init.getDescendantsOfKind(SyntaxKind.Identifier);
              const returnedSchema = innerIds.find((id) => id.getText().includes('Schema'));
              if (returnedSchema) return [returnedSchema.getText().replace(/.*\./, '')];
            }
            return [init.getText().replace(/.*\./, '')];
          }
        }
      }
    }
  }

  const branchedSchemas: string[] = [];
  const unbranchedSchemas: string[] = [];

  for (const c of calls) {
    const exprText = c.getExpression().getText();
    if (exprText.includes('.safeParse') || exprText.includes('.parse')) {
      const schemaName = exprText.split('.')[0].replace(/.*\./, '');
      if (schemaName.endsWith('QuerySchema')) continue;

      const args = c.getArguments();
      const argText = args.length > 0 ? args[0].getText() : '';

      if (IGNORED_PARSE_ARGUMENTS.has(argText) || argText.startsWith('snapshotData.')) {
        continue;
      }

      if (ALL_SCHEMAS[schemaName]) {
        if (isInsideConditionalBranch(c, scopeRoot)) {
          branchedSchemas.push(schemaName);
        } else {
          unbranchedSchemas.push(schemaName);
        }
      }
    }
  }

  const results: string[] = [...branchedSchemas];
  if (unbranchedSchemas.length > 0) {
    results.push(unbranchedSchemas[unbranchedSchemas.length - 1]);
  }

  if (results.length === 0) {
    const usesEntityRegistry = calls.some((c) => c.getExpression().getText() === 'getEntityService');
    if (usesEntityRegistry) {
      const invokesCreate = calls.some((c) => /\.service\.create$/.test(c.getExpression().getText()));
      const invokesUpdate = calls.some((c) => /\.service\.update$/.test(c.getExpression().getText()));
      if (invokesCreate && entitySchemaNames.createSchemas.length > 0) {
        return [...entitySchemaNames.createSchemas];
      }
      if (invokesUpdate && entitySchemaNames.updateSchemas.length > 0) {
        return [...entitySchemaNames.updateSchemas];
      }
    }
  }

  return Array.from(new Set(results));
}

function extractSchemaNames(
  directNodes: Node[],
  delegatedGroups: DelegatedHelperGroup[],
  entitySchemaNames: AdminEntitySchemaNames
): string[] {
  const directMatches = extractSchemasFromScopedNodes(directNodes, entitySchemaNames);
  const conditionalDelegatedMatches: string[] = [];
  const unconditionalDelegatedMatches: string[] = [];

  for (const group of delegatedGroups) {
    const matches = extractSchemasFromScopedNodes(group.nodes, entitySchemaNames);
    if (matches.length === 0) continue;
    if (group.invokedConditionally) {
      conditionalDelegatedMatches.push(...matches);
    } else {
      unconditionalDelegatedMatches.push(...matches);
    }
  }

  if (directMatches.length > 0) {
    return Array.from(new Set([...conditionalDelegatedMatches, ...directMatches]));
  }

  if (conditionalDelegatedMatches.length > 0) {
    return Array.from(new Set(conditionalDelegatedMatches));
  }

  if (unconditionalDelegatedMatches.length > 0) {
    return Array.from(new Set(unconditionalDelegatedMatches));
  }

  return [];
}

function isJsonParseGracefullyFallible(jsonCall: CallExpression): boolean {
  if (jsonCall.getExpression().getText() === 'parseJsonRequestBody') {
    const optionsArg = jsonCall.getArguments()[1];
    if (optionsArg && Node.isObjectLiteralExpression(optionsArg)) {
      const allowEmptyProp = optionsArg.getProperty('allowEmpty');
      if (
        allowEmptyProp &&
        Node.isPropertyAssignment(allowEmptyProp) &&
        allowEmptyProp.getInitializer()?.getText() === 'true'
      ) {
        return true;
      }
    }
  }

  const parent = jsonCall.getParent();
  if (
    parent &&
    Node.isPropertyAccessExpression(parent) &&
    parent.getExpression() === jsonCall &&
    parent.getName() === 'catch'
  ) {
    const catchCall = parent.getParent();
    if (catchCall && Node.isCallExpression(catchCall) && catchCall.getExpression() === parent) {
      const handler = catchCall.getArguments()[0];
      if (handler && handler.getDescendantsOfKind(SyntaxKind.ThrowStatement).length === 0) {
        return true;
      }
    }
  }

  let ancestor: Node | undefined = jsonCall.getParent();
  while (ancestor) {
    if (Node.isTryStatement(ancestor)) {
      const tryBlock = ancestor.getTryBlock();
      const catchClause = ancestor.getCatchClause();
      if (
        catchClause &&
        jsonCall.getPos() >= tryBlock.getPos() &&
        jsonCall.getEnd() <= tryBlock.getEnd()
      ) {
        const catchBlock = catchClause.getBlock();
        const hasThrow = catchBlock.getDescendantsOfKind(SyntaxKind.ThrowStatement).length > 0;
        const hasReturn = catchBlock.getDescendantsOfKind(SyntaxKind.ReturnStatement).length > 0;
        if (!hasThrow && !hasReturn) {
          return true;
        }
      }
    }
    ancestor = ancestor.getParent();
  }

  return false;
}

function detectBodyCapabilities(allNodes: Node[]): {
  acceptsBody: boolean;
  acceptsFormData: boolean;
  allowsMissingJsonBody: boolean;
} {
  let acceptsBody = false;
  let acceptsFormData = false;
  let usesValidatedRoute = false;
  let usesRawTextBody = false;
  const jsonCalls: CallExpression[] = [];

  for (const n of allNodes) {
    if (!Node.isCallExpression(n)) continue;
    const exprText = n.getExpression().getText();

    if (exprText === 'createValidatedRoute') {
      acceptsBody = true;
      usesValidatedRoute = true;
    } else if (
      exprText === 'parseJsonRequestBody' ||
      /^(?:request|req)(?:\.clone\(\))?\.json$/.test(exprText) ||
      /^\(request as any\)\.json$/.test(exprText)
    ) {
      acceptsBody = true;
      jsonCalls.push(n);
    } else if (/^(?:request|req)\.text$/.test(exprText)) {
      acceptsBody = true;
      usesRawTextBody = true;
    } else if (/^(?:request|req)\.formData$/.test(exprText)) {
      acceptsBody = true;
      acceptsFormData = true;
    }
  }

  const allowsMissingJsonBody =
    !acceptsFormData &&
    !usesValidatedRoute &&
    !usesRawTextBody &&
    jsonCalls.length > 0 &&
    jsonCalls.every(isJsonParseGracefullyFallible);

  return { acceptsBody, acceptsFormData, allowsMissingJsonBody };
}

function isObjectJsonSchema(node: any): boolean {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'object') return true;
  if (Array.isArray(node.anyOf) && node.anyOf.length > 0 && node.anyOf.every(isObjectJsonSchema)) {
    return true;
  }
  if (Array.isArray(node.oneOf) && node.oneOf.length > 0 && node.oneOf.every(isObjectJsonSchema)) {
    return true;
  }
  return false;
}

function sanitizeOpenApi30Node(node: any): any {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    return node.map(sanitizeOpenApi30Node);
  }

  delete node.$schema;
  delete node.propertyNames;

  if (Object.prototype.hasOwnProperty.call(node, 'const')) {
    const constVal = node.const;
    delete node.const;
    if (!node.enum) {
      node.enum = [constVal];
    }
    if (!node.type && constVal !== null && constVal !== undefined) {
      node.type = typeof constVal;
    }
  }

  if (Array.isArray(node.type)) {
    const types = node.type.filter((t: string) => t !== 'null');
    if (node.type.includes('null')) {
      node.nullable = true;
    }
    if (types.length === 1) {
      node.type = types[0];
    } else if (types.length > 1) {
      delete node.type;
      node.anyOf = types.map((t: string) => ({ type: t }));
    } else {
      node.type = 'string';
    }
  }

  for (const [key, val] of Object.entries(node)) {
    if (key === 'properties' && val && typeof val === 'object' && !Array.isArray(val)) {
      for (const [propKey, propVal] of Object.entries<any>(val)) {
        if (propVal && typeof propVal === 'object' && Object.keys(propVal).length === 0) {
          (val as Record<string, any>)[propKey] = {
            nullable: true,
            anyOf: [
              { type: 'object', additionalProperties: true },
              { type: 'array', items: { type: 'object', additionalProperties: true } },
              { type: 'string' },
              { type: 'number' },
              { type: 'boolean' },
            ],
          };
        } else {
          sanitizeOpenApi30Node(propVal);
        }
      }
    } else {
      sanitizeOpenApi30Node(val);
    }
  }

  return node;
}

function toOpenApiSchema(schemaObj: any, isMultipart: boolean): any {
  const raw = typeof z.toJSONSchema === 'function'
    ? z.toJSONSchema(schemaObj, {
      target: 'openapi-3.0',
      io: 'input',
      unrepresentable: 'any',
      override: (ctx) => {
        const def = (ctx.zodSchema as any)?._zod?.def;
        if (def?.type === 'date') {
          ctx.jsonSchema.type = 'string';
          ctx.jsonSchema.format = 'date-time';
        }
      },
    })
    : schemaObj;

  const cloned = JSON.parse(JSON.stringify(raw));
  sanitizeOpenApi30Node(cloned);

  if (
    (Array.isArray(cloned?.oneOf) && cloned.oneOf.length > 0 && cloned.oneOf.every(isObjectJsonSchema)) ||
    (Array.isArray(cloned?.anyOf) && cloned.anyOf.length > 0 && cloned.anyOf.every(isObjectJsonSchema))
  ) {
    cloned.type = 'object';
  }

  if (isMultipart && cloned && typeof cloned === 'object' && cloned.properties) {
    for (const [key, propVal] of Object.entries<any>(cloned.properties)) {
      if (propVal && typeof propVal === 'object') {
        if (Object.keys(propVal).length === 0 || (propVal.nullable && Array.isArray(propVal.anyOf) && propVal.anyOf.length === 5)) {
          cloned.properties[key] = { type: 'string', format: 'binary' };
        } else if (
          propVal.type === 'array' &&
          propVal.items &&
          typeof propVal.items === 'object' &&
          Object.keys(propVal.items).length === 0
        ) {
          propVal.items = { type: 'string', format: 'binary' };
        }
      }
    }
  }

  return cloned;
}

interface ResolvedStatusBranch {
  status: number;
  condVar?: string;
  condTruth?: boolean;
}

function extractLocalStatusBranches(allNodes: Node[]): {
  statusBranchesByVar: Map<string, ResolvedStatusBranch[]>;
  equalityCondByVar: Map<string, { targetVar: string; trueValue: string; falseValue?: string }>;
} {
  const mutableStringFallbacks = new Map<string, string>();
  const equalityCondByVar = new Map<
    string,
    { targetVar: string; trueValue: string; falseValue?: string }
  >();
  const statusBranchesByVar = new Map<string, ResolvedStatusBranch[]>();

  for (const n of allNodes) {
    if (!Node.isVariableDeclaration(n) || !Node.isIdentifier(n.getNameNode())) continue;
    const varName = n.getName();
    const init = n.getInitializer();
    if (!init) continue;

    if (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init)) {
      mutableStringFallbacks.set(varName, init.getLiteralValue());
    }
  }

  for (const n of allNodes) {
    if (!Node.isVariableDeclaration(n) || !Node.isIdentifier(n.getNameNode())) continue;
    const varName = n.getName();
    const init = n.getInitializer();
    if (!init) continue;

    if (
      Node.isBinaryExpression(init) &&
      (init.getOperatorToken().getKind() === SyntaxKind.EqualsEqualsEqualsToken ||
        init.getOperatorToken().getKind() === SyntaxKind.EqualsEqualsToken)
    ) {
      const left = init.getLeft();
      const right = init.getRight();
      if (
        Node.isIdentifier(left) &&
        (Node.isStringLiteral(right) || Node.isNoSubstitutionTemplateLiteral(right))
      ) {
        const targetVar = left.getText();
        equalityCondByVar.set(varName, {
          targetVar,
          trueValue: right.getLiteralValue(),
          falseValue: mutableStringFallbacks.get(targetVar),
        });
      }
    } else if (Node.isNumericLiteral(init)) {
      statusBranchesByVar.set(varName, [{ status: Number(init.getLiteralValue()) }]);
    } else if (Node.isConditionalExpression(init)) {
      const condExpr = init.getCondition();
      const whenTrue = init.getWhenTrue();
      const whenFalse = init.getWhenFalse();
      if (Node.isNumericLiteral(whenTrue) && Node.isNumericLiteral(whenFalse)) {
        const condVar = Node.isIdentifier(condExpr) ? condExpr.getText() : undefined;
        statusBranchesByVar.set(varName, [
          { status: Number(whenTrue.getLiteralValue()), condVar, condTruth: true },
          { status: Number(whenFalse.getLiteralValue()), condVar, condTruth: false },
        ]);
      }
    }
  }

  return { statusBranchesByVar, equalityCondByVar };
}

function extractProbeStatusBranchesFromInitObject(
  initArg: Node | undefined,
  statusBranchesByVar: Map<string, ResolvedStatusBranch[]>
): ResolvedStatusBranch[] {
  const initObj = resolveObjectLiteral(initArg);
  if (!initObj || !Node.isObjectLiteralExpression(initObj)) return [{ status: 200 }];
  const statusProp = initObj.getProperty('status');
  if (statusProp && Node.isPropertyAssignment(statusProp)) {
    const statusInit = statusProp.getInitializer();
    if (statusInit && Node.isNumericLiteral(statusInit)) {
      return [{ status: Number(statusInit.getLiteralValue()) }];
    }
    if (statusInit && Node.isIdentifier(statusInit)) {
      const resolved = statusBranchesByVar.get(statusInit.getText());
      if (resolved && resolved.length > 0) {
        return resolved;
      }
    }
    if (statusInit && Node.isConditionalExpression(statusInit)) {
      const condExpr = statusInit.getCondition();
      const whenTrue = statusInit.getWhenTrue();
      const whenFalse = statusInit.getWhenFalse();
      if (Node.isNumericLiteral(whenTrue) && Node.isNumericLiteral(whenFalse)) {
        const condVar = Node.isIdentifier(condExpr) ? condExpr.getText() : undefined;
        return [
          { status: Number(whenTrue.getLiteralValue()), condVar, condTruth: true },
          { status: Number(whenFalse.getLiteralValue()), condVar, condTruth: false },
        ];
      }
    }
  }
  return [{ status: 200 }];
}

function inferProbePropertySchema(
  valueNode: Node,
  propName: string,
  branch: ResolvedStatusBranch,
  equalityCondByVar: Map<string, { targetVar: string; trueValue: string; falseValue?: string }>
): Record<string, any> | null {
  if (Node.isStringLiteral(valueNode) || Node.isNoSubstitutionTemplateLiteral(valueNode)) {
    return { type: 'string', enum: [valueNode.getLiteralValue()] };
  }
  if (valueNode.getKind() === SyntaxKind.TrueKeyword) {
    return { type: 'boolean', enum: [true] };
  }
  if (valueNode.getKind() === SyntaxKind.FalseKeyword) {
    return { type: 'boolean', enum: [false] };
  }
  if (Node.isNumericLiteral(valueNode)) {
    return { type: 'number', enum: [Number(valueNode.getLiteralValue())] };
  }
  if (Node.isCallExpression(valueNode) && valueNode.getText().endsWith('.toISOString()')) {
    return { type: 'string', format: 'date-time' };
  }
  if (Node.isConditionalExpression(valueNode)) {
    const cond = valueNode.getCondition();
    if (Node.isIdentifier(cond) && branch.condVar === cond.getText() && branch.condTruth !== undefined) {
      const chosen = branch.condTruth ? valueNode.getWhenTrue() : valueNode.getWhenFalse();
      return inferProbePropertySchema(chosen, propName, branch, equalityCondByVar);
    }
  }
  if (Node.isIdentifier(valueNode)) {
    const identName = valueNode.getText();
    if (branch.condVar && branch.condTruth !== undefined) {
      const eqInfo = equalityCondByVar.get(branch.condVar);
      if (eqInfo && eqInfo.targetVar === identName) {
        const resolvedVal = branch.condTruth ? eqInfo.trueValue : eqInfo.falseValue;
        if (resolvedVal) {
          return { type: 'string', enum: [resolvedVal] };
        }
      }
    }
    if (propName === 'error' || identName.toLowerCase().includes('error')) {
      return { type: 'string' };
    }
  }
  return null;
}

function extractProbeObjectSchema(
  bodyArg: Node | undefined,
  branch: ResolvedStatusBranch,
  equalityCondByVar: Map<string, { targetVar: string; trueValue: string; falseValue?: string }>
): Record<string, any> | null {
  if (!bodyArg || !Node.isObjectLiteralExpression(bodyArg)) return null;

  const hasStatusProp = Boolean(bodyArg.getProperty('status'));
  const hasIsoTimestamp = bodyArg
    .getProperties()
    .some((p) => Node.isPropertyAssignment(p) && (p.getInitializer()?.getText() ?? '').endsWith('.toISOString()'));
  if (!hasStatusProp || !hasIsoTimestamp) {
    return null;
  }

  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const prop of bodyArg.getProperties()) {
    if (Node.isPropertyAssignment(prop)) {
      const propName = prop.getName().replace(/^['"]|['"]$/g, '');
      const init = prop.getInitializer();
      if (!init) return null;
      const propSchema = inferProbePropertySchema(init, propName, branch, equalityCondByVar);
      if (!propSchema) return null;
      properties[propName] = propSchema;
      required.push(propName);
    } else if (Node.isSpreadAssignment(prop)) {
      const expr = prop.getExpression();
      const unwrapped = Node.isParenthesizedExpression(expr) ? expr.getExpression() : expr;
      if (Node.isConditionalExpression(unwrapped)) {
        const cond = unwrapped.getCondition();
        if (Node.isIdentifier(cond) && branch.condVar === cond.getText() && branch.condTruth !== undefined) {
          const chosen = branch.condTruth ? unwrapped.getWhenTrue() : unwrapped.getWhenFalse();
          if (Node.isObjectLiteralExpression(chosen)) {
            for (const subProp of chosen.getProperties()) {
              if (!Node.isPropertyAssignment(subProp)) continue;
              const subName = subProp.getName().replace(/^['"]|['"]$/g, '');
              const subInit = subProp.getInitializer();
              if (!subInit) continue;
              const subSchema = inferProbePropertySchema(subInit, subName, branch, equalityCondByVar);
              if (subSchema) {
                properties[subName] = subSchema;
                if (!required.includes(subName)) {
                  required.push(subName);
                }
              }
            }
          }
        }
      }
    }
  }

  if (Object.keys(properties).length === 0) return null;

  return {
    type: 'object',
    required,
    properties,
  };
}

function resolveSymbolDeclarations(sym: any): Node[] {
  if (!sym) return [];
  const targetSym = sym.getAliasedSymbol?.() ?? sym;
  return targetSym?.getDeclarations?.() ?? [];
}

const DOCUMENTED_RESPONSE_HEADERS: Record<
  string,
  { description: string; schema: Record<string, string> }
> = {
  'X-Total-Count': {
    description: 'Total matching record count before pagination',
    schema: { type: 'integer' },
  },
  'X-Page': {
    description: 'Current 1-based page number',
    schema: { type: 'integer' },
  },
  'X-Limit': {
    description: 'Effective page size limit applied to the query',
    schema: { type: 'integer' },
  },
  'X-Total-Pages': {
    description: 'Total pages available at the current limit',
    schema: { type: 'integer' },
  },
  'X-Per-Page': {
    description: 'Effective page size limit alias',
    schema: { type: 'integer' },
  },
  'X-Current-Page': {
    description: 'Current 1-based page number alias',
    schema: { type: 'integer' },
  },
  'X-Has-Next-Page': {
    description: 'Whether a subsequent page exists',
    schema: { type: 'boolean' },
  },
  'X-Has-Prev-Page': {
    description: 'Whether a preceding page exists',
    schema: { type: 'boolean' },
  },
  'X-Next-Cursor': {
    description: 'Cursor identifier for fetching the next page',
    schema: { type: 'string' },
  },
};

function extractResponseHeadersFromNodes(
  allNodes: Node[]
): Record<string, { description: string; schema: Record<string, string> }> {
  const discovered = new Set<string>();

  for (const n of allNodes) {
    if (Node.isPropertyAssignment(n)) {
      const rawName = n.getName().replace(/^['"]|['"]$/g, '');
      if (DOCUMENTED_RESPONSE_HEADERS[rawName]) {
        discovered.add(rawName);
      }
    } else if (Node.isElementAccessExpression(n)) {
      const arg = n.getArgumentExpression();
      if (arg && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg))) {
        const rawName = arg.getLiteralValue();
        if (DOCUMENTED_RESPONSE_HEADERS[rawName]) {
          discovered.add(rawName);
        }
      }
    } else if (Node.isCallExpression(n)) {
      const expr = n.getExpression();
      if (
        Node.isPropertyAccessExpression(expr) &&
        expr.getName() === 'set' &&
        expr.getExpression().getText().endsWith('headers')
      ) {
        const firstArg = n.getArguments()[0];
        if (
          firstArg &&
          (Node.isStringLiteral(firstArg) || Node.isNoSubstitutionTemplateLiteral(firstArg))
        ) {
          const rawName = firstArg.getLiteralValue();
          if (DOCUMENTED_RESPONSE_HEADERS[rawName]) {
            discovered.add(rawName);
          }
        }
      }
    }
  }

  const headers: Record<string, { description: string; schema: Record<string, string> }> = {};
  for (const headerName of Object.keys(DOCUMENTED_RESPONSE_HEADERS)) {
    if (discovered.has(headerName)) {
      headers[headerName] = {
        description: DOCUMENTED_RESPONSE_HEADERS[headerName].description,
        schema: { ...DOCUMENTED_RESPONSE_HEADERS[headerName].schema },
      };
    }
  }

  return headers;
}

function resolveObjectLiteral(node: Node | undefined, overrideSym?: any): Node | undefined {
  if (!node && !overrideSym) return undefined;
  if (node && Node.isObjectLiteralExpression(node)) return node;
  const sym = overrideSym ?? (node && Node.isIdentifier(node) ? node.getSymbol() : undefined);
  for (const decl of resolveSymbolDeclarations(sym)) {
    if (Node.isVariableDeclaration(decl)) {
      const init = decl.getInitializer();
      if (init && Node.isObjectLiteralExpression(init)) {
        return init;
      }
    }
  }
  return undefined;
}

function extractNumericLiteralsFromSymbol(
  sym: any,
  allNodes: Node[],
  visitedSyms: Set<any>
): number[] {
  const targetSym = sym?.getAliasedSymbol?.() ?? sym;
  if (!targetSym || visitedSyms.has(targetSym)) return [];
  visitedSyms.add(targetSym);

  const nums: number[] = [];
  for (const decl of resolveSymbolDeclarations(targetSym)) {
    if (Node.isVariableDeclaration(decl)) {
      nums.push(...extractNumericLiteralsFromExpr(decl.getInitializer(), allNodes, visitedSyms));
    } else if (Node.isParameterDeclaration(decl)) {
      const fnDecl = decl.getParent();
      if (
        fnDecl &&
        (Node.isFunctionDeclaration(fnDecl) ||
          Node.isArrowFunction(fnDecl) ||
          Node.isFunctionExpression(fnDecl))
      ) {
        const params = fnDecl.getParameters();
        const paramIdx = params.indexOf(decl);
        let fnName: string | undefined;
        if (Node.isFunctionDeclaration(fnDecl)) {
          fnName = fnDecl.getName();
        } else {
          const parentVar = fnDecl.getParent();
          if (parentVar && Node.isVariableDeclaration(parentVar)) {
            fnName = parentVar.getName();
          }
        }
        if (fnName && paramIdx >= 0) {
          for (const candidate of allNodes) {
            if (!Node.isCallExpression(candidate)) continue;
            if (candidate.getExpression().getText() === fnName) {
              const callArg = candidate.getArguments()[paramIdx];
              nums.push(...extractNumericLiteralsFromExpr(callArg, allNodes, visitedSyms));
            }
          }
        }
      }
    }
  }
  return Array.from(new Set(nums));
}

function extractNumericLiteralsFromExpr(
  expr: Node | undefined,
  allNodes: Node[],
  visitedSyms = new Set<any>()
): number[] {
  if (!expr) return [];
  if (Node.isNumericLiteral(expr)) {
    return [Number(expr.getLiteralValue())];
  }
  if (Node.isConditionalExpression(expr)) {
    return [
      ...extractNumericLiteralsFromExpr(expr.getWhenTrue(), allNodes, visitedSyms),
      ...extractNumericLiteralsFromExpr(expr.getWhenFalse(), allNodes, visitedSyms),
    ];
  }
  if (Node.isIdentifier(expr)) {
    return extractNumericLiteralsFromSymbol(expr.getSymbol(), allNodes, visitedSyms);
  }
  return [];
}

function extractStatusesFromInitObject(initArg: Node | undefined, allNodes: Node[]): number[] {
  const initObj = resolveObjectLiteral(initArg);
  if (!initObj || !Node.isObjectLiteralExpression(initObj)) return [200];
  const statusProp = initObj.getProperty('status');
  if (!statusProp) return [200];

  if (Node.isPropertyAssignment(statusProp)) {
    const resolved = extractNumericLiteralsFromExpr(statusProp.getInitializer(), allNodes);
    return resolved.length > 0 ? resolved : [200];
  }

  if (Node.isShorthandPropertyAssignment(statusProp)) {
    const valSym = (statusProp as any).getValueSymbol?.() ?? statusProp.getSymbol();
    const resolved = extractNumericLiteralsFromSymbol(valSym, allNodes, new Set());
    return resolved.length > 0 ? resolved : [200];
  }

  return [200];
}

interface ExtractedHeadersInfo {
  literalContentType: string | null;
  hasDynamicContentType: boolean;
  isAttachment: boolean;
  responseHeaders: Record<string, { description: string; schema: Record<string, any> }>;
}

function collectPropertiesFromHeadersObject(
  headersObj: Node | undefined,
  info: ExtractedHeadersInfo,
  visited = new Set<Node>(),
  overrideSym?: any
) {
  const resolved = resolveObjectLiteral(headersObj, overrideSym);
  if (!resolved || !Node.isObjectLiteralExpression(resolved) || visited.has(resolved)) return;
  visited.add(resolved);

  for (const prop of resolved.getProperties()) {
    if (Node.isSpreadAssignment(prop)) {
      collectPropertiesFromHeadersObject(prop.getExpression(), info, visited);
      continue;
    }
    if (!Node.isPropertyAssignment(prop)) continue;
    const headerKey = prop.getName().replace(/^['"]|['"]$/g, '');
    const lowerName = headerKey.toLowerCase();
    const valInit = prop.getInitializer();

    if (lowerName === 'content-type') {
      if (valInit && (Node.isStringLiteral(valInit) || Node.isNoSubstitutionTemplateLiteral(valInit))) {
        info.literalContentType = valInit.getLiteralValue().split(';')[0].trim().toLowerCase();
      } else if (valInit) {
        info.hasDynamicContentType = true;
      }
      info.responseHeaders[headerKey] = {
        description: info.hasDynamicContentType
          ? 'Dynamic MIME type of the streamed asset'
          : 'Response MIME content type',
        schema: { type: 'string' },
      };
    } else if (lowerName === 'content-disposition') {
      const text = valInit?.getText() ?? '';
      if (/attachment/i.test(text)) {
        info.isAttachment = true;
      }
      info.responseHeaders[headerKey] = {
        description: 'Content disposition attachment header',
        schema: { type: 'string' },
      };
    } else if (lowerName === 'content-length') {
      info.responseHeaders[headerKey] = {
        description: 'Size of the response payload in bytes',
        schema: { type: 'integer', minimum: 0 },
      };
    } else if (lowerName === 'last-modified') {
      info.responseHeaders[headerKey] = {
        description: 'RFC 7231 last-modified timestamp',
        schema: { type: 'string' },
      };
    } else if (lowerName === 'cache-control') {
      info.responseHeaders[headerKey] = {
        description: 'HTTP cache control directives',
        schema: { type: 'string' },
      };
    } else if (lowerName === 'vary') {
      info.responseHeaders[headerKey] = {
        description: 'Cache key variance header names',
        schema: { type: 'string' },
      };
    } else if (lowerName === 'x-content-type-options') {
      info.responseHeaders[headerKey] = {
        description: 'MIME-sniffing protection header',
        schema: { type: 'string' },
      };
    }
  }
}

function extractHeadersInfoFromInitObject(initArg: Node | undefined): ExtractedHeadersInfo {
  const info: ExtractedHeadersInfo = {
    literalContentType: null,
    hasDynamicContentType: false,
    isAttachment: false,
    responseHeaders: {},
  };

  const initObj = resolveObjectLiteral(initArg);
  if (!initObj || !Node.isObjectLiteralExpression(initObj)) return info;
  const headersProp = initObj.getProperty('headers');
  if (!headersProp) return info;

  if (Node.isPropertyAssignment(headersProp)) {
    collectPropertiesFromHeadersObject(headersProp.getInitializer(), info);
  } else if (Node.isShorthandPropertyAssignment(headersProp)) {
    const valSym = (headersProp as any).getValueSymbol?.() ?? headersProp.getSymbol();
    collectPropertiesFromHeadersObject(undefined, info, new Set(), valSym);
  }

  return info;
}

const GENERIC_JSON_VALUE_SCHEMA = {
  nullable: true,
  anyOf: [
    { type: 'object', additionalProperties: true },
    { type: 'array', items: { type: 'object', additionalProperties: true } },
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
  ],
};

function inferSchemaFromTsType(tsType: any, depth = 0, seen = new Set<any>()): Record<string, any> {
  if (!tsType || depth > 2 || seen.has(tsType)) {
    return { type: 'object', additionalProperties: true };
  }

  if (tsType.isAny() || tsType.isUnknown()) {
    return { ...GENERIC_JSON_VALUE_SCHEMA };
  }

  if (tsType.isNull() || tsType.isUndefined()) {
    return { type: 'string', nullable: true };
  }

  if (tsType.isBoolean() || tsType.isBooleanLiteral()) {
    return { type: 'boolean' };
  }

  if (tsType.isNumber() || tsType.isNumberLiteral()) {
    return { type: 'number' };
  }

  if (tsType.isString() || tsType.isStringLiteral()) {
    return { type: 'string' };
  }

  const typeText = tsType.getText?.() ?? '';
  if (typeText === 'Date' || typeText === 'globalThis.Date') {
    return { type: 'string', format: 'date-time' };
  }

  if (tsType.isUnion()) {
    const unionTypes = tsType.getUnionTypes();
    const hasNull = unionTypes.some((t: any) => t.isNull() || t.isUndefined());
    const nonNull = unionTypes.filter((t: any) => !t.isNull() && !t.isUndefined());

    if (nonNull.length === 0) {
      return { type: 'string', nullable: true };
    }

    if (nonNull.every((t: any) => t.isBoolean() || t.isBooleanLiteral())) {
      return hasNull ? { type: 'boolean', nullable: true } : { type: 'boolean' };
    }

    if (nonNull.every((t: any) => t.isString() || t.isStringLiteral())) {
      const literals = nonNull
        .filter((t: any) => t.isStringLiteral())
        .map((t: any) => t.getLiteralValue());
      const base: Record<string, any> =
        literals.length === nonNull.length && literals.length > 0
          ? { type: 'string', enum: Array.from(new Set(literals)) }
          : { type: 'string' };
      if (hasNull) base.nullable = true;
      return base;
    }

    if (nonNull.every((t: any) => t.isNumber() || t.isNumberLiteral())) {
      return hasNull ? { type: 'number', nullable: true } : { type: 'number' };
    }

    if (nonNull.length === 1) {
      const single = inferSchemaFromTsType(nonNull[0], depth, seen);
      if (hasNull) single.nullable = true;
      return single;
    }

    return hasNull
      ? { ...GENERIC_JSON_VALUE_SCHEMA }
      : { type: 'object', additionalProperties: true };
  }

  if (tsType.isArray()) {
    const elemType = tsType.getArrayElementType();
    const nextSeen = new Set(seen);
    nextSeen.add(tsType);
    const items = elemType
      ? inferSchemaFromTsType(elemType, depth + 1, nextSeen)
      : { type: 'object', additionalProperties: true };
    return { type: 'array', items };
  }

  if (tsType.isObject()) {
    const props = tsType.getProperties?.() ?? [];
    if (props.length > 0 && props.length <= 40 && depth < 2) {
      const nextSeen = new Set(seen);
      nextSeen.add(tsType);
      const properties: Record<string, any> = {};
      const required: string[] = [];

      for (const propSym of props) {
        const name = propSym.getName();
        if (name.startsWith('__')) continue;
        const decls = propSym.getDeclarations?.() ?? [];
        const firstDecl = decls[0];
        if (firstDecl && (Node.isMethodSignature(firstDecl) || Node.isMethodDeclaration(firstDecl))) {
          continue;
        }
        const propType = firstDecl ? propSym.getTypeAtLocation(firstDecl) : propSym.getDeclaredType?.();
        if (propType?.getCallSignatures?.()?.length > 0) continue;

        properties[name] = propType
          ? inferSchemaFromTsType(propType, depth + 1, nextSeen)
          : { ...GENERIC_JSON_VALUE_SCHEMA };

        if (!propSym.isOptional?.()) {
          required.push(name);
        }
      }

      if (Object.keys(properties).length > 0) {
        const objSchema: Record<string, any> = {
          type: 'object',
          properties,
        };
        if (required.length > 0) {
          objSchema.required = required;
        }
        return objSchema;
      }
    }
    return { type: 'object', additionalProperties: true };
  }

  return { ...GENERIC_JSON_VALUE_SCHEMA };
}

function inferSchemaFromExpression(
  expr: Node | undefined
): { schema: Record<string, any>; hasTopLevelSuccess: boolean } {
  if (!expr) {
    return {
      schema: { type: 'object', additionalProperties: true },
      hasTopLevelSuccess: false,
    };
  }

  if (Node.isObjectLiteralExpression(expr)) {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    let hasTopLevelSuccess = false;
    let hasSpread = false;

    for (const prop of expr.getProperties()) {
      if (Node.isPropertyAssignment(prop)) {
        const name = prop.getName().replace(/^['"]|['"]$/g, '');
        if (name === 'success') hasTopLevelSuccess = true;
        const init = prop.getInitializer();
        if (init) {
          if (Node.isTrueLiteral(init)) {
            properties[name] = { type: 'boolean', enum: [true] };
          } else if (Node.isFalseLiteral(init)) {
            properties[name] = { type: 'boolean', enum: [false] };
          } else if (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init)) {
            properties[name] = { type: 'string' };
          } else if (Node.isNumericLiteral(init)) {
            properties[name] = { type: 'number' };
          } else if (Node.isObjectLiteralExpression(init) || Node.isArrayLiteralExpression(init)) {
            properties[name] = inferSchemaFromExpression(init).schema;
          } else {
            properties[name] = inferSchemaFromTsType(init.getType(), 1);
          }
        } else {
          properties[name] = { ...GENERIC_JSON_VALUE_SCHEMA };
        }
        required.push(name);
      } else if (Node.isShorthandPropertyAssignment(prop)) {
        const name = prop.getName();
        if (name === 'success') hasTopLevelSuccess = true;
        properties[name] = inferSchemaFromTsType(prop.getType(), 1);
        required.push(name);
      } else if (Node.isSpreadAssignment(prop)) {
        hasSpread = true;
        const spreadSchema = inferSchemaFromTsType(prop.getExpression().getType(), 1);
        if (spreadSchema.properties && typeof spreadSchema.properties === 'object') {
          for (const [k, v] of Object.entries(spreadSchema.properties)) {
            if (!(k in properties)) {
              properties[k] = v;
            }
          }
          for (const reqKey of spreadSchema.required ?? []) {
            if (!required.includes(reqKey)) {
              required.push(reqKey);
            }
          }
          if ('success' in spreadSchema.properties) {
            hasTopLevelSuccess = true;
          }
        }
      }
    }

    const schema: Record<string, any> = {
      type: 'object',
    };
    if (Object.keys(properties).length > 0) {
      schema.properties = properties;
      if (required.length > 0) {
        schema.required = Array.from(new Set(required));
      }
      if (hasSpread) {
        schema.additionalProperties = true;
      }
    } else {
      schema.additionalProperties = true;
    }

    return { schema, hasTopLevelSuccess };
  }

  if (Node.isArrayLiteralExpression(expr)) {
    const elements = expr.getElements();
    const itemSchema =
      elements.length > 0
        ? inferSchemaFromExpression(elements[0]).schema
        : { type: 'object', additionalProperties: true };
    return {
      schema: { type: 'array', items: itemSchema },
      hasTopLevelSuccess: false,
    };
  }

  const tsSchema = inferSchemaFromTsType(expr.getType(), 0);
  const hasTopLevelSuccess = Boolean(
    tsSchema.type === 'object' && tsSchema.properties && 'success' in tsSchema.properties
  );
  return { schema: tsSchema, hasTopLevelSuccess };
}

function detectMiddlewareWrapped(directNodes: Node[], allNodes: Node[]): boolean {
  for (const n of [...directNodes, ...allNodes]) {
    if (!Node.isCallExpression(n)) continue;
    const exprText = n.getExpression().getText();
    if (exprText === 'withApiMiddleware' || exprText === 'createValidatedRoute') {
      return true;
    }
  }
  return false;
}

function detectHealthProbeWrapped(
  directNodes: Node[],
  allNodes: Node[],
  routePath: string
): boolean {
  if (routePath === '/api/health') {
    return true;
  }
  for (const n of [...directNodes, ...allNodes]) {
    if (!Node.isCallExpression(n)) continue;
    const exprText = n.getExpression().getText();
    if (exprText !== 'withApiMiddleware' && exprText !== 'createValidatedRoute') continue;
    const optionsArg = n.getArguments()[1];
    if (optionsArg && /\bisHealthProbe\s*:\s*true\b/.test(optionsArg.getText())) {
      return true;
    }
  }
  return false;
}

function tryMergeCompatibleObjectEnumSchemas(
  schemas: Array<Record<string, any>>
): Record<string, any> | null {
  if (schemas.length < 2) return null;

  const isPlainEnumMergeableObject = (s: Record<string, any>): boolean =>
    Boolean(
      s &&
        s.type === 'object' &&
        !s.anyOf &&
        !s.oneOf &&
        !s.allOf &&
        !s.$ref &&
        s.additionalProperties === undefined &&
        s.properties &&
        typeof s.properties === 'object' &&
        !Array.isArray(s.properties)
    );

  if (!schemas.every(isPlainEnumMergeableObject)) {
    return null;
  }

  const base = schemas[0];
  const basePropKeys = Object.keys(base.properties);
  const baseReqSorted = JSON.stringify([...(base.required ?? [])].sort());

  for (const candidate of schemas.slice(1)) {
    if (JSON.stringify([...(candidate.required ?? [])].sort()) !== baseReqSorted) {
      return null;
    }
    const candKeys = Object.keys(candidate.properties);
    if (candKeys.length !== basePropKeys.length || !basePropKeys.every((k) => k in candidate.properties)) {
      return null;
    }
  }

  const mergedProperties: Record<string, any> = {};
  for (const propKey of basePropKeys) {
    const propVariants = schemas.map((s) => s.properties[propKey]);
    const firstVariant = propVariants[0];
    const firstJson = JSON.stringify(firstVariant);

    if (propVariants.every((v) => JSON.stringify(v) === firstJson)) {
      mergedProperties[propKey] = JSON.parse(firstJson);
      continue;
    }

    const canMergeEnum = propVariants.every(
      (v) =>
        v &&
        typeof v === 'object' &&
        !Array.isArray(v) &&
        typeof v.type === 'string' &&
        v.type === firstVariant.type &&
        v.format === firstVariant.format &&
        v.nullable === firstVariant.nullable &&
        Array.isArray(v.enum) &&
        Object.keys(v).every((k) => ['type', 'enum', 'format', 'nullable', 'description'].includes(k))
    );

    if (!canMergeEnum) {
      return null;
    }

    const combinedEnum = Array.from(new Set(propVariants.flatMap((v) => v.enum)));
    const mergedProp: Record<string, any> = {
      ...JSON.parse(firstJson),
      enum: combinedEnum,
    };
    mergedProperties[propKey] = mergedProp;
  }

  const mergedObj: Record<string, any> = {
    type: 'object',
    ...(Array.isArray(base.required) ? { required: [...base.required] } : {}),
    properties: mergedProperties,
  };
  return mergedObj;
}

function mergeDistinctSchemas(schemas: Array<Record<string, any>>): Record<string, any> {
  const unique: Array<Record<string, any>> = [];
  const seen = new Set<string>();

  for (const s of schemas) {
    const sanitized = sanitizeOpenApi30Node(JSON.parse(JSON.stringify(s)));
    const key = JSON.stringify(sanitized);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(sanitized);
    }
  }

  if (unique.length === 0) {
    return { type: 'object', additionalProperties: true };
  }
  if (unique.length === 1) {
    return unique[0];
  }
  const mergedObjectEnumSchema = tryMergeCompatibleObjectEnumSchemas(unique);
  if (mergedObjectEnumSchema) {
    return mergedObjectEnumSchema;
  }
  return unique.every(isObjectJsonSchema)
    ? { type: 'object', anyOf: unique }
    : { anyOf: unique };
}

interface ExtractOperationResponsesOptions {
  routePath: string;
  method: string;
  directNodes: Node[];
  allNodes: Node[];
  hasRequestBody: boolean;
  hasQueryParams: boolean;
  hasPathParams: boolean;
  hasSecurity: boolean;
}

function extractOperationResponses(opts: ExtractOperationResponsesOptions): Record<string, any> {
  const {
    routePath,
    method,
    directNodes,
    allNodes,
    hasRequestBody,
    hasQueryParams,
    hasPathParams,
    hasSecurity,
  } = opts;

  const usesMiddleware = detectMiddlewareWrapped(directNodes, allNodes);
  const documentedHeaders = extractResponseHeadersFromNodes(allNodes);
  const isHealthProbe =
    usesMiddleware && detectHealthProbeWrapped(directNodes, allNodes, routePath);
  const { statusBranchesByVar, equalityCondByVar } = extractLocalStatusBranches(allNodes);
  const exportMediaByStatus = new Map<number, string[]>();
  const jsonSchemasByStatus = new Map<number, Array<Record<string, any>>>();
  const textErrorStatuses = new Set<number>();
  const dynamicStreamHeadersByStatus = new Map<
    number,
    Record<string, { description: string; schema: Record<string, any> }>
  >();
  const jsonAttachmentHeadersByStatus = new Map<
    number,
    Record<string, { description: string; schema: Record<string, any> }>
  >();
  const explicitErrorStatuses = new Set<number>();

  function recordExportMedia(status: number, mediaType: string) {
    if (!exportMediaByStatus.has(status)) {
      exportMediaByStatus.set(status, []);
    }
    const existing = exportMediaByStatus.get(status)!;
    if (!existing.includes(mediaType)) {
      existing.push(mediaType);
    }
  }

  function recordJsonSchema(status: number, schema: Record<string, any>) {
    if (!jsonSchemasByStatus.has(status)) {
      jsonSchemasByStatus.set(status, []);
    }
    jsonSchemasByStatus.get(status)!.push(schema);
  }

  for (const n of allNodes) {
    if (Node.isCallExpression(n)) {
      const exprText = n.getExpression().getText();
      if (exprText === 'NextResponse.json' || exprText === 'Response.json') {
        const payloadArg = n.getArguments()[0];
        const initArg = n.getArguments()[1];
        const statuses = extractStatusesFromInitObject(initArg, allNodes);
        const probeBranches = extractProbeStatusBranchesFromInitObject(initArg, statusBranchesByVar);

        for (const status of statuses) {
          const branch = probeBranches.find((b) => b.status === status) ?? { status };
          const rawProbeSchema = extractProbeObjectSchema(payloadArg, branch, equalityCondByVar);

          if (status >= 200 && status < 300) {
            const { schema, hasTopLevelSuccess } = rawProbeSchema
              ? {
                schema: rawProbeSchema,
                hasTopLevelSuccess: Boolean(
                  rawProbeSchema.properties && 'success' in rawProbeSchema.properties
                ),
              }
              : inferSchemaFromExpression(payloadArg);
            if (usesMiddleware && !hasTopLevelSuccess) {
              recordJsonSchema(status, {
                type: 'object',
                required: ['success', 'data'],
                properties: {
                  success: { type: 'boolean', enum: [true] },
                  data: schema,
                },
              });
            } else {
              recordJsonSchema(status, schema);
            }
          } else if (status >= 400) {
            explicitErrorStatuses.add(status);
            if (!usesMiddleware) {
              const schema = rawProbeSchema ?? inferSchemaFromExpression(payloadArg).schema;
              recordJsonSchema(status, schema);
            } else if (isHealthProbe) {
              const baseSchema = rawProbeSchema ?? inferSchemaFromExpression(payloadArg).schema;
              if (baseSchema && baseSchema.type === 'object' && baseSchema.properties) {
                const baseRequired = Array.isArray(baseSchema.required) ? baseSchema.required : [];
                const mergedRequired = [
                  'success',
                  ...baseRequired.filter((k: string) => k !== 'success'),
                ];
                recordJsonSchema(status, {
                  type: 'object',
                  required: mergedRequired,
                  properties: {
                    success: { type: 'boolean', enum: [false] },
                    ...baseSchema.properties,
                  },
                });
              }
            }
          }
        }
      }
    } else if (Node.isNewExpression(n)) {
      const exprText = n.getExpression().getText();
      if (exprText === 'ApiError') {
        const firstArg = n.getArguments()[0];
        for (const errStatus of extractNumericLiteralsFromExpr(firstArg, allNodes)) {
          if (errStatus >= 400) {
            explicitErrorStatuses.add(errStatus);
          }
        }
      } else if (exprText === 'ImageResponse') {
        const statuses = extractStatusesFromInitObject(n.getArguments()[1], allNodes);
        for (const status of statuses) {
          if (status >= 200 && status < 300) {
            recordExportMedia(status, 'image/png');
          }
        }
      } else if (exprText === 'NextResponse' || exprText === 'Response') {
        const bodyArg = n.getArguments()[0];
        const initArg = n.getArguments()[1];
        const statuses = extractStatusesFromInitObject(initArg, allNodes);
        const headerInfo = extractHeadersInfoFromInitObject(initArg);

        for (const status of statuses) {
          if (status >= 200 && status < 300) {
            if (headerInfo.literalContentType && EXPORT_MEDIA_SCHEMAS[headerInfo.literalContentType]) {
              recordExportMedia(status, headerInfo.literalContentType);
            } else if (headerInfo.literalContentType === 'application/json' && headerInfo.isAttachment) {
              jsonAttachmentHeadersByStatus.set(status, headerInfo.responseHeaders);
              const backupSchema =
                routePath === '/api/admin/maintenance/export' && ALL_SCHEMAS.DatabaseBackupSchema
                  ? toOpenApiSchema(ALL_SCHEMAS.DatabaseBackupSchema, false)
                  : { type: 'object', additionalProperties: true };
              recordJsonSchema(status, backupSchema);
            } else if (headerInfo.hasDynamicContentType) {
              dynamicStreamHeadersByStatus.set(status, headerInfo.responseHeaders);
            }
          } else if (status >= 400) {
            explicitErrorStatuses.add(status);
            if (!usesMiddleware && bodyArg && !Node.isNullLiteral(bodyArg)) {
              textErrorStatuses.add(status);
            }
          }
        }
      }
    }
  }

  const successStatuses = new Set<number>([
    ...exportMediaByStatus.keys(),
    ...[...jsonSchemasByStatus.keys()].filter((s) => s >= 200 && s < 300),
    ...dynamicStreamHeadersByStatus.keys(),
  ]);

  if (successStatuses.size === 0) {
    successStatuses.add(200);
    if (usesMiddleware) {
      recordJsonSchema(200, {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { type: 'object', additionalProperties: true },
        },
      });
    } else {
      recordJsonSchema(200, { type: 'object', additionalProperties: true });
    }
  }

  const responses: Record<string, any> = {};
  const sortedSuccessStatuses = Array.from(successStatuses).sort((a, b) => a - b);

  for (const status of sortedSuccessStatuses) {
    const exportMedia = exportMediaByStatus.get(status) ?? [];
    const dynamicHeaders = dynamicStreamHeadersByStatus.get(status);
    const attachmentHeaders = jsonAttachmentHeadersByStatus.get(status);
    const jsonSchemas = jsonSchemasByStatus.get(status) ?? [];

    const responseObj: Record<string, any> = {
      description:
        status === 201
          ? 'Created'
          : method === 'HEAD'
            ? 'Asset metadata headers response (empty payload body)'
            : attachmentHeaders
              ? 'Streamed JSON attachment response'
              : 'Successful response',
    };

    const mergedHeaders: Record<string, { description: string; schema: Record<string, any> }> = {
      ...(status === 200 ? documentedHeaders : {}),
      ...(attachmentHeaders ?? {}),
      ...(dynamicHeaders ?? {}),
    };
    if (Object.keys(mergedHeaders).length > 0) {
      responseObj.headers = mergedHeaders;
    }

    if (exportMedia.length > 0) {
      responseObj.content = {};
      for (const mt of exportMedia) {
        responseObj.content[mt] = {
          schema: { ...EXPORT_MEDIA_SCHEMAS[mt] },
        };
      }
    } else if (dynamicHeaders) {
      responseObj.content = {
        'application/octet-stream': {
          schema: {
            type: 'string',
            format: 'binary',
          },
        },
      };
    } else if (jsonSchemas.length > 0) {
      responseObj.content = {
        'application/json': {
          schema: mergeDistinctSchemas(jsonSchemas),
        },
      };
    }

    responses[String(status)] = responseObj;
  }

  if (hasRequestBody || hasQueryParams) {
    explicitErrorStatuses.add(400);
  }
  if (hasSecurity) {
    explicitErrorStatuses.add(401);
  }
  if (hasPathParams) {
    explicitErrorStatuses.add(404);
  }
  if (usesMiddleware) {
    if (routePath !== '/api/health') {
      explicitErrorStatuses.add(429);
    }
    explicitErrorStatuses.add(500);
  } else if (explicitErrorStatuses.size === 0) {
    explicitErrorStatuses.add(500);
  }

  const sortedErrorStatuses = Array.from(explicitErrorStatuses).sort((a, b) => a - b);
  for (const errStatus of sortedErrorStatuses) {
    const description = ERROR_STATUS_DESCRIPTIONS[errStatus] || 'Error response';
    if (usesMiddleware) {
      const healthErrSchemas = isHealthProbe ? (jsonSchemasByStatus.get(errStatus) ?? []) : [];
      responses[String(errStatus)] = {
        description,
        content: {
          'application/json': {
            schema:
              healthErrSchemas.length > 0
                ? mergeDistinctSchemas(healthErrSchemas)
                : { $ref: '#/components/schemas/ApiErrorEnvelope' },
          },
        },
      };
    } else if (textErrorStatuses.has(errStatus)) {
      responses[String(errStatus)] = {
        description,
        content: {
          'text/plain': {
            schema: { type: 'string' },
          },
        },
      };
    } else {
      const customErrSchemas = jsonSchemasByStatus.get(errStatus) ?? [];
      responses[String(errStatus)] = {
        description,
        content: {
          'application/json': {
            schema:
              customErrSchemas.length > 0
                ? mergeDistinctSchemas(customErrSchemas)
                : { ...RAW_JSON_ERROR_SCHEMA },
          },
        },
      };
    }
  }

  return responses;
}

function extractQueryParameters(allNodes: Node[]): Array<{
  name: string;
  in: 'query';
  required: boolean;
  schema: Record<string, any>;
}> {
  const paramNames: string[] = [];
  const seen = new Set<string>();
  const varByParam = new Map<string, string>();

  for (const n of allNodes) {
    if (!Node.isCallExpression(n)) continue;
    const expr = n.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) continue;

    const methodName = expr.getName();
    if (!['get', 'getAll', 'has'].includes(methodName)) continue;

    const receiverText = expr.getExpression().getText();
    if (!receiverText.endsWith('searchParams')) continue;

    const args = n.getArguments();
    if (args.length === 0) continue;
    const firstArg = args[0];
    if (!Node.isStringLiteral(firstArg) && !Node.isNoSubstitutionTemplateLiteral(firstArg)) continue;

    const paramName = firstArg.getLiteralValue();
    if (!paramName) continue;

    if (!seen.has(paramName)) {
      seen.add(paramName);
      paramNames.push(paramName);
    }

    const varDecl = n.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
    if (varDecl && Node.isIdentifier(varDecl.getNameNode())) {
      varByParam.set(paramName, varDecl.getName());
    }
  }

  if (paramNames.length === 0) return [];

  let zodQueryProps: Record<string, any> = {};
  const zodRequiredQueryParams = new Set<string>();
  for (const n of allNodes) {
    if (!Node.isCallExpression(n)) continue;
    const exprText = n.getExpression().getText();
    if (exprText.includes('.safeParse') || exprText.includes('.parse')) {
      const schemaName = exprText.split('.')[0].replace(/.*\./, '');
      if (schemaName.endsWith('QuerySchema') && ALL_SCHEMAS[schemaName]) {
        const converted = toOpenApiSchema(ALL_SCHEMAS[schemaName], false);
        if (converted?.properties) {
          zodQueryProps = { ...zodQueryProps, ...converted.properties };
        }
        if (Array.isArray(converted?.required)) {
          for (const reqField of converted.required) {
            if (typeof reqField === 'string') {
              zodRequiredQueryParams.add(reqField);
            }
          }
        }
      }
    }
  }

  const parsedIntVars = new Set<string>();
  const parsedFloatVars = new Set<string>();
  const requiredVars = new Set<string>();

  for (const n of allNodes) {
    if (Node.isCallExpression(n)) {
      const callee = n.getExpression().getText();
      const firstArg = n.getArguments()[0]?.getText() ?? '';
      const baseVar = firstArg.replace(/\..*$/, '');
      if (callee === 'parseInt' || callee === 'Number.parseInt') {
        parsedIntVars.add(baseVar);
      } else if (callee === 'parseFloat' || callee === 'Number.parseFloat') {
        parsedFloatVars.add(baseVar);
      }
    } else if (Node.isIfStatement(n)) {
      const condText = n.getExpression().getText().trim();
      const negMatch = condText.match(/^!([A-Za-z_$][A-Za-z0-9_$]*)$/);
      if (negMatch) {
        const thenText = n.getThenStatement().getText();
        if (/ApiError\(\s*400\b|status:\s*400\b/.test(thenText)) {
          requiredVars.add(negMatch[1]);
        }
      }
    }
  }

  return paramNames.map((name) => {
    const linkedVar = varByParam.get(name);
    let paramSchema: Record<string, any> = { type: 'string' };

    if (zodQueryProps[name]) {
      paramSchema = zodQueryProps[name];
    } else if (linkedVar && parsedIntVars.has(linkedVar)) {
      paramSchema = { type: 'integer' };
    } else if (linkedVar && parsedFloatVars.has(linkedVar)) {
      paramSchema = { type: 'number' };
    }

    const isRequired =
      zodRequiredQueryParams.has(name) || Boolean(linkedVar && requiredVars.has(linkedVar));

    return {
      name,
      in: 'query' as const,
      required: isRequired,
      schema: paramSchema,
    };
  });
}

function resolveOperationSecurity(
  routePath: string,
  method: string,
  allNodes: Node[],
  publicApiExclusions: MiddlewareApiExclusions
): Array<Record<string, string[]>> | undefined {
  if (routePath === '/api/cron' || routePath.startsWith('/api/cron/')) {
    return [{ cronBearerAuth: [] }];
  }

  let usesStripeSignature = false;
  let callsGuestInviteSession = false;
  let callsGuestRequest = false;
  let enforcesSession401 = false;

  for (const n of allNodes) {
    if (Node.isCallExpression(n)) {
      const callText = n.getText();
      if (/headers\.get\(\s*['"]stripe-signature['"]\s*\)/.test(callText)) {
        usesStripeSignature = true;
      }
      const exprText = n.getExpression().getText();
      if (exprText === 'getGuestInviteSession') {
        callsGuestInviteSession = true;
      } else if (exprText === 'isGuestRequest') {
        callsGuestRequest = true;
      }
    } else if (Node.isIfStatement(n)) {
      const condText = n.getExpression().getText();
      if (/!(?:session|isGuest)\b/.test(condText)) {
        const thenText = n.getThenStatement().getText();
        if (/ApiError\(\s*401\b|status:\s*401\b/.test(thenText)) {
          enforcesSession401 = true;
        }
      }
    }
  }

  if (usesStripeSignature) {
    return [{ stripeSignature: [] }];
  }

  if (isProtectedRoute(routePath, method)) {
    return [{ adminCookieAuth: [] }];
  }

  if (callsGuestInviteSession && enforcesSession401) {
    return [{ guestInviteCookieAuth: [] }];
  }

  if (callsGuestRequest && enforcesSession401) {
    return [{ guestCookieAuth: [] }];
  }

  if (!isMiddlewarePublicApiRoute(routePath, method, publicApiExclusions)) {
    return [
      { guestCookieAuth: [] },
      { guestInviteCookieAuth: [] },
      { adminCookieAuth: [] },
    ];
  }

  return undefined;
}

async function run() {
  const publicApiExclusions = getMiddlewarePublicApiExclusions();
  const entitySlugs = extractAdminEntitySlugs();
  const entitySchemaNames = extractAdminEntitySchemaNames();

  const packageJson = JSON.parse(
    fs.readFileSync(path.join(rootPath, 'package.json'), 'utf8')
  ) as { version?: string };
  const readmeHeadingMatch = fs
    .readFileSync(path.join(rootPath, 'README.md'), 'utf8')
    .match(/^#\s+(.+)$/m);
  const productTitle = readmeHeadingMatch?.[1]?.trim()
    ? `${readmeHeadingMatch[1].trim()} API`
    : 'Wedding Website & Custom Registry API';

  const openapi: any = {
    openapi: '3.0.3',
    info: {
      title: productTitle,
      version: packageJson.version || '0.1.0',
      description:
        'OpenAPI 3.0.3 contract for the self-hostable Wedding Website & Custom Registry platform.',
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Local development server',
      },
      {
        url: '/',
        description: 'Current deployment origin',
      },
    ],
    tags: OPENAPI_TAGS.map(({ name, description }) => ({ name, description })),
    components: {
      schemas: {
        ApiErrorEnvelope: API_ERROR_ENVELOPE_SCHEMA,
      },
      securitySchemes: {
        adminCookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'admin_auth',
          description: 'Signed HMAC admin session cookie',
        },
        guestCookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'guest_auth',
          description: 'Signed HMAC guest passcode session cookie',
        },
        guestInviteCookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'guest_invite_session',
          description: 'Signed HMAC guest invitation code session cookie',
        },
        cronBearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Bearer token matching CRON_SECRET for scheduled background routes',
        },
        stripeSignature: {
          type: 'apiKey',
          in: 'header',
          name: 'stripe-signature',
          description: 'Cryptographic Stripe webhook signature verified with STRIPE_WEBHOOK_SECRET',
        },
      },
    },
    paths: {},
  };

  let missingSchemaCount = 0;

  const sortedFiles = routeFiles.sort((a, b) => a.getFilePath().localeCompare(b.getFilePath()));

  for (const file of sortedFiles) {
    const normalizedFilePath = file.getFilePath().replace(/\\/g, '/');
    const normalizedExtraApp = extraAppDir ? extraAppDir.replace(/\\/g, '/') : null;
    const appBasePrefix =
      normalizedExtraApp && normalizedFilePath.startsWith(`${normalizedExtraApp}/`)
        ? normalizedExtraApp
        : path.join(rootPath, 'src/app').replace(/\\/g, '/');
    const routePath = normalizedFilePath
      .slice(appBasePrefix.length)
      .replace(/\/route\.(ts|tsx)$/, '');
    const openapiPath = routePath
      .replace(/\[\.\.\.([^\]]+)\]/g, '{$1}')
      .replace(/\[([^\]]+)\]/g, '{$1}');

    if (!openapi.paths[openapiPath]) {
      openapi.paths[openapiPath] = {};
    }

    const exportedDecls = file.getExportedDeclarations();
    for (const [method, decls] of exportedDecls.entries()) {
      if ((HTTP_METHODS as readonly string[]).includes(method)) {
        const decl = decls[0];
        const handlerNode: any = decl;

        let jsDocNodes = handlerNode.getJsDocs ? handlerNode.getJsDocs() : [];
        if (jsDocNodes.length === 0 && handlerNode.getParent) {
          const parent = handlerNode.getParent();
          if (parent) {
            const listParent = parent.getParent();
            if (listParent && listParent.getJsDocs) {
              jsDocNodes = listParent.getJsDocs();
            }
          }
        }

        const description = jsDocNodes.map((doc: any) => doc.getCommentText()).join('\n\n');

        let isDeprecated = false;
        let deprecationReason = '';

        for (const doc of jsDocNodes) {
          const tags = doc.getTags ? doc.getTags() : [];
          for (const tag of tags) {
            if (tag.getTagName() === 'deprecated') {
              isDeprecated = true;
              const tagComment = tag.getComment();
              if (tagComment) {
                if (typeof tagComment === 'string') {
                  deprecationReason = tagComment.trim();
                } else if (Array.isArray(tagComment)) {
                  deprecationReason = tagComment
                    .map((c: any) => (typeof c === 'string' ? c : c.getText()))
                    .join('')
                    .trim();
                } else if (tagComment.getText) {
                  deprecationReason = tagComment.getText().trim();
                } else {
                  deprecationReason = String(tagComment).trim();
                }
              }
            }
          }
        }

        const directNodes = collectMethodScopedNodes(decl, method);
        const visitedDecls = new Set<Node>([decl]);
        const delegatedGroups = collectDelegatedHelperRoots(directNodes, method, visitedDecls);
        const allScopedNodes = [
          ...directNodes,
          ...delegatedGroups.flatMap((group) => group.nodes),
        ];

        const schemaNames = extractSchemaNames(directNodes, delegatedGroups, entitySchemaNames);

        const operation: any = {
          tags: [resolveOperationTag(routePath)],
          summary: `${method} ${routePath}`,
          description: description || `Endpoint for ${routePath}`,
        };

        if (isDeprecated) {
          operation.deprecated = true;
          if (deprecationReason) {
            operation.description = operation.description
              ? `${operation.description} ${deprecationReason}`
              : deprecationReason;
          }
        }

        const security = resolveOperationSecurity(routePath, method, allScopedNodes, publicApiExclusions);
        if (security) {
          operation.security = security;
        }

        const parameters: any[] = [];
        const pathParams = openapiPath.match(/\{([^}]+)\}/g);
        if (pathParams) {
          parameters.push(
            ...pathParams.map((param: string) => {
              const paramName = param.replace(/[{}]/g, '');
              const paramSchema: Record<string, any> = { type: 'string' };
              if (paramName === 'entity' && entitySlugs.length > 0) {
                paramSchema.enum = entitySlugs;
              }
              return {
                name: paramName,
                in: 'path',
                required: true,
                schema: paramSchema,
              };
            })
          );
        }

        const queryParams = extractQueryParameters(allScopedNodes);
        if (queryParams.length > 0) {
          parameters.push(...queryParams);
        }

        if (parameters.length > 0) {
          operation.parameters = parameters;
        }

        if (BODY_METHODS.has(method)) {
          const { acceptsBody, acceptsFormData, allowsMissingJsonBody } =
            detectBodyCapabilities(allScopedNodes);

          if (acceptsBody) {
            if (schemaNames.length === 0) {
              console.error(`ERROR: Route ${method} ${routePath} accepts data but lacks a Zod validation schema!`);
              missingSchemaCount++;
              continue;
            }

            const missingDefinitions = schemaNames.filter((name) => !ALL_SCHEMAS[name]);
            if (missingDefinitions.length > 0) {
              console.error(
                `ERROR: Could not find schema definition for '${missingDefinitions.join(', ')}' in ALL_SCHEMAS`
              );
              missingSchemaCount++;
              continue;
            }

            try {
              let jsonSchema: any;
              if (schemaNames.length === 1) {
                jsonSchema = toOpenApiSchema(ALL_SCHEMAS[schemaNames[0]], acceptsFormData);
              } else {
                const branchSchemas = schemaNames.map((name) =>
                  toOpenApiSchema(ALL_SCHEMAS[name], acceptsFormData)
                );
                jsonSchema = branchSchemas.every(isObjectJsonSchema)
                  ? { type: 'object', anyOf: branchSchemas }
                  : { anyOf: branchSchemas };
              }

              const schemaAcceptsEmptyObject =
                !acceptsFormData &&
                schemaNames.every(
                  (name) =>
                    typeof ALL_SCHEMAS[name]?.safeParse === 'function' &&
                    ALL_SCHEMAS[name].safeParse({}).success === true
                );
              const isRequestBodyOptional = allowsMissingJsonBody && schemaAcceptsEmptyObject;

              const mediaType = acceptsFormData ? 'multipart/form-data' : 'application/json';
              operation.requestBody = {
                required: !isRequestBodyOptional,
                content: {
                  [mediaType]: {
                    schema: jsonSchema,
                  },
                },
              };
            } catch (e) {
              console.error(`ERROR: Failed to parse schema '${schemaNames.join(', ')}' for ${method} ${routePath}`, e);
            }
          }
        }

        operation.responses = extractOperationResponses({
          routePath: openapiPath,
          method,
          directNodes,
          allNodes: allScopedNodes,
          hasRequestBody: Boolean(operation.requestBody),
          hasQueryParams: queryParams.length > 0,
          hasPathParams: Boolean(pathParams && pathParams.length > 0),
          hasSecurity: Boolean(operation.security && operation.security.length > 0),
        });

        openapi.paths[openapiPath][method.toLowerCase()] = operation;
      }
    }
  }

  const declaredTagNames = new Set<string>(openapi.tags.map((t: { name: string }) => t.name));
  for (const pathMethods of Object.values(openapi.paths) as Array<Record<string, any>>) {
    for (const op of Object.values(pathMethods)) {
      for (const tag of op.tags ?? []) {
        if (!declaredTagNames.has(tag)) {
          declaredTagNames.add(tag);
          openapi.tags.push({
            name: tag,
            description:
              tag === 'General'
                ? 'General application API endpoints'
                : `${tag} API endpoints`,
          });
        }
      }
    }
  }

  if (missingSchemaCount > 0) {
    console.error(`Failed CI check: ${missingSchemaCount} data-accepting routes lack validation schemas.`);
    process.exit(1);
  }

  const outputPath = process.env.OPENAPI_OUTPUT_PATH
    ? path.resolve(process.env.OPENAPI_OUTPUT_PATH)
    : path.join(rootPath, 'public', 'openapi.json');
  const serialized = JSON.stringify(openapi, null, 2);
  if (process.argv.includes('--check')) {
    const existing = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : null;
    if (existing !== serialized) {
      console.error('Drift detected in public/openapi.json');
      process.exit(1);
    }
    console.log(`Verified OpenAPI schema is in sync at ${outputPath}`);
    return;
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tempOutputPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.${process.pid}-${Date.now()}.tmp`
  );
  fs.writeFileSync(tempOutputPath, serialized);
  fs.renameSync(tempOutputPath, outputPath);
  console.log(`Successfully generated OpenAPI schema at ${outputPath}`);
}

run().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
