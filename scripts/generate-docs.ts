import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const scriptDir = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));

// 1. Generate Configuration Markdown from Schema
import { AppConfigSchema } from '../src/features/content/schemas.ts';

export function getZodType(schema: any): string {
  if (!schema) return 'unknown';

  let s = schema;
  let depth = 0;
  while (s && depth < 20) {
    depth++;
    const t = s.type || s._def?.typeName;
    if (
      t === 'default' || t === 'ZodDefault' ||
      t === 'optional' || t === 'ZodOptional' ||
      t === 'exactOptional' || t === 'ZodExactOptional' ||
      t === 'nullable' || t === 'ZodNullable' ||
      t === 'prefault' || t === 'ZodPrefault' ||
      t === 'nonoptional' || t === 'ZodNonOptional' ||
      t === 'readonly' || t === 'ZodReadonly' ||
      t === 'catch' || t === 'ZodCatch' ||
      t === 'brand' || t === 'ZodBrand'
    ) {
      s = s.def?.innerType || s._def?.innerType || (typeof s.unwrap === 'function' ? s.unwrap() : undefined);
    } else if (t === 'effects' || t === 'ZodEffects') {
      s = s.def?.schema || s._def?.schema || s.def?.innerType || s._def?.innerType || (typeof s.unwrap === 'function' ? s.unwrap() : undefined);
    } else if (t === 'pipe' || t === 'pipeline' || t === 'ZodPipe' || t === 'ZodPipeline') {
      const out = s.def?.out || s._def?.out || s.out;
      if (out && (out.type === 'transform' || out._def?.typeName === 'ZodTransform')) {
        s = s.def?.in || s._def?.in || s.in;
      } else if (out) {
        s = out;
      } else {
        s = s.def?.in || s._def?.in || s.in;
      }
    } else {
      break;
    }
  }

  if (!s) return 'unknown';

  const t = s.type || s._def?.typeName;
  if (t === 'string' || t === 'ZodString') return 'string';
  if (t === 'number' || t === 'ZodNumber') return 'number';
  if (t === 'boolean' || t === 'ZodBoolean') return 'boolean';
  if (t === 'date' || t === 'ZodDate') return 'date';
  if (t === 'literal' || t === 'ZodLiteral') {
    const val = s.value !== undefined ? s.value : (s.def?.value ?? s._def?.value);
    return typeof val === 'string' ? `'${val}'` : String(val);
  }
  if (t === 'enum' || t === 'ZodEnum') {
    const values = s.options || s._def?.values || (s.def?.entries ? Object.keys(s.def.entries) : undefined) || (s.enum ? Object.keys(s.enum) : undefined);
    return values && values.length > 0 ? values.map((v: any) => typeof v === 'string' ? `'${v}'` : String(v)).join(' | ') : 'enum';
  }
  if (t === 'record' || t === 'ZodRecord') return 'record';
  if (t === 'union' || t === 'ZodUnion') {
    const options = s.options || s.def?.options || s._def?.options;
    return options?.map(getZodType).join(' | ') || 'union';
  }
  if (t === 'array' || t === 'ZodArray') {
    const element = s.element || s.def?.element || (typeof s.def?.type === 'object' ? s.def.type : undefined) || (typeof s._def?.type === 'object' ? s._def.type : undefined);
    return getZodType(element) + '[]';
  }
  if (t === 'object' || t === 'ZodObject') return 'object';
  if (t === 'any' || t === 'ZodAny' || t === 'transform' || t === 'ZodTransform') return 'any';
  if (t === 'unknown' || t === 'ZodUnknown') return 'unknown';

  return t || 'unknown';
}

export function generateConfigTable() {
  const shape = AppConfigSchema.shape;
  let markdown = '| Field | Type | Description |\n|---|---|---|\n';
  
  for (const [key, value] of Object.entries(shape)) {
    const type = getZodType(value);
    markdown += `| \`${key}\` | \`${type}\` | Configuration field for ${key} |\n`;
  }
  
  return markdown;
}

// 2. Generate Routing Structure
interface RouteNode {
  name: string;
  relativePath: string;
  hasPage: boolean;
  hasApi: boolean;
  children: RouteNode[];
}

function buildRouteTree(srcPath: string, relativePath: string = ''): RouteNode | null {
  const name = path.basename(srcPath);
  const entries = fs.readdirSync(srcPath, { withFileTypes: true });

  let hasPage = false;
  let hasApi = false;
  const children: RouteNode[] = [];

  for (const entry of entries) {
    if (entry.isFile()) {
      if (/^page\.(tsx|ts|jsx|js)$/.test(entry.name)) {
        hasPage = true;
      }
      if (/^route\.(tsx|ts|jsx|js)$/.test(entry.name)) {
        hasApi = true;
      }
    } else if (entry.isDirectory()) {
      if (entry.name.includes('__tests__') || entry.name.includes('components')) {
        continue;
      }

      const childFullPath = path.join(srcPath, entry.name);
      const childRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
      const childNode = buildRouteTree(childFullPath, childRelativePath);

      if (childNode !== null) {
        children.push(childNode);
      }
    }
  }

  if (hasPage || hasApi || children.length > 0) {
    return {
      name: relativePath ? path.basename(relativePath) : name,
      relativePath,
      hasPage,
      hasApi,
      children
    };
  }

  return null;
}

export function generateRoutesDiagram() {
  const srcAppPath = path.join(scriptDir, '../src/app');
  const tree = buildRouteTree(srcAppPath);
  
  let treeMarkdown = '```mermaid\nflowchart LR\n';
  treeMarkdown += '    classDef page fill:#0284c7,stroke:#0369a1,color:#ffffff,stroke-width:2px;\n';
  treeMarkdown += '    classDef api fill:#4c1d95,stroke:#3b82f6,color:#ffffff,stroke-width:2px;\n\n';
  
  if (!tree) {
    treeMarkdown += '    App["src/app"]\n```\n';
    return treeMarkdown;
  }
  
  const nodes = new Map<string, { id: string, name: string, type: 'page' | 'api' | 'none' }>();
  const edges: { from: string, to: string }[] = [];
  
  function traverse(node: RouteNode, parentId: string | null) {
    let id: string;
    let displayName = node.name;
    if (node.relativePath === '') {
      id = 'App';
      displayName = 'src/app';
    } else {
      id = 'node_' + node.relativePath.replace(/\\/g, '/').split('/').join('_').replace(/\[|\]|-/g, '');
    }
    
    let type: 'page' | 'api' | 'none' = 'none';
    if (node.hasPage) type = 'page';
    else if (node.hasApi) type = 'api';
    
    nodes.set(id, { id, name: displayName, type });
    
    if (parentId) {
      edges.push({ from: parentId, to: id });
    }
    
    for (const child of node.children) {
      traverse(child, id);
    }
  }
  
  traverse(tree, null);
  
  for (const [id, info] of nodes.entries()) {
    treeMarkdown += `    ${id}["${info.name}"]\n`;
  }
  
  for (const edge of edges) {
    treeMarkdown += `    ${edge.from} --> ${edge.to}\n`;
  }
  
  for (const [id, info] of nodes.entries()) {
    if (info.type === 'page') {
      treeMarkdown += `    class ${id} page;\n`;
    } else if (info.type === 'api') {
      treeMarkdown += `    class ${id} api;\n`;
    }
  }
  
  treeMarkdown += '```\n';
  return treeMarkdown;
}

// 3. Generate Environment Specs
export function generateEnvSpecs() {
  const pkgPath = path.join(scriptDir, '../package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  
  // We specify Node 22 as per requirements
  const nodeVersion = '22.x'; 
  
  return `- **Node.js**: v${nodeVersion}
- **Next.js**: ${pkg.dependencies.next}
- **React**: ${pkg.dependencies.react}
- **Prisma**: ${pkg.dependencies['@prisma/client'] || pkg.dependencies['@prisma/config'] || pkg.devDependencies['@prisma/client']}
- **Zod**: ${pkg.dependencies.zod}`;
}

// 4. Update ARCHITECTURE.md
export function updateArchitectureMd() {
  const filePath = path.join(scriptDir, '../ARCHITECTURE.md');
  let content = fs.readFileSync(filePath, 'utf8');

  // Replace Env
  const envRegex = /<!-- BEGIN AUTOGENERATED ENV -->[\s\S]*<!-- END AUTOGENERATED ENV -->/;
  content = content.replace(envRegex, `<!-- BEGIN AUTOGENERATED ENV -->\n${generateEnvSpecs()}\n<!-- END AUTOGENERATED ENV -->`);

  // Replace Routes
  const routesRegex = /<!-- BEGIN AUTOGENERATED ROUTES -->[\s\S]*<!-- END AUTOGENERATED ROUTES -->/;
  content = content.replace(routesRegex, `<!-- BEGIN AUTOGENERATED ROUTES -->\n${generateRoutesDiagram()}\n<!-- END AUTOGENERATED ROUTES -->`);

  // Replace Config
  const configRegex = /<!-- BEGIN AUTOGENERATED CONFIG -->[\s\S]*<!-- END AUTOGENERATED CONFIG -->/;
  content = content.replace(configRegex, `<!-- BEGIN AUTOGENERATED CONFIG -->\n${generateConfigTable()}\n<!-- END AUTOGENERATED CONFIG -->`);

  fs.writeFileSync(filePath, content);
  console.log('Successfully updated ARCHITECTURE.md');
}

export async function generateOpenApiSpec() {
  const openApiScript = path.join(scriptDir, 'generate-openapi.ts');
  if (fs.existsSync(openApiScript)) {
    console.log('Generating OpenAPI specification...');
    await import('./generate-openapi.js');
  }
}

const isMain = typeof process.argv[1] === 'string' &&
               path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  updateArchitectureMd();
  void generateOpenApiSpec();
}
