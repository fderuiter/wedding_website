import { Project } from 'ts-morph';

const project = new Project({ tsConfigFilePath: 'tsconfig.json' });

const filesToFix = [
  'src/app/__tests__/metadata-new-fields.test.ts',
  'src/app/__tests__/metadata.test.ts',
  'src/app/__tests__/sitemap.test.ts',
  'src/app/admin/dashboard/page.tsx',
  'src/app/admin/dashboard/settings/page.tsx',
  'src/app/admin/dashboard/site-manager/page.tsx',
  'src/app/admin/dashboard/wedding-party/page.tsx',
  'src/app/api/admin/[entity]/[id]/route.ts',
  'src/app/archive/page.tsx',
  'src/app/heart/__tests__/page.test.tsx',
  'src/components/admin/AdminPreviewLayout.tsx',
  'src/components/setup/SetupWizard.tsx',
  'src/features/content/service.test.ts',
  'src/features/registry/api/__tests__/scrape.test.ts',
  'src/features/registry/api/item-by-id.ts',
  'src/features/registry/hooks/__tests__/useRegistry.test.tsx',
  'src/features/weather/api/__tests__/weather.test.ts',
  'src/features/weather/api/weather-proxy.ts',
  'src/features/weather/components/__tests__/Forecast.test.tsx',
  'src/hooks/useEntityOrchestration.ts'
];

for (const f of filesToFix) {
  const sf = project.getSourceFile(f);
  if (!sf) continue;
  
  sf.organizeImports();
  
  // also fix destructuring _router, _error, etc
  const text = sf.getFullText();
  let newText = text.replace(/, _router/, '')
                    .replace(/_router, /, '')
                    .replace(/_router/, '')
                    .replace(/, _error/, '')
                    .replace(/_error, /, '')
                    .replace(/_error/, '')
                    .replace(/, err/, '')
                    .replace(/err, /, '')
                    .replace(/err/, '')
                    .replace(/, variables/, '')
                    .replace(/variables, /, '')
                    .replace(/variables/, '');
                    
  sf.replaceWithText(newText);
  sf.saveSync();
}
console.log('done2');
