process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dummy:dummy@localhost:5432/dummy';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'scrypt:c2FsdA==:aGFzaA==';

import { Project, SyntaxKind, Node, type CallExpression } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, '..');

const validationUtils = await import('../src/utils/validation.js');
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

const project = new Project({ tsConfigFilePath: path.join(rootPath, 'tsconfig.json') });
const routeFiles = project
  .getSourceFiles(['src/app/api/**/route.ts', 'src/app/api/**/route.tsx'])
  .filter((file) => !file.getFilePath().includes('__tests__'));

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

function collectDelegatedHelperRoots(
  sourceNodes: Node[],
  method: string,
  visitedDecls = new Set<Node>()
): Node[][] {
  const groups: Node[][] = [];

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
        const scoped = collectMethodScopedNodes(decl, method);
        groups.push(scoped);
        groups.push(...collectDelegatedHelperRoots(scoped, method, visitedDecls));
      }
    }
  }

  return groups;
}

function extractSchemaFromScopedNodes(scopedNodes: Node[]): string | null {
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
                return innerCalls[0].getExpression().getText().replace(/.*\./, '');
              }
              const innerIds = init.getDescendantsOfKind(SyntaxKind.Identifier);
              const returnedSchema = innerIds.find((id) => id.getText().includes('Schema'));
              if (returnedSchema) return returnedSchema.getText().replace(/.*\./, '');
            }
            return init.getText().replace(/.*\./, '');
          }
        }
      }
    }
  }

  const candidateSchemas: string[] = [];
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
        candidateSchemas.push(schemaName);
      }
    }
  }

  if (candidateSchemas.length > 0) {
    return candidateSchemas[candidateSchemas.length - 1];
  }

  return null;
}

function extractSchemaName(directNodes: Node[], delegatedGroups: Node[][]): string | null {
  const directMatch = extractSchemaFromScopedNodes(directNodes);
  if (directMatch) return directMatch;

  for (const group of delegatedGroups) {
    const match = extractSchemaFromScopedNodes(group);
    if (match) return match;
  }

  return null;
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

function toOpenApiSchema(schemaObj: any, isMultipart: boolean): any {
  const raw = typeof z.toJSONSchema === 'function'
    ? z.toJSONSchema(schemaObj, {
      target: 'openapi-3.0',
      io: 'input',
      unrepresentable: 'any',
    })
    : schemaObj;

  const cloned = JSON.parse(JSON.stringify(raw));
  delete cloned.$schema;

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

  const openapi: any = {
    openapi: '3.0.3',
    info: {
      title: 'Universal API',
      version: '1.0.0',
    },
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
        const allScopedNodes = [...directNodes, ...delegatedGroups.flat()];

        const schemaName = extractSchemaName(directNodes, delegatedGroups);

        const operation: any = {
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
            ...pathParams.map((param: string) => ({
              name: param.replace(/[{}]/g, ''),
              in: 'path',
              required: true,
              schema: { type: 'string' },
            }))
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
            if (!schemaName) {
              console.error(`ERROR: Route ${method} ${routePath} accepts data but lacks a Zod validation schema!`);
              missingSchemaCount++;
              continue;
            }

            const schemaObj = ALL_SCHEMAS[schemaName];
            if (!schemaObj) {
              console.error(`ERROR: Could not find schema definition for '${schemaName}' in ALL_SCHEMAS`);
              missingSchemaCount++;
              continue;
            }

            try {
              const jsonSchema = toOpenApiSchema(schemaObj, acceptsFormData);
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
              console.error(`ERROR: Failed to parse schema '${schemaName}' for ${method} ${routePath}`, e);
            }
          }
        }

        operation.responses = {
          '200': {
            description: 'Successful response',
          },
        };

        openapi.paths[openapiPath][method.toLowerCase()] = operation;
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
