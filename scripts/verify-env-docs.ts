import fs from 'fs';
import path from 'path';
import { ts } from 'ts-morph';
import { fileURLToPath } from 'url';

export const INTERNAL_ENV_ALLOWLIST: ReadonlySet<string> = new Set([
  'NEXT_RUNTIME',
  'npm_lifecycle_event',
  'JEST_WORKER_ID',
]);

export type EnvClassification = 'required' | 'production-required' | 'conditional' | 'optional';

export interface EnvFieldSpec {
  key: string;
  classification: EnvClassification;
  defaultValue: string | null;
}

export interface RuntimeContractRow {
  key: string;
  subheading: string;
  classification: EnvClassification;
  hasDefaultColumn: boolean;
  defaultValue: string | null;
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function getPropertyNameText(node: ts.PropertyName | ts.Expression): string | null {
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isComputedPropertyName(node)) {
    return getPropertyNameText(node.expression);
  }
  return null;
}

function isProcessEnvExpression(node: ts.Expression, sourceFile: ts.SourceFile): boolean {
  const expr = unwrapExpression(node);
  if (ts.isPropertyAccessExpression(expr)) {
    const target = unwrapExpression(expr.expression);
    return ts.isIdentifier(target) && target.text === 'process' && expr.name.text === 'env';
  }
  if (ts.isElementAccessExpression(expr)) {
    const target = unwrapExpression(expr.expression);
    return (
      ts.isIdentifier(target) &&
      target.text === 'process' &&
      ts.isStringLiteralLike(expr.argumentExpression) &&
      expr.argumentExpression.text === 'env'
    );
  }
  return expr.getText(sourceFile) === 'process.env';
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
  node.forEachChild((child) => {
    const found = findZodObjectCall(child);
    if (found) {
      result = found;
    }
  });
  return result;
}

function findEnvSchemaObjectLiteral(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | null {
  let foundObject: ts.ObjectLiteralExpression | null = null;

  function visitNamed(node: ts.Node) {
    if (foundObject) return;
    if (ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === 'envSchema') {
      const callExpr = findZodObjectCall(node.initializer);
      if (callExpr && callExpr.arguments.length > 0 && ts.isObjectLiteralExpression(callExpr.arguments[0])) {
        foundObject = callExpr.arguments[0];
        return;
      }
    }
    ts.forEachChild(node, visitNamed);
  }

  visitNamed(sourceFile);
  if (foundObject) {
    return foundObject;
  }

  function visitAny(node: ts.Node) {
    if (foundObject) return;
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (
        ts.isPropertyAccessExpression(expr) &&
        expr.expression.getText(sourceFile) === 'z' &&
        expr.name.text === 'object' &&
        node.arguments.length > 0 &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        foundObject = node.arguments[0];
        return;
      }
    }
    ts.forEachChild(node, visitAny);
  }

  visitAny(sourceFile);
  return foundObject;
}

export function getKeysFromSource(fileContent: string): string[] {
  const sourceFile = ts.createSourceFile('env.ts', fileContent, ts.ScriptTarget.Latest, true);
  const objectLiteral = findEnvSchemaObjectLiteral(sourceFile);
  if (!objectLiteral) {
    return [];
  }

  const keys: string[] = [];
  for (const property of objectLiteral.properties) {
    if (ts.isPropertyAssignment(property)) {
      const nameText = getPropertyNameText(property.name);
      if (nameText) {
        keys.push(nameText);
      }
    } else if (ts.isShorthandPropertyAssignment(property)) {
      keys.push(property.name.text);
    }
  }

  return keys;
}

export function scanProcessEnvFromSource(fileContent: string, fileName: string = 'source.ts'): string[] {
  const scriptKind = fileName.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : fileName.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(fileName, fileContent, ts.ScriptTarget.Latest, true, scriptKind);
  const keys = new Set<string>();

  function visit(node: ts.Node) {
    // 1. process.env.KEY
    if (ts.isPropertyAccessExpression(node) && isProcessEnvExpression(node.expression, sourceFile)) {
      keys.add(node.name.text);
    }

    // 2. process.env['KEY'] / process.env[`KEY`]
    if (
      ts.isElementAccessExpression(node) &&
      isProcessEnvExpression(node.expression, sourceFile) &&
      ts.isStringLiteralLike(node.argumentExpression)
    ) {
      keys.add(node.argumentExpression.text);
    }

    // 3. const { KEY1, KEY2: alias } = process.env
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      isProcessEnvExpression(node.initializer, sourceFile) &&
      ts.isObjectBindingPattern(node.name)
    ) {
      for (const element of node.name.elements) {
        if (element.propertyName) {
          const propText = getPropertyNameText(element.propertyName);
          if (propText) {
            keys.add(propText);
          }
        } else if (ts.isIdentifier(element.name)) {
          keys.add(element.name.text);
        }
      }
    }

    // 4. Child-process env object spreading process.env: { ...process.env, STATIC_EXPORT: 'true' }
    if (ts.isObjectLiteralExpression(node)) {
      const spreadsProcessEnv = node.properties.some(
        (prop) => ts.isSpreadAssignment(prop) && isProcessEnvExpression(prop.expression, sourceFile)
      );
      if (spreadsProcessEnv) {
        for (const prop of node.properties) {
          if (ts.isPropertyAssignment(prop)) {
            const nameText = getPropertyNameText(prop.name);
            if (nameText) {
              keys.add(nameText);
            }
          } else if (ts.isShorthandPropertyAssignment(prop)) {
            keys.add(prop.name.text);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return Array.from(keys);
}

function extractInterpolatedVars(text: string): string[] {
  const sanitized = text.replace(/\$\$/g, '');
  const vars = new Set<string>();
  const bracedRegex = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?[-?+][^}]*)?\}/g;
  let match: RegExpExecArray | null;
  while ((match = bracedRegex.exec(sanitized)) !== null) {
    vars.add(match[1]);
  }
  return Array.from(vars);
}

export function parseDockerfileEnvKeys(dockerfileContent: string): string[] {
  const keys = new Set<string>();
  const logicalLines: string[] = [];
  let buffer = '';

  for (const rawLine of dockerfileContent.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!buffer && (!trimmed || trimmed.startsWith('#'))) {
      continue;
    }
    if (trimmed.startsWith('#')) {
      continue;
    }
    if (trimmed.endsWith('\\')) {
      buffer += `${trimmed.slice(0, -1).trimEnd()} `;
    } else {
      buffer += trimmed;
      if (buffer.length > 0) {
        logicalLines.push(buffer);
      }
      buffer = '';
    }
  }
  if (buffer.trim().length > 0) {
    logicalLines.push(buffer.trim());
  }

  for (const line of logicalLines) {
    const envMatch = line.match(/^ENV\s+(.+)$/i);
    if (!envMatch) {
      continue;
    }
    const rest = envMatch[1].trim();
    for (const interpKey of extractInterpolatedVars(rest)) {
      keys.add(interpKey);
    }

    // Legacy `ENV KEY VALUE` form (no `=` in first whitespace-delimited token)
    const firstSpaceIdx = rest.search(/\s/);
    const firstToken = firstSpaceIdx === -1 ? rest : rest.slice(0, firstSpaceIdx);
    if (!firstToken.includes('=')) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(firstToken)) {
        keys.add(firstToken);
      }
      continue;
    }

    // Modern `ENV KEY1=VAL1 KEY2="VAL 2"` form (scan outside quotes)
    let i = 0;
    while (i < rest.length) {
      while (i < rest.length && /\s/.test(rest[i])) {
        i++;
      }
      if (i >= rest.length) break;

      const keyMatch = rest.slice(i).match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
      if (!keyMatch) {
        while (i < rest.length && !/\s/.test(rest[i])) {
          i++;
        }
        continue;
      }

      keys.add(keyMatch[1]);
      i += keyMatch[0].length;

      let quote: '"' | '\'' | null = null;
      while (i < rest.length) {
        const ch = rest[i];
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (quote) {
          if (ch === quote) {
            quote = null;
          }
          i++;
        } else if (ch === '"' || ch === '\'') {
          quote = ch;
          i++;
        } else if (/\s/.test(ch)) {
          break;
        } else {
          i++;
        }
      }
    }
  }

  return Array.from(keys);
}

function stripYamlComment(line: string): string {
  let quote: '"' | '\'' | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && quote === '"') {
      i++;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      }
    } else if (ch === '"' || ch === '\'') {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

export function parseComposeEnvKeys(composeContent: string): string[] {
  const keys = new Set<string>();
  let inEnvironmentBlock = false;
  let envBlockIndent = -1;

  for (const rawLine of composeContent.split(/\r?\n/)) {
    if (/^\s*#/.test(rawLine) || !rawLine.trim()) {
      continue;
    }
    const cleanLine = stripYamlComment(rawLine);

    for (const interpKey of extractInterpolatedVars(cleanLine)) {
      keys.add(interpKey);
    }

    const indent = (cleanLine.match(/^(\s*)/)?.[1] ?? '').length;
    if (inEnvironmentBlock && indent <= envBlockIndent) {
      inEnvironmentBlock = false;
      envBlockIndent = -1;
    }

    if (/^\s*environment:\s*$/.test(cleanLine)) {
      inEnvironmentBlock = true;
      envBlockIndent = indent;
      continue;
    }

    if (inEnvironmentBlock) {
      // Bare host pass-through entry `- VAR_NAME` (without `=` or `:`)
      const bareItemMatch = cleanLine.match(/^\s*-\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/);
      if (bareItemMatch) {
        keys.add(bareItemMatch[1]);
      }

      // Explicit container network binding (`HOSTNAME: "0.0.0.0"` or `- HOSTNAME=0.0.0.0`)
      const containerNetMatch = cleanLine.match(/^\s*(?:-\s*)?(HOSTNAME|PORT)\s*(?::|=)\s*\S+/);
      if (containerNetMatch) {
        keys.add(containerNetMatch[1]);
      }
    }
  }

  return Array.from(keys);
}

function extractDockerfileEnvValue(dockerfileContent: string, targetKey: string): string | null {
  let foundValue: string | null = null;
  for (const rawLine of dockerfileContent.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const envMatch = trimmed.match(/^ENV\s+(.+)$/i);
    if (!envMatch) continue;
    const rest = envMatch[1].trim();
    const escapedKey = escapeRegex(targetKey);
    const kvMatch = rest.match(new RegExp(`(?:^|\\s)${escapedKey}=(?:["']([^"']*)["']|(\\S+))`));
    if (kvMatch) {
      foundValue = kvMatch[1] ?? kvMatch[2] ?? null;
      continue;
    }
    const legacyMatch = rest.match(new RegExp(`^${escapedKey}\\s+(?:["']([^"']*)["']|(\\S+))$`));
    if (legacyMatch) {
      foundValue = legacyMatch[1] ?? legacyMatch[2] ?? null;
    }
  }
  return foundValue;
}

function extractComposeServiceEnvValue(
  composeContent: string,
  serviceName: string,
  targetKey: string
): string | null {
  let inServices = false;
  let currentService: string | null = null;
  let inEnv = false;
  let envIndent = -1;
  const escapedKey = escapeRegex(targetKey);

  for (const rawLine of composeContent.split(/\r?\n/)) {
    if (/^\s*#/.test(rawLine) || !rawLine.trim()) continue;
    const cleanLine = stripYamlComment(rawLine);
    if (/^services:\s*$/.test(cleanLine)) {
      inServices = true;
      continue;
    }
    if (inServices && /^\S/.test(cleanLine)) {
      inServices = false;
      currentService = null;
      inEnv = false;
    }
    if (!inServices) continue;

    const svcMatch = cleanLine.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
    if (svcMatch) {
      currentService = svcMatch[1];
      inEnv = false;
      continue;
    }
    if (currentService !== serviceName) continue;

    const indent = (cleanLine.match(/^(\s*)/)?.[1] ?? '').length;
    if (inEnv && indent <= envIndent) {
      inEnv = false;
      envIndent = -1;
    }
    if (/^\s*environment:\s*$/.test(cleanLine)) {
      inEnv = true;
      envIndent = indent;
      continue;
    }
    if (inEnv) {
      const mapMatch = cleanLine.match(
        new RegExp(`^\\s*(?:-\\s*)?${escapedKey}\\s*(?::|=)\\s*(?:["']([^"']*)["']|(\\S+))\\s*$`)
      );
      if (mapMatch) {
        return mapMatch[1] ?? mapMatch[2] ?? null;
      }
    }
  }
  return null;
}

export function validateContainerHostnameBinding(
  dockerfileContent: string,
  composeContent?: string
): string[] {
  const errors: string[] = [];
  const dockerfileHostname = extractDockerfileEnvValue(dockerfileContent, 'HOSTNAME');
  if (dockerfileHostname !== '0.0.0.0') {
    errors.push(
      `Dockerfile must set ENV HOSTNAME="0.0.0.0" for standalone external/healthcheck reachability (got ${dockerfileHostname ? `"${dockerfileHostname}"` : 'unset'})`
    );
  }

  if (composeContent !== undefined && /^  app:\s*$/m.test(composeContent)) {
    const composeHostname = extractComposeServiceEnvValue(composeContent, 'app', 'HOSTNAME');
    if (composeHostname !== '0.0.0.0') {
      errors.push(
        `docker-compose.yml service "app" must set HOSTNAME to "0.0.0.0" (got ${composeHostname ? `"${composeHostname}"` : 'unset'})`
      );
    }
  }

  return errors;
}

function walkRuntimeSourceFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const results: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '__tests__' || entry.name === 'testing' || entry.name === 'mocks') {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkRuntimeSourceFiles(fullPath));
    } else if (
      entry.isFile() &&
      /\.(ts|tsx|mts|mjs|js|jsx)$/.test(entry.name) &&
      !/\.(test|spec|stories)\./.test(entry.name)
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

export function collectOperatorEnvKeys(cwd: string = process.cwd()): {
  keys: string[];
  sources: Map<string, string[]>;
} {
  const sourceMap = new Map<string, Set<string>>();

  function recordKey(key: string, relFile: string) {
    if (INTERNAL_ENV_ALLOWLIST.has(key)) {
      return;
    }
    let set = sourceMap.get(key);
    if (!set) {
      set = new Set<string>();
      sourceMap.set(key, set);
    }
    set.add(relFile);
  }

  const envFilePath = path.join(cwd, 'src/env.ts');
  if (fs.existsSync(envFilePath)) {
    const envContent = fs.readFileSync(envFilePath, 'utf-8');
    for (const key of getKeysFromSource(envContent)) {
      recordKey(key, 'src/env.ts');
    }
  }

  const astTargetFiles = [
    ...walkRuntimeSourceFiles(path.join(cwd, 'src')),
    path.join(cwd, 'next.config.ts'),
    path.join(cwd, 'scripts/build-export.mjs'),
    path.join(cwd, 'docs-portal/.vitepress/config.mts'),
  ];

  for (const absPath of astTargetFiles) {
    if (!fs.existsSync(absPath)) {
      continue;
    }
    const relPath = path.relative(cwd, absPath).replace(/\\/g, '/');
    const content = fs.readFileSync(absPath, 'utf-8');
    for (const key of scanProcessEnvFromSource(content, relPath)) {
      recordKey(key, relPath);
    }
  }

  const dockerfilePath = path.join(cwd, 'Dockerfile');
  if (fs.existsSync(dockerfilePath)) {
    const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf-8');
    for (const key of parseDockerfileEnvKeys(dockerfileContent)) {
      recordKey(key, 'Dockerfile');
    }
  }

  const composePath = path.join(cwd, 'docker-compose.yml');
  if (fs.existsSync(composePath)) {
    const composeContent = fs.readFileSync(composePath, 'utf-8');
    for (const key of parseComposeEnvKeys(composeContent)) {
      recordKey(key, 'docker-compose.yml');
    }
  }

  const keys = Array.from(sourceMap.keys()).sort();
  const sources = new Map<string, string[]>();
  for (const key of keys) {
    sources.set(key, Array.from(sourceMap.get(key) ?? []).sort());
  }

  return { keys, sources };
}

function extractLiteralDefault(node: ts.Expression, sourceFile: ts.SourceFile): string | null {
  const expr = unwrapExpression(node);
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text;
  }
  if (ts.isNumericLiteral(expr)) {
    return expr.text;
  }
  if (expr.kind === ts.SyntaxKind.TrueKeyword) {
    return 'true';
  }
  if (expr.kind === ts.SyntaxKind.FalseKeyword) {
    return 'false';
  }
  return expr.getText(sourceFile);
}

function analyzeZodPropertyChain(
  initializer: ts.Expression,
  sourceFile: ts.SourceFile
): { hasOptional: boolean; defaultValue: string | null } {
  let hasOptional = false;
  let defaultValue: string | null = null;

  function walkChain(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const methodName = node.expression.name.text;
      if (methodName === 'optional' || methodName === 'nullish') {
        hasOptional = true;
      } else if (methodName === 'default' && node.arguments.length > 0 && defaultValue === null) {
        defaultValue = extractLiteralDefault(node.arguments[0], sourceFile);
      }
      walkChain(node.expression.expression);
    } else {
      node.forEachChild(walkChain);
    }
  }

  walkChain(initializer);
  return { hasOptional, defaultValue };
}

const CLASSIFICATION_RANK: Record<EnvClassification, number> = {
  optional: 0,
  conditional: 1,
  'production-required': 2,
  required: 3,
};

function upgradeClassification(current: EnvClassification, candidate: EnvClassification): EnvClassification {
  return CLASSIFICATION_RANK[candidate] > CLASSIFICATION_RANK[current] ? candidate : current;
}

export function extractEnvSchemaSpecs(fileContent: string): Map<string, EnvFieldSpec> {
  const sourceFile = ts.createSourceFile('env.ts', fileContent, ts.ScriptTarget.Latest, true);
  const specs = new Map<string, EnvFieldSpec>();
  const objectLiteral = findEnvSchemaObjectLiteral(sourceFile);

  if (!objectLiteral) {
    return specs;
  }

  for (const prop of objectLiteral.properties) {
    if (ts.isPropertyAssignment(prop)) {
      const key = getPropertyNameText(prop.name);
      if (!key) continue;
      const { hasOptional, defaultValue } = analyzeZodPropertyChain(prop.initializer, sourceFile);
      const classification: EnvClassification =
        defaultValue !== null || hasOptional ? 'optional' : 'required';
      specs.set(key, { key, classification, defaultValue });
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      const key = prop.name.text;
      specs.set(key, { key, classification: 'required', defaultValue: null });
    }
  }

  // Collect constant string-array variable declarations (e.g. `const keys = ['S3_BUCKET', ...] as const`)
  const arrayBindings = new Map<string, string[]>();
  function collectArrays(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = unwrapExpression(node.initializer);
      if (ts.isArrayLiteralExpression(init)) {
        const items: string[] = [];
        for (const el of init.elements) {
          if (ts.isStringLiteralLike(el)) {
            items.push(el.text);
          }
        }
        if (items.length > 0) {
          arrayBindings.set(node.name.text, items);
        }
      }
    }
    ts.forEachChild(node, collectArrays);
  }
  collectArrays(sourceFile);

  // Map loop variables derived from known string arrays (e.g. `const missingKeys = keys.filter(...)`, `missingKeys.forEach(key => ...)`)
  const derivedArrayBindings = new Map<string, string[]>(arrayBindings);
  function collectDerivedArrays(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const text = node.initializer.getText(sourceFile);
      for (const [arrName, values] of arrayBindings.entries()) {
        if (new RegExp(`\\b${arrName}\\.filter\\b`).test(text)) {
          derivedArrayBindings.set(node.name.text, values);
        }
      }
    }
    ts.forEachChild(node, collectDerivedArrays);
  }
  collectDerivedArrays(sourceFile);

  function resolveIssueTargetKeys(
    issueObj: ts.ObjectLiteralExpression,
    loopVarBindings: Map<string, string[]>
  ): string[] {
    for (const prop of issueObj.properties) {
      if (ts.isPropertyAssignment(prop) && getPropertyNameText(prop.name) === 'path') {
        if (ts.isArrayLiteralExpression(prop.initializer) && prop.initializer.elements.length > 0) {
          const first = prop.initializer.elements[0];
          if (ts.isStringLiteralLike(first)) {
            return [first.text];
          }
          if (ts.isIdentifier(first)) {
            return loopVarBindings.get(first.text) ?? [];
          }
        }
      }
    }
    return [];
  }

  function extractIssueMessage(issueObj: ts.ObjectLiteralExpression): string {
    for (const prop of issueObj.properties) {
      if (ts.isPropertyAssignment(prop) && getPropertyNameText(prop.name) === 'message') {
        return prop.initializer.getText(sourceFile);
      }
    }
    return '';
  }

  function visitRefinements(
    node: ts.Node,
    inProductionGuard: boolean,
    enclosingIfCondition: string,
    loopVarBindings: Map<string, string[]>
  ) {
    let nextProdGuard = inProductionGuard;
    let nextIfCond = enclosingIfCondition;
    let nextLoopVars = loopVarBindings;

    if (ts.isIfStatement(node)) {
      const condText = node.expression.getText(sourceFile);
      if (/\bNODE_ENV\s*===\s*['"]production['"]/.test(condText)) {
        nextProdGuard = true;
      }
      nextIfCond = condText;
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'forEach' &&
      ts.isIdentifier(node.expression.expression) &&
      node.arguments.length > 0
    ) {
      const sourceArr = derivedArrayBindings.get(node.expression.expression.text);
      const callback = node.arguments[0];
      if (
        sourceArr &&
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
        callback.parameters.length > 0 &&
        ts.isIdentifier(callback.parameters[0].name)
      ) {
        nextLoopVars = new Map(loopVarBindings);
        nextLoopVars.set(callback.parameters[0].name.text, sourceArr);
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'addIssue' &&
      node.arguments.length > 0 &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const issueObj = node.arguments[0];
      const targetKeys = resolveIssueTargetKeys(issueObj, nextLoopVars);
      const messageText = extractIssueMessage(issueObj);

      for (const targetKey of targetKeys) {
        const existing = specs.get(targetKey);
        if (!existing) continue;

        if (nextProdGuard) {
          existing.classification = upgradeClassification(existing.classification, 'production-required');
        } else if (
          /\bis required when\b/i.test(messageText) ||
          /\bincomplete\b/i.test(messageText) ||
          (/\bpresent\w*\.length\s*>\s*0/.test(nextIfCond) && /\bpresent\w*\.length\s*</.test(nextIfCond))
        ) {
          existing.classification = upgradeClassification(existing.classification, 'conditional');
        }
      }
    }

    ts.forEachChild(node, (child) =>
      visitRefinements(child, nextProdGuard, nextIfCond, nextLoopVars)
    );
  }

  visitRefinements(sourceFile, false, '', new Map());
  return specs;
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

function splitMarkdownTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) {
    trimmed = trimmed.slice(0, -1);
  }

  const cells: string[] = [];
  let current = '';
  let inCode = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '\\' && i + 1 < trimmed.length) {
      current += trimmed[i + 1];
      i++;
      continue;
    }
    if (ch === '`') {
      inCode = !inCode;
      current += ch;
      continue;
    }
    if (ch === '|' && !inCode) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function isTableSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

function classifyFromRequirementCell(cellText: string, fallbackSubheading: string): EnvClassification {
  const normalized = cellText.replace(/`/g, '').trim();
  if (/^required\s+in\s+production\b/i.test(normalized) || /^production[- ]required\b/i.test(normalized)) {
    return 'production-required';
  }
  if (/^required\s+(?:if|when)\b/i.test(normalized) || /^conditional\b/i.test(normalized)) {
    return 'conditional';
  }
  if (/^(?:required|mandatory|yes)\b/i.test(normalized)) {
    return 'required';
  }
  if (/^(?:optional|no)\b/i.test(normalized)) {
    return 'optional';
  }
  return classifyFromSubheading(fallbackSubheading);
}

function classifyFromSubheading(subheading: string): EnvClassification {
  if (/\bproduction[- ]required\b/i.test(subheading)) {
    return 'production-required';
  }
  if (/\bmandatory\b/i.test(subheading) || (/\brequired\b/i.test(subheading) && !/\boptional\b/i.test(subheading))) {
    return 'required';
  }
  return 'optional';
}

function parseDefaultCell(cellText: string): string | null {
  const trimmed = cellText.trim();
  if (
    !trimmed ||
    /^(?:\*none\*|_none_|none|—|-|n\/a)$/i.test(trimmed)
  ) {
    return null;
  }
  const codeMatch = trimmed.match(/^`([^`]*)`$/);
  if (codeMatch) {
    return codeMatch[1];
  }
  const firstInlineCode = trimmed.match(/`([^`]*)`/);
  if (firstInlineCode) {
    return firstInlineCode[1];
  }
  return trimmed;
}

export function parseRuntimeContractTables(docContent: string): RuntimeContractRow[] {
  const sections = splitMarkdownSections(docContent);
  const envSection = sections.find((section) => /\benvironment\s+variable/i.test(section.heading));
  if (!envSection) {
    return [];
  }

  const rows: RuntimeContractRow[] = [];
  let currentSubheading = envSection.heading;
  let tableHeaders: string[] | null = null;
  let awaitingSeparator = false;

  for (const rawLine of envSection.nonCodeLines) {
    const trimmed = rawLine.trim();
    if (/^###\s+/.test(trimmed)) {
      currentSubheading = trimmed;
      tableHeaders = null;
      awaitingSeparator = false;
      continue;
    }

    if (!trimmed.startsWith('|')) {
      tableHeaders = null;
      awaitingSeparator = false;
      continue;
    }

    const cells = splitMarkdownTableRow(trimmed);
    if (!tableHeaders) {
      tableHeaders = cells;
      awaitingSeparator = true;
      continue;
    }

    if (awaitingSeparator) {
      if (isTableSeparatorRow(cells)) {
        awaitingSeparator = false;
        continue;
      }
      tableHeaders = null;
      awaitingSeparator = false;
      continue;
    }

    const firstCellMatch = (cells[0] ?? '').match(/^`([A-Za-z_][A-Za-z0-9_]*)`$/);
    if (!firstCellMatch) {
      continue;
    }
    const key = firstCellMatch[1];

    const reqColIdx = tableHeaders.findIndex((h) =>
      /^(?:requirement|required|status)$/i.test(h.trim())
    );
    const defaultColIdx = tableHeaders.findIndex((h) => /\bdefault\b/i.test(h.trim()));

    const classification =
      reqColIdx !== -1 && cells[reqColIdx] !== undefined
        ? classifyFromRequirementCell(cells[reqColIdx], currentSubheading)
        : classifyFromSubheading(currentSubheading);

    const hasDefaultColumn = defaultColIdx !== -1;
    const defaultValue =
      hasDefaultColumn && cells[defaultColIdx] !== undefined
        ? parseDefaultCell(cells[defaultColIdx])
        : null;

    rows.push({
      key,
      subheading: currentSubheading,
      classification,
      hasDefaultColumn,
      defaultValue,
    });
  }

  return rows;
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

function extractStructuredKeys(lines: string[]): string[] {
  const found: string[] = [];
  for (const line of lines) {
    const bulletMatch = line.match(/^\s*[-*]\s+`([A-Za-z_][A-Za-z0-9_]*)`/);
    if (bulletMatch) {
      found.push(bulletMatch[1]);
      continue;
    }
    const tableMatch = line.match(/^\s*\|\s*`([A-Za-z_][A-Za-z0-9_]*)`\s*\|/);
    if (tableMatch) {
      found.push(tableMatch[1]);
    }
  }
  return found;
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

  const allowedProviderRunbookKeys = new Set<string>([...keys, 'PORT', 'HOSTNAME']);

  for (const section of envSections) {
    for (const key of keys) {
      const count = countStructuredKeyEntries(section.nonCodeLines, key);
      if (count === 0) {
        errors.push(`Missing variable ${key} in section "${section.heading}" of ${docName}`);
      } else if (count > 1) {
        errors.push(`Duplicate variable ${key} in section "${section.heading}" of ${docName}`);
      }
    }

    if (docName.startsWith('docs/deployment/')) {
      for (const documentedKey of extractStructuredKeys(section.nonCodeLines)) {
        if (!allowedProviderRunbookKeys.has(documentedKey)) {
          errors.push(
            `Out-of-scope variable ${documentedKey} in section "${section.heading}" of ${docName} (provider runbooks are scoped to src/env.ts keys, PORT, and HOSTNAME)`
          );
        }
      }
    }
  }

  return errors;
}

export function validateRuntimeContract(
  docContent: string,
  operatorKeys: string[],
  envSpecs: Map<string, EnvFieldSpec>,
  keySources?: Map<string, string[]>
): string[] {
  const docName = 'docs/runtime-contract.md';
  const baseErrors = validateEnvDocContent(docName, docContent, operatorKeys);
  const errors: string[] = baseErrors.map((err) => {
    const missingMatch = err.match(/^Missing variable ([A-Za-z_][A-Za-z0-9_]*) in /);
    if (missingMatch && keySources) {
      const refs = keySources.get(missingMatch[1]);
      if (refs && refs.length > 0) {
        return `${err} (referenced in ${refs.join(', ')})`;
      }
    }
    return err;
  });

  const rows = parseRuntimeContractTables(docContent);
  const rowsByKey = new Map<string, RuntimeContractRow>();
  for (const row of rows) {
    if (!rowsByKey.has(row.key)) {
      rowsByKey.set(row.key, row);
    }
  }

  const operatorSet = new Set(operatorKeys);
  for (const row of rows) {
    if (!operatorSet.has(row.key)) {
      errors.push(
        `Stale or unrecognized variable ${row.key} in section "${row.subheading}" of ${docName} is not referenced in application, build, portal, or container files`
      );
    }
  }

  for (const [key, spec] of envSpecs.entries()) {
    const row = rowsByKey.get(key);
    if (!row) {
      if (!errors.some((e) => e.includes(`Missing variable ${key} `))) {
        errors.push(`Missing table entry for ${key} in ${docName}`);
      }
      continue;
    }

    if (row.classification !== spec.classification) {
      errors.push(
        `Classification mismatch for ${key} in ${docName} (${row.subheading}): expected "${spec.classification}" per src/env.ts, got "${row.classification}"`
      );
    }

    if (spec.defaultValue !== null) {
      if (!row.hasDefaultColumn || row.defaultValue !== spec.defaultValue) {
        errors.push(
          `Default value mismatch for ${key} in ${docName} (${row.subheading}): expected "${spec.defaultValue}" per src/env.ts, got "${row.defaultValue ?? 'none'}"`
        );
      }
    } else if (row.hasDefaultColumn && row.defaultValue !== null) {
      errors.push(
        `Default value mismatch for ${key} in ${docName} (${row.subheading}): expected no default (*None*) per src/env.ts, got "${row.defaultValue}"`
      );
    }
  }

  const containerDefaultSpecs: Array<{ key: string; defaultValue: string }> = [
    { key: 'HOSTNAME', defaultValue: '0.0.0.0' },
    { key: 'PORT', defaultValue: '3000' },
  ];
  for (const containerSpec of containerDefaultSpecs) {
    if (!operatorSet.has(containerSpec.key)) continue;
    const row = rowsByKey.get(containerSpec.key);
    if (!row) continue;
    if (row.classification !== 'optional') {
      errors.push(
        `Classification mismatch for ${containerSpec.key} in ${docName} (${row.subheading}): expected "optional", got "${row.classification}"`
      );
    }
    if (!row.hasDefaultColumn || row.defaultValue !== containerSpec.defaultValue) {
      errors.push(
        `Default value mismatch for ${containerSpec.key} in ${docName} (${row.subheading}): expected "${containerSpec.defaultValue}", got "${row.defaultValue ?? 'none'}"`
      );
    }
  }

  return errors;
}

export function validateProviderRunbookScope(
  docName: string,
  docContent: string,
  operatorKeys: string[],
  envSchemaKeys: string[]
): string[] {
  const errors: string[] = [];

  if (!docContent.includes('runtime-contract.md')) {
    errors.push(
      `${docName} must cross-reference docs/runtime-contract.md instead of duplicating the full environment variable matrix`
    );
  }

  const sections = splitMarkdownSections(docContent);
  const allowedProviderKeys = new Set<string>([...operatorKeys, 'PORT', 'HOSTNAME']);

  for (const section of sections) {
    if (
      /\benvironment\s+variables\s+reference\b/i.test(section.heading) ||
      /^##\s+\d+\.\s+required\s+environment\s+variables\b/i.test(section.heading)
    ) {
      errors.push(
        `Duplicate full environment variable reference section "${section.heading}" in ${docName} (canonical definitions belong in docs/runtime-contract.md)`
      );
      continue;
    }

    if (envSchemaKeys.length > 0) {
      const matchedSchemaKeys = envSchemaKeys.filter(
        (key) => countStructuredKeyEntries(section.nonCodeLines, key) > 0
      ).length;
      if (matchedSchemaKeys >= envSchemaKeys.length) {
        errors.push(
          `Duplicate full environment variable matrix in section "${section.heading}" of ${docName} (${matchedSchemaKeys} structured entries; canonical definitions belong in docs/runtime-contract.md)`
        );
      }
    }

    if (docName.startsWith('docs/deployment/') && /^##\s+2\./.test(section.heading)) {
      for (const documentedKey of extractStructuredKeys(section.nonCodeLines)) {
        if (/^[A-Z][A-Z0-9_]*$/.test(documentedKey) && !allowedProviderKeys.has(documentedKey)) {
          errors.push(
            `Out-of-scope variable ${documentedKey} in section "${section.heading}" of ${docName} (provider runbooks are scoped to recognized operator keys, PORT, and HOSTNAME)`
          );
        }
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
  const envSchemaKeys = getKeysFromSource(envFile);

  if (envSchemaKeys.length === 0) {
    console.error('❌ No environment variables found in src/env.ts schema');
    process.exit(1);
  }

  const envSpecs = extractEnvSchemaSpecs(envFile);
  const { keys: operatorKeys, sources } = collectOperatorEnvKeys(cwd);

  const docsToVerify = [
    { name: '.env.example', path: path.join(cwd, '.env.example') },
    { name: 'docs/runtime-contract.md', path: path.join(cwd, 'docs/runtime-contract.md') },
    { name: 'DEPLOYMENT.md', path: path.join(cwd, 'DEPLOYMENT.md') },
    { name: 'docs/deployment/README.md', path: path.join(cwd, 'docs/deployment/README.md') },
    { name: 'docs/deployment/docker-vps.md', path: path.join(cwd, 'docs/deployment/docker-vps.md') },
    { name: 'docs/deployment/gcp-cloud-run.md', path: path.join(cwd, 'docs/deployment/gcp-cloud-run.md') },
    { name: 'docs/deployment/vercel.md', path: path.join(cwd, 'docs/deployment/vercel.md') },
    { name: 'docs/deployment/railway-render.md', path: path.join(cwd, 'docs/deployment/railway-render.md') },
  ];

  let failed = false;

  const dockerfilePath = path.join(cwd, 'Dockerfile');
  const composePath = path.join(cwd, 'docker-compose.yml');
  const composeContent = fs.existsSync(composePath) ? fs.readFileSync(composePath, 'utf-8') : undefined;
  const envExampleKeys = composeContent
    ? Array.from(new Set([...envSchemaKeys, ...parseComposeEnvKeys(composeContent)]))
    : envSchemaKeys;

  if (fs.existsSync(dockerfilePath)) {
    const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf-8');
    for (const hostErr of validateContainerHostnameBinding(dockerfileContent, composeContent)) {
      console.error(`❌ ${hostErr}`);
      failed = true;
    }
  }

  for (const doc of docsToVerify) {
    if (!fs.existsSync(doc.path)) {
      console.error(`❌ Deployment guide ${doc.name} not found at ${doc.path}`);
      failed = true;
      continue;
    }
    const docContent = fs.readFileSync(doc.path, 'utf-8');
    const docErrors =
      doc.name === 'docs/runtime-contract.md'
        ? validateRuntimeContract(docContent, operatorKeys, envSpecs, sources)
        : doc.name === '.env.example'
          ? validateEnvDocContent(doc.name, docContent, envExampleKeys)
          : validateProviderRunbookScope(doc.name, docContent, operatorKeys, envSchemaKeys);

    for (const err of docErrors) {
      console.error(`❌ ${err}`);
      failed = true;
    }
  }

  if (failed) {
    console.error('\nDocumentation is out of sync with active environment variables and src/env.ts.');
    console.error('Please reconcile docs/runtime-contract.md and deployment guides with the codebase.');
    process.exit(1);
  } else {
    console.log(
      `✅ Environment variable documentation is up to date (${operatorKeys.length} operator-facing variables verified).`
    );
  }
}

const isMain =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  verifyEnvDocs();
}
