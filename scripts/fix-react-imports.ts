import { Project, DiagnosticCategory } from 'ts-morph';

const project = new Project({
  tsConfigFilePath: 'tsconfig.json',
});

const sourceFiles = project.getSourceFiles();
console.log(`Found ${sourceFiles.length} source files.`);

let changed = false;

for (const sourceFile of sourceFiles) {
  // Let's just fix the easy ones: unused 'React' imports
  const importDecls = sourceFile.getImportDeclarations();
  for (const importDecl of importDecls) {
    const defaultImport = importDecl.getDefaultImport();
    if (defaultImport && defaultImport.getText() === 'React') {
      const isUsed = sourceFile.getFullText().indexOf('React.') !== -1;
      // if not used, we can remove it if it's the only import, or remove the default import
      if (!isUsed) {
        importDecl.removeDefaultImport();
        if (importDecl.getNamedImports().length === 0 && !importDecl.getNamespaceImport()) {
          importDecl.remove();
        }
        changed = true;
      }
    }
  }
}

if (changed) {
  project.saveSync();
  console.log('Fixed React imports');
}
