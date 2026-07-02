import { Project, SyntaxKind, TypeFormatFlags } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as validationUtils from '../src/utils/validation';

const project = new Project({ tsConfigFilePath: path.resolve(process.cwd(), 'tsconfig.json') });
const routeFiles = project.getSourceFiles('src/app/api/**/route.ts');

const SCHEMA_MAP: Record<string, any> = {
  ...validationUtils
};
// Add dynamic schema mapping for specific validation wrapper functions
const VALIDATION_WRAPPER_MAP: Record<string, string> = {
  'validateAddItemInput': 'RegistryItemSchema',
  'validateContributeInput': 'ContributionSchema'
};

function extractSchemaName(node: any): string | null {
  const calls = node.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const c of calls) {
    const text = c.getExpression().getText();
    if (text.includes('.safeParse') || text.includes('.parse')) {
      return text.split('.')[0];
    } else if (text.startsWith('validate')) {
      if (VALIDATION_WRAPPER_MAP[text]) {
        return VALIDATION_WRAPPER_MAP[text];
      }
    }
  }
  return null;
}

function findSchemaInFile(file: any): string | null {
  const calls = file.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const c of calls) {
    const text = c.getExpression().getText();
    if (text.includes('.safeParse') || text.includes('.parse')) {
      return text.split('.')[0];
    }
  }
  return null;
}

function parseZodSchemaAst(schemaName: string, project: Project): string {
  if (schemaName === 'DynamicSchema') return 'Any valid JSON object.';
  if (schemaName === 'coordinateSchema') return 'A numeric coordinate or placeholder string.';

  const files = ['src/utils/validation.ts', 'src/features/registry/schemas.ts'];
  let varDecl = null;
  for (const f of files) {
    const file = project.getSourceFile(path.resolve(process.cwd(), f));
    if (file) {
      varDecl = file.getVariableDeclaration(schemaName);
      if (varDecl) break;
    }
  }

  if (!varDecl) return 'Schema details unavailable.';

  const init = varDecl.getInitializer();
  if (!init) return 'Schema details unavailable.';

  // find the object literal in z.object({ ... })
  const objectLiterals = init.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression);
  if (objectLiterals.length === 0) return 'Schema details unavailable.';

  const props = objectLiterals[0].getProperties();
  
  let markdown = '| Field | Type | Required | Description |\n';
  markdown += '|---|---|---|---|\n';

  for (const prop of props) {
    if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
    
    const propAssign = prop as any;
    const name = propAssign.getName();
    const exprText = propAssign.getInitializer().getText();
    
    let type = 'any';
    if (exprText.includes('z.string')) type = 'string';
    if (exprText.includes('z.number')) type = 'number';
    if (exprText.includes('z.boolean')) type = 'boolean';
    if (exprText.includes('z.union') || exprText.includes('.or(')) type = 'string | number | boolean'; // Simplified
    
    const isRequired = (!exprText.includes('.optional(') && !exprText.includes('.nullable(') && !exprText.includes('default(')) ? 'Yes' : 'No';
    
    // Extract strings like message: '...'
    let description = '';
    const strings = exprText.match(/(?:message:\s*['"]([^'"]+)['"]|\.max\(\d+,\s*['"]([^'"]+)['"]\))/);
    if (strings) {
      description = strings[1] || strings[2] || '';
    } else {
      const allStrings = exprText.match(/['"]([\w\s.!-]{5,})['"]/); // More constrained to words and punctuation
      if (allStrings) description = allStrings[1];
    }
    
    markdown += `| \`${name}\` | \`${type}\` | ${isRequired} | ${description} |\n`;
  }
  
  return markdown;
}

async function run() {
  let docs = '';
  let missingSchemaCount = 0;
  
  const sortedFiles = routeFiles.sort((a, b) => a.getFilePath().localeCompare(b.getFilePath()));

  for (const file of sortedFiles) {
    const routePath = file.getFilePath().replace(process.cwd(), '').replace('/src/app', '').replace('/route.ts', '');
    
    // Use ts-morph's getExportedDeclarations which automatically resolves re-exports
    const exportedDecls = file.getExportedDeclarations();
    for (const [method, decls] of exportedDecls.entries()) {
      if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        const decl = decls[0];
        let handlerNode: any = decl;
        let handlerFile = decl.getSourceFile();

        const jsDocNodes = handlerNode.getJsDocs ? handlerNode.getJsDocs() : [];
        const description = jsDocNodes.map((doc: any) => doc.getCommentText()).join('\n\n');

        let schemaName = extractSchemaName(handlerNode);
        if (!schemaName) {
          schemaName = findSchemaInFile(handlerFile);
        }

        docs += `### \`${method} ${routePath}\`\n\n`;
        if (description) {
          docs += `${description}\n\n`;
        }

        if (['POST', 'PUT', 'PATCH'].includes(method)) {
          if (!schemaName) {
            console.error(`ERROR: Route ${method} ${routePath} accepts data but lacks a Zod validation schema!`);
            missingSchemaCount++;
            continue;
          }
          
          try {
            const markdownBody = parseZodSchemaAst(schemaName, project);
            docs += `**Request Body:**\n\n`;
            docs += markdownBody;
            docs += '\n\n';
          } catch (e) {
            console.error(`ERROR: Failed to parse schema '${schemaName}' for ${method} ${routePath}`, e);
          }
        } else {
           docs += `\n`;
        }
      }
    }
  }

  if (missingSchemaCount > 0) {
    console.error(`Failed CI check: ${missingSchemaCount} data-accepting routes lack validation schemas.`);
    process.exit(1);
  }

  const docFilePath = path.join(process.cwd(), 'API_DOCUMENTATION.md');
  const existingDocs = fs.readFileSync(docFilePath, 'utf-8');
  
  const startMarker = '<!-- API_DOCS_START -->';
  const endMarker = '<!-- API_DOCS_END -->';
  
  const startIndex = existingDocs.indexOf(startMarker);
  const endIndex = existingDocs.indexOf(endMarker);
  
  if (startIndex !== -1 && endIndex !== -1) {
    const before = existingDocs.substring(0, startIndex + startMarker.length);
    const after = existingDocs.substring(endIndex);
    const newDocs = `${before}\n\n${docs}\n${after}`;
    fs.writeFileSync(docFilePath, newDocs);
    console.log('Successfully updated API_DOCUMENTATION.md');
  } else {
    console.error('Could not find injection markers in API_DOCUMENTATION.md');
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
