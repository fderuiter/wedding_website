import fs from 'fs';
import path from 'path';
import ts from 'typescript';
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

function verifyEnvDocs() {
  const envFilePath = path.join(process.cwd(), 'src/env.ts');

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
    { name: 'DEPLOYMENT.md', path: path.join(process.cwd(), 'DEPLOYMENT.md') },
    { name: '.env.example', path: path.join(process.cwd(), '.env.example') },
    { name: 'docs/runtime-contract.md', path: path.join(process.cwd(), 'docs/runtime-contract.md') },
    { name: 'docs/deployment/docker-vps.md', path: path.join(process.cwd(), 'docs/deployment/docker-vps.md') },
    { name: 'docs/deployment/gcp-cloud-run.md', path: path.join(process.cwd(), 'docs/deployment/gcp-cloud-run.md') },
    { name: 'docs/deployment/vercel.md', path: path.join(process.cwd(), 'docs/deployment/vercel.md') },
    { name: 'docs/deployment/railway-render.md', path: path.join(process.cwd(), 'docs/deployment/railway-render.md') },
  ];

  let failed = false;

  for (const doc of docsToVerify) {
    if (!fs.existsSync(doc.path)) {
      console.error(`❌ Deployment guide ${doc.name} not found at ${doc.path}`);
      failed = true;
      continue;
    }
    const docContent = fs.readFileSync(doc.path, 'utf-8');
    for (const key of keys) {
      const keyRegex = new RegExp(`\\b${key}\\b`);
      if (!keyRegex.test(docContent)) {
        console.error(`❌ Missing variable ${key} in ${doc.name}`);
        failed = true;
      }
    }
  }

  if (failed) {
    console.error('\nDocumentation is out of sync with the environment schema in src/env.ts.');
    console.error('Please update deployment guides to include the missing variables.');
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

