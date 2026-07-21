import { Project, Node } from 'ts-morph';
import path from 'path';

const project = new Project({
  tsConfigFilePath: 'tsconfig.json',
});

const sourceFiles = project.getSourceFiles();

const targetDirs = ['src/components/', 'src/hooks/', 'src/utils/'];

let hasErrors = false;

for (const sourceFile of sourceFiles) {
  if (sourceFile.getFilePath().includes('__tests__')) continue;
  
  if (!targetDirs.some(dir => sourceFile.getFilePath().includes(dir))) continue;
  
  const exportedDeclarations = sourceFile.getExportedDeclarations();
  
  for (const [name, declarations] of exportedDeclarations) {
    if (name === 'default') continue;
    
    // Ignore Next.js route handlers and metadata
    if (['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'metadata', 'generateMetadata', 'config'].includes(name)) continue;
    
    let isUsed = false;
    for (const declaration of declarations) {
      if (Node.isReferenceFindable(declaration)) {
        const refs = declaration.findReferencesAsNodes();
        if (refs.some(node => node.getSourceFile().getFilePath() !== sourceFile.getFilePath())) {
          isUsed = true;
          break;
        }
      }
    }
    
    if (!isUsed) {
      console.error(`Error: Unused export '${name}' in ${path.relative(process.cwd(), sourceFile.getFilePath())}`);
      hasErrors = true;
    }
  }
}

if (hasErrors) {
  process.exit(1);
} else {
  console.log('No unused UI/hook/util exports found.');
}
