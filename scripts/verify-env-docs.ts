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

export function verifyEnvDocs() {
  const envFilePath = path.join(process.cwd(), 'src/env.ts');
  const deploymentDocPath = path.join(process.cwd(), 'DEPLOYMENT.md');
  const envExamplePath = path.join(process.cwd(), '.env.example');

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

  const deploymentDoc = fs.existsSync(deploymentDocPath) ? fs.readFileSync(deploymentDocPath, 'utf-8') : '';
  const envExample = fs.existsSync(envExamplePath) ? fs.readFileSync(envExamplePath, 'utf-8') : '';

  let failed = false;

  for (const key of keys) {
    const keyRegex = new RegExp(`\\b${key}\\b`);
    if (!keyRegex.test(deploymentDoc)) {
      console.error(`❌ Missing variable ${key} in DEPLOYMENT.md`);
      failed = true;
    }
    if (!keyRegex.test(envExample)) {
      console.error(`❌ Missing variable ${key} in .env.example`);
      failed = true;
    }
  }

  if (failed) {
    console.error('\nDocumentation is out of sync with the environment schema in src/env.ts.');
    console.error('Please update DEPLOYMENT.md and/or .env.example to include the missing variables.');
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

