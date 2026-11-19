import fs from 'fs';
import path from 'path';
import { ts } from 'ts-morph';
import { fileURLToPath } from 'url';

export function getKeysFromSource(fileContent: string): string[] {
  const sourceFile = ts.createSourceFile('env.ts', fileContent, ts.ScriptTarget.Latest, true);
  const keys: string[] = [];

  function getPropertyNameText(node: ts.PropertyName | ts.Expression): string | null {
    if (ts.isIdentifier(node)) {
      return node.text;
    }
    if (ts.isStringLiteral(node)) {
      return node.text;
    }
    if (ts.isNoSubstitutionTemplateLiteral(node)) {
      return node.text;
    }
    if (ts.isComputedPropertyName(node)) {
      return getPropertyNameText(node.expression);
    }
    return null;
  }

  function findZodObjectCall(node: ts.Node | undefined): ts.CallExpression | null {
    if (!node) return null;
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (ts.isPropertyAccessExpression(expr)) {
        if (expr.expression.getText() === 'z' && expr.name.text === 'object') {
          return node;
        }
      }
    }
    let result: ts.CallExpression | null = null;
    node.forEachChild(child => {
      const found = findZodObjectCall(child);
      if (found) {
        result = found;
      }
    });
    return result;
  }

  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText() === 'envSchema') {
      const callExpr = findZodObjectCall(node.initializer);
      if (callExpr && callExpr.arguments.length > 0) {
        const firstArg = callExpr.arguments[0];
        if (ts.isObjectLiteralExpression(firstArg)) {
          for (const property of firstArg.properties) {
            if (ts.isPropertyAssignment(property)) {
              const nameText = getPropertyNameText(property.name);
              if (nameText) {
                keys.push(nameText);
              }
            } else if (ts.isShorthandPropertyAssignment(property)) {
              keys.push(property.name.text);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // If we didn't find keys through variable declaration 'envSchema', search for *any* z.object CallExpression in the file.
  if (keys.length === 0) {
    function visitAnyZodObject(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        const expr = node.expression;
        if (ts.isPropertyAccessExpression(expr) && expr.expression.getText() === 'z' && expr.name.text === 'object') {
          if (node.arguments.length > 0) {
            const firstArg = node.arguments[0];
            if (ts.isObjectLiteralExpression(firstArg)) {
              for (const property of firstArg.properties) {
                if (ts.isPropertyAssignment(property)) {
                  const nameText = getPropertyNameText(property.name);
                  if (nameText) {
                    keys.push(nameText);
                  }
                } else if (ts.isShorthandPropertyAssignment(property)) {
                  keys.push(property.name.text);
                }
              }
            }
          }
        }
      }
      ts.forEachChild(node, visitAnyZodObject);
    }
    visitAnyZodObject(sourceFile);
  }

  return keys;
}

interface MarkdownSection {
  heading: string;
  nonCodeLines: string[];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitMarkdownSections(docContent: string): MarkdownSection[] {
  const lines = docContent.split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;
  let inFence = false;
  let fenceMarker = '';

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const markerChar = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = markerChar;
      } else if (markerChar === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
      continue;
    }

    if (!inFence && /^##\s+/.test(line)) {
      current = { heading: line.trim(), nonCodeLines: [] };
      sections.push(current);
      continue;
    }

    if (!inFence && current) {
      current.nonCodeLines.push(line);
    }
  }

  return sections;
}

function countStructuredKeyEntries(lines: string[], key: string): number {
  const escaped = escapeRegex(key);
  const entryRegex = new RegExp(`^\\s*(?:[-*]\\s+\`${escaped}\`|\\|\\s*\`${escaped}\`\\s*\\|)`);
  let count = 0;
  for (const line of lines) {
    if (entryRegex.test(line)) {
      count++;
    }
  }
  return count;
}

export function validateEnvDocContent(docName: string, docContent: string, keys: string[]): string[] {
  const errors: string[] = [];

  if (docName.endsWith('.env.example')) {
    const lines = docContent.split(/\r?\n/);
    for (const key of keys) {
      const escaped = escapeRegex(key);
      const assignRegex = new RegExp(`^\\s*(?:#\\s*)?${escaped}=`);
      const matches = lines.filter((line) => assignRegex.test(line)).length;
      if (matches === 0) {
        errors.push(`Missing variable ${key} in ${docName}`);
      } else if (matches > 1) {
        errors.push(`Duplicate variable ${key} in ${docName}`);
      }
    }
    return errors;
  }

  const sections = splitMarkdownSections(docContent);
  const threshold = Math.min(4, keys.length);
  const envSections = sections.filter((section) => {
    if (/\benvironment\s+variable/i.test(section.heading)) {
      return true;
    }
    if (keys.length === 0) {
      return false;
    }
    const matchedKeyCount = keys.filter((key) => countStructuredKeyEntries(section.nonCodeLines, key) > 0).length;
    return matchedKeyCount >= threshold;
  });

  if (envSections.length === 0) {
    errors.push(`Missing environment variable reference section in ${docName}`);
    return errors;
  }

  if (envSections.length > 1) {
    const headings = envSections.map((section) => section.heading).join(', ');
    errors.push(`Duplicate environment variable reference sections in ${docName}: ${headings}`);
  }

  for (const section of envSections) {
    for (const key of keys) {
      const count = countStructuredKeyEntries(section.nonCodeLines, key);
      if (count === 0) {
        errors.push(`Missing variable ${key} in section "${section.heading}" of ${docName}`);
      } else if (count > 1) {
        errors.push(`Duplicate variable ${key} in section "${section.heading}" of ${docName}`);
      }
    }
  }

  return errors;
}

export function verifyEnvDocs(cwd: string = process.cwd()): void {
  const envFilePath = path.join(cwd, 'src/env.ts');

  if (!fs.existsSync(envFilePath)) {
    console.error(`❌ src/env.ts not found at ${envFilePath}`);
    process.exit(1);
  }

  const envFile = fs.readFileSync(envFilePath, 'utf-8');
  const keys = getKeysFromSource(envFile);

  if (keys.length === 0) {
    console.error('❌ No environment variables found in src/env.ts schema');
    process.exit(1);
  }

  const docsToVerify = [
    { name: 'DEPLOYMENT.md', path: path.join(cwd, 'DEPLOYMENT.md') },
    { name: '.env.example', path: path.join(cwd, '.env.example') },
    { name: 'docs/runtime-contract.md', path: path.join(cwd, 'docs/runtime-contract.md') },
    { name: 'docs/deployment/docker-vps.md', path: path.join(cwd, 'docs/deployment/docker-vps.md') },
    { name: 'docs/deployment/gcp-cloud-run.md', path: path.join(cwd, 'docs/deployment/gcp-cloud-run.md') },
    { name: 'docs/deployment/vercel.md', path: path.join(cwd, 'docs/deployment/vercel.md') },
    { name: 'docs/deployment/railway-render.md', path: path.join(cwd, 'docs/deployment/railway-render.md') },
  ];

  let failed = false;

  for (const doc of docsToVerify) {
    if (!fs.existsSync(doc.path)) {
      console.error(`❌ Deployment guide ${doc.name} not found at ${doc.path}`);
      failed = true;
      continue;
    }
    const docContent = fs.readFileSync(doc.path, 'utf-8');
    const docErrors = validateEnvDocContent(doc.name, docContent, keys);
    for (const err of docErrors) {
      console.error(`❌ ${err}`);
      failed = true;
    }
  }

  if (failed) {
    console.error('\nDocumentation is out of sync with the environment schema in src/env.ts.');
    console.error('Please ensure each deployment guide has a single complete environment variables section.');
    process.exit(1);
  } else {
    console.log('✅ Environment variable documentation is up to date.');
  }
}

const isMain = typeof process.argv[1] === 'string' &&
               path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  verifyEnvDocs();
}

