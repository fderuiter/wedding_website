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

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const EXPORT_MEDIA_SCHEMAS: Record<string, Record<string, string>> = {
  'text/csv': { type: 'string' },
  'text/calendar': { type: 'string' },
  'application/pdf': { type: 'string', format: 'binary' },
  'application/zip': { type: 'string', format: 'binary' },
  'image/png': { type: 'string', format: 'binary' },
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
const routeFiles = project
  .getSourceFiles(['src/app/api/**/route.ts', 'src/app/api/**/route.tsx'])
  .filter((file) => !file.getFilePath().includes('__tests__'));

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

interface MiddlewareApiExclusions {
  exact: Set<string>;
  prefixes: string[];
}

function getMiddlewarePublicApiExclusions(): MiddlewareApiExclusions {
  const middlewarePath = path.join(rootPath, 'src/middleware.ts');
  const source = fs.readFileSync(middlewarePath, 'utf8');
  const exact = new Set<string>();
  const prefixes: string[] = [];

  const exactRegex = /normalizedPath\s*===\s*'(\/api\/[^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = exactRegex.exec(source)) !== null) {
    if (match[1] !== '/api/cron') {
      exact.add(match[1]);
    }
  }

  const prefixRegex = /normalizedPath\.startsWith\(\s*'(\/api\/[^']+)'\s*\)/g;
  while ((match = prefixRegex.exec(source)) !== null) {
    if (match[1] !== '/api/' && match[1] !== '/api/cron/') {
      prefixes.push(match[1]);
    }
  }

  return { exact, prefixes };
}

function isMiddlewarePublicApiRoute(
  routePath: string,
  exclusions: MiddlewareApiExclusions
): boolean {
  if (exclusions.exact.has(routePath)) {
    return true;
  }
  return exclusions.prefixes.some((prefix) => routePath.startsWith(prefix));
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

function extractSchemasFromScopedNodes(scopedNodes: Node[]): string[] {
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

  return Array.from(new Set(results));
}

function extractSchemaNames(
  directNodes: Node[],
  delegatedGroups: DelegatedHelperGroup[]
): string[] {
  const directMatches = extractSchemasFromScopedNodes(directNodes);
  const conditionalDelegatedMatches: string[] = [];
  const unconditionalDelegatedMatches: string[] = [];

  for (const group of delegatedGroups) {
    const matches = extractSchemasFromScopedNodes(group.nodes);
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

function detectBodyCapabilities(allNodes: Node[]): {
  acceptsBody: boolean;
  acceptsFormData: boolean;
} {
  let acceptsBody = false;
  let acceptsFormData = false;

  for (const n of allNodes) {
    if (!Node.isCallExpression(n)) continue;
    const exprText = n.getExpression().getText();

    if (exprText === 'createValidatedRoute') {
      acceptsBody = true;
    } else if (
      /^(?:request|req)(?:\.clone\(\))?\.json$/.test(exprText) ||
      /^\(request as any\)\.json$/.test(exprText) ||
      /^(?:request|req)\.text$/.test(exprText)
    ) {
      acceptsBody = true;
    } else if (/^(?:request|req)\.formData$/.test(exprText)) {
      acceptsBody = true;
      acceptsFormData = true;
    }
  }

  return { acceptsBody, acceptsFormData };
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
  delete cloned.$schema;

  if (Array.isArray(cloned?.oneOf) && cloned.oneOf.length > 0 && cloned.oneOf.every(isObjectJsonSchema)) {
    cloned.type = 'object';
  }

  if (isMultipart && cloned && typeof cloned === 'object' && cloned.properties) {
    for (const [key, propVal] of Object.entries<any>(cloned.properties)) {
      if (propVal && typeof propVal === 'object') {
        if (Object.keys(propVal).length === 0) {
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

function extractStatusFromInitObject(initArg: Node | undefined): number {
  if (!initArg || !Node.isObjectLiteralExpression(initArg)) return 200;
  const statusProp = initArg.getProperty('status');
  if (statusProp && Node.isPropertyAssignment(statusProp)) {
    const statusInit = statusProp.getInitializer();
    if (statusInit && Node.isNumericLiteral(statusInit)) {
      return Number(statusInit.getLiteralValue());
    }
  }
  return 200;
}

function extractContentTypeFromInitObject(initArg: Node | undefined): string | null {
  if (!initArg || !Node.isObjectLiteralExpression(initArg)) return null;
  const headersProp = initArg.getProperty('headers');
  if (!headersProp || !Node.isPropertyAssignment(headersProp)) return null;
  const headersInit = headersProp.getInitializer();
  if (!headersInit || !Node.isObjectLiteralExpression(headersInit)) return null;

  for (const prop of headersInit.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;
    const rawName = prop.getName().replace(/^['"]|['"]$/g, '').toLowerCase();
    if (rawName !== 'content-type') continue;
    const valInit = prop.getInitializer();
    if (valInit && (Node.isStringLiteral(valInit) || Node.isNoSubstitutionTemplateLiteral(valInit))) {
      return valInit.getLiteralValue().split(';')[0].trim().toLowerCase();
    }
  }

  return null;
}

function extractOperationResponses(allNodes: Node[]): Record<string, any> {
  const mediaTypesByStatus = new Map<number, string[]>();

  function recordStatus(status: number, mediaType?: string | null) {
    if (status < 200 || status >= 300) return;
    if (!mediaTypesByStatus.has(status)) {
      mediaTypesByStatus.set(status, []);
    }
    if (mediaType && EXPORT_MEDIA_SCHEMAS[mediaType]) {
      const existing = mediaTypesByStatus.get(status)!;
      if (!existing.includes(mediaType)) {
        existing.push(mediaType);
      }
    }
  }

  for (const n of allNodes) {
    if (Node.isCallExpression(n)) {
      const exprText = n.getExpression().getText();
      if (exprText === 'NextResponse.json' || exprText === 'Response.json') {
        const status = extractStatusFromInitObject(n.getArguments()[1]);
        recordStatus(status);
      }
    } else if (Node.isNewExpression(n)) {
      const exprText = n.getExpression().getText();
      if (exprText === 'ImageResponse') {
        const status = extractStatusFromInitObject(n.getArguments()[1]);
        recordStatus(status, 'image/png');
      } else if (exprText === 'NextResponse' || exprText === 'Response') {
        const initArg = n.getArguments()[1];
        const status = extractStatusFromInitObject(initArg);
        const mediaType = extractContentTypeFromInitObject(initArg);
        recordStatus(status, mediaType);
      }
    }
  }

  if (mediaTypesByStatus.size === 0) {
    recordStatus(200);
  }

  const responses: Record<string, any> = {};
  const sortedStatuses = Array.from(mediaTypesByStatus.keys()).sort((a, b) => a - b);

  for (const status of sortedStatuses) {
    const mediaTypes = mediaTypesByStatus.get(status) ?? [];
    const responseObj: Record<string, any> = {
      description: status === 201 ? 'Created' : 'Successful response',
    };

    if (mediaTypes.length > 0) {
      responseObj.content = {};
      for (const mt of mediaTypes) {
        responseObj.content[mt] = {
          schema: { ...EXPORT_MEDIA_SCHEMAS[mt] },
        };
      }
    }

    responses[String(status)] = responseObj;
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

    const isRequired = Boolean(linkedVar && requiredVars.has(linkedVar));

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

  if (!isMiddlewarePublicApiRoute(routePath, publicApiExclusions)) {
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

  const openapi: any = {
    openapi: '3.0.3',
    info: {
      title: 'Universal API',
      version: '1.0.0',
    },
    tags: OPENAPI_TAGS.map(({ name, description }) => ({ name, description })),
    components: {
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
    const routePath = file
      .getFilePath()
      .replace(rootPath, '')
      .replace(/\\/g, '/')
      .replace(/^\/src\/app/, '')
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

        const schemaNames = extractSchemaNames(directNodes, delegatedGroups);

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
          const { acceptsBody, acceptsFormData } = detectBodyCapabilities(allScopedNodes);

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
                  ? { type: 'object', oneOf: branchSchemas }
                  : { oneOf: branchSchemas };
              }

              const mediaType = acceptsFormData ? 'multipart/form-data' : 'application/json';
              operation.requestBody = {
                required: true,
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

        operation.responses = extractOperationResponses(allScopedNodes);

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

  const outputPath = path.join(rootPath, 'public', 'openapi.json');
  fs.writeFileSync(outputPath, JSON.stringify(openapi, null, 2));
  console.log(`Successfully generated OpenAPI schema at ${outputPath}`);
}

run().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
