import { Project, Identifier } from 'ts-morph';

const project = new Project({ tsConfigFilePath: 'tsconfig.json' });

const sourceFiles = project.getSourceFiles();

for (const sf of sourceFiles) {
  let changed = false;
  
  // Also we want to fix `import { useRouter } from ...`
  const imports = sf.getImportDeclarations();
  for (const imp of imports) {
     const named = imp.getNamedImports();
     for (const n of named) {
        if (n.getName() === 'useRouter') {
            n.remove();
            changed = true;
        }
        if (n.getName() === 'NextResponse' && sf.getBaseName() === 'weather-proxy.ts') {
            n.remove();
            changed = true;
        }
        if (n.getName() === 'NextRequest' && sf.getBaseName() === 'get-items.ts') {
            n.remove();
            changed = true;
        }
        if (n.getName() === 'useEffect' && sf.getBaseName() === 'use3DInteraction.tsx') {
            n.remove();
            changed = true;
        }
        if (n.getName() === 'Icon' && sf.getBaseName() === 'page.tsx') {
            n.remove();
            changed = true;
        }
        if (n.getName() === 'getAppConfig' && (sf.getBaseName() === 'metadata.test.ts' || sf.getBaseName() === 'sitemap.test.ts')) {
            n.remove();
            changed = true;
        }
     }
     if (imp.getNamedImports().length === 0 && !imp.getDefaultImport() && !imp.getNamespaceImport()) {
         imp.remove();
         changed = true;
     }
  }

  const text = sf.getFullText();
  let newText = text;
  
  // manual regex for parameters
  if (sf.getBaseName() === 'route.ts' || sf.getBaseName() === 'item-by-id.ts') {
     newText = newText.replace(/request: NextRequest/g, '_request: NextRequest');
     changed = true;
  }
  
  if (sf.getBaseName().includes('test')) {
     newText = newText.replace(/req: NextRequest/g, '_req: NextRequest');
     newText = newText.replace(/req: any/g, '_req: any');
     newText = newText.replace(/req, /g, '_req, ');
     newText = newText.replace(/ctx: any/g, '_ctx: any');
     changed = true;
  }
  
  if (sf.getBaseName() === 'useEntityOrchestration.ts') {
     newText = newText.replace(/err: any, variables: any/g, '_err: any, _variables: any');
     newText = newText.replace(/<T extends/g, '<_T extends');
     changed = true;
  }
  
  if (sf.getBaseName() === 'useAdminFeatures.ts' || sf.getBaseName() === 'useAdminSettings.ts') {
     newText = newText.replace(/err: any, variables: any/g, '_err: any, _variables: any');
     changed = true;
  }
  
  if (sf.getBaseName() === 'service.test.ts') {
     newText = newText.replace(/const { features, \.\.\.rest } =/g, 'const { features: _f, ...rest } =');
     newText = newText.replace(/const { type, data, \.\.\.rest } =/g, 'const { type: _t, data: _d, ...rest } =');
     newText = newText.replace(/const { id, data, \.\.\.rest } =/g, 'const { id: _i, data: _d2, ...rest } =');
     newText = newText.replace(/const { id, \.\.\.rest } =/g, 'const { id: _i2, ...rest } =');
     changed = true;
  }
  
  if (changed) {
    sf.replaceWithText(newText);
    sf.saveSync();
  }
}
console.log('done3');
