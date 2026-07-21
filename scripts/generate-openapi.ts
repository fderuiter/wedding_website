import { Project, SyntaxKind } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import * as validationUtils from '../src/utils/validation.js';
import * as registrySchemas from '../src/features/registry/schemas.js';
import * as attractionSchemas from '../src/features/attractions/schemas.js';
import * as weddingPartySchemas from '../src/features/wedding-party/schemas.js';
import * as contentSchemas from '../src/features/content/schemas.js';
import * as mediaSchemas from '../src/features/media/schemas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, '..');

const ALL_SCHEMAS: Record<string, any> = {
  ...validationUtils,
  ...registrySchemas,
  ...attractionSchemas,
  ...weddingPartySchemas,
  ...contentSchemas,
  ...mediaSchemas
};

const project = new Project({ tsConfigFilePath: path.join(rootPath, 'tsconfig.json') });
const routeFiles = project.getSourceFiles('src/app/api/**/route.ts');

function extractSchemaName(node: any): string | null {
  const calls = node.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const c of calls) {
    const text = c.getExpression().getText();
    if (text === 'createValidatedRoute') {
      const args = c.getArguments();
      if (args.length > 0 && args[0].getKind() === SyntaxKind.ObjectLiteralExpression) {
        const obj = args[0];
        const schemaProp = obj.getProperty('schema');
        if (schemaProp && schemaProp.getKind() === SyntaxKind.PropertyAssignment) {
          const init = schemaProp.getInitializer();
          if (init) {
            if (init.getKind() === SyntaxKind.ArrowFunction || init.getKind() === SyntaxKind.FunctionExpression) {
              const innerCalls = init.getDescendantsOfKind(SyntaxKind.CallExpression);
              if (innerCalls.length > 0) {
                return innerCalls[0].getExpression().getText().replace(/.*\./, '');
              }
              const innerIds = init.getDescendantsOfKind(SyntaxKind.Identifier);
              const returnedSchema = innerIds.find((id: any) => id.getText().includes('Schema'));
              if (returnedSchema) return returnedSchema.getText().replace(/.*\./, '');
            }
            return init.getText().replace(/.*\./, '');
          }
        }
      }
    }
    if (text.includes('.safeParse') || text.includes('.parse')) {
      return text.split('.')[0];
    }
  }
  return null;
}

function findSchemaInFile(file: any): string | null {
  const calls = file.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const c of calls) {
    const text = c.getExpression().getText();
    if (text === 'createValidatedRoute') {
      const args = c.getArguments();
      if (args.length > 0 && args[0].getKind() === SyntaxKind.ObjectLiteralExpression) {
        const obj = args[0];
        const schemaProp = obj.getProperty('schema');
        if (schemaProp && schemaProp.getKind() === SyntaxKind.PropertyAssignment) {
          const init = schemaProp.getInitializer();
          if (init) {
            if (init.getKind() === SyntaxKind.ArrowFunction || init.getKind() === SyntaxKind.FunctionExpression) {
              const innerCalls = init.getDescendantsOfKind(SyntaxKind.CallExpression);
              if (innerCalls.length > 0) {
                return innerCalls[0].getExpression().getText().replace(/.*\./, '');
              }
              const innerIds = init.getDescendantsOfKind(SyntaxKind.Identifier);
              const returnedSchema = innerIds.find((id: any) => id.getText().includes('Schema'));
              if (returnedSchema) return returnedSchema.getText().replace(/.*\./, '');
            }
            return init.getText().replace(/.*\./, '');
          }
        }
      }
    }
    if (text.includes('.safeParse') || text.includes('.parse')) {
      return text.split('.')[0];
    }
  }
  return null;
}

async function run() {
  const openapi: any = {
    openapi: '3.0.3',
    info: {
      title: 'Universal API',
      version: '1.0.0'
    },
    paths: {}
  };

  let missingSchemaCount = 0;
  
  const sortedFiles = routeFiles.sort((a, b) => a.getFilePath().localeCompare(b.getFilePath()));

  for (const file of sortedFiles) {
    const routePath = file.getFilePath().replace(rootPath, '').replace('/src/app', '').replace('/route.ts', '').replace(/\\/g, '/');
    const openapiPath = routePath.replace(/\[([^\]]+)\]/g, '{$1}'); // e.g., /[id] -> /{id}
    
    if (!openapi.paths[openapiPath]) {
      openapi.paths[openapiPath] = {};
    }

    const exportedDecls = file.getExportedDeclarations();
    for (const [method, decls] of exportedDecls.entries()) {
      if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        const decl = decls[0];
        const handlerNode: any = decl;
        const handlerFile = decl.getSourceFile();

        const jsDocNodes = handlerNode.getJsDocs ? handlerNode.getJsDocs() : [];
        const description = jsDocNodes.map((doc: any) => doc.getCommentText()).join('\n\n');

        let schemaName = extractSchemaName(handlerNode);
        if (!schemaName) {
          schemaName = findSchemaInFile(handlerFile);
        }

        const operation: any = {
          summary: `${method} ${routePath}`,
          description: description || `Endpoint for ${routePath}`
        };

        const pathParams = openapiPath.match(/\{([^\}]+)\}/g);
        if (pathParams) {
          operation.parameters = pathParams.map((param: string) => ({
            name: param.replace(/[\{\}]/g, ''),
            in: 'path',
            required: true,
            schema: { type: 'string' }
          }));
        }

        if (['POST', 'PUT', 'PATCH'].includes(method)) {
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
            const jsonSchema = typeof schemaObj.toJSONSchema === 'function' ? schemaObj.toJSONSchema({ unrepresentable: 'ignore' }) : schemaObj;
            operation.requestBody = {
              required: true,
              content: {
                'application/json': {
                  schema: jsonSchema
                }
              }
            };
          } catch (e) {
            console.error(`ERROR: Failed to parse schema '${schemaName}' for ${method} ${routePath}`, e);
          }
        }
        
        operation.responses = {
          '200': {
            description: 'Successful response'
          }
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

run().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
