import { Project } from 'ts-morph';
import { readFileSync } from 'fs';

const project = new Project({ tsConfigFilePath: 'tsconfig.json' });

const filesToFix = [
  'src/app/__tests__/metadata-new-fields.test.ts',
  'src/app/__tests__/metadata.test.ts',
  'src/app/__tests__/sitemap.test.ts',
  'src/app/admin/dashboard/page.tsx',
  'src/app/admin/dashboard/settings/__tests__/page.test.tsx',
  'src/app/admin/dashboard/settings/page.tsx',
  'src/app/admin/dashboard/site-manager/page.tsx',
  'src/app/admin/dashboard/wedding-party/page.tsx',
  'src/app/api/admin/[entity]/[id]/route.ts',
  'src/app/api/admin/maintenance/export/route.ts',
  'src/app/api/admin/versions/[id]/restore/route.ts',
  'src/app/archive/page.tsx',
  'src/app/heart/HeartClient.tsx',
  'src/app/heart/__tests__/page.test.tsx',
  'src/components/admin/AdminPreviewLayout.tsx',
  'src/components/setup/SetupWizard.tsx',
  'src/components/ui/ToastProvider.tsx',
  'src/features/admin/service.ts',
  'src/features/content/service.test.ts',
  'src/features/registry/api/__tests__/scrape.test.ts',
  'src/features/registry/api/get-items.ts',
  'src/features/registry/api/item-by-id.ts',
  'src/features/registry/hooks/__tests__/useRegistry.test.tsx',
  'src/features/weather/api/__tests__/weather.test.ts',
  'src/features/weather/api/weather-proxy.ts',
  'src/features/weather/components/__tests__/Forecast.test.tsx',
  'src/hooks/admin/useAdminFeatures.ts',
  'src/hooks/admin/useAdminSettings.ts',
  'src/hooks/use3DInteraction.tsx',
  'src/hooks/useEntityOrchestration.ts'
];

for (const f of filesToFix) {
  const sf = project.getSourceFile(f);
  if (!sf) continue;
  
  // Just rename variables? 
  // Let's use TS language service to get unused diagnostic
  const diagnostics = sf.getPreEmitDiagnostics();
  let offset = 0;
  
  for (const d of diagnostics) {
    if (d.getCode() === 6133) {
      const msg = d.getMessageText();
      const match = typeof msg === 'string' ? msg.match(/'([^']+)' is declared but its value is never read/) : null;
      if (match) {
        const varName = match[1];
        // We can rename it to _varName if it's a parameter, or comment it out?
        // Actually, renaming it might be easiest for parameters.
        try {
          const node = sf.getDescendantAtPos(d.getStart()!);
          if (node) {
             const parent = node.getParent();
             // Just a simple prefix
             if (node.getText() === varName) {
                // node is an Identifier
                node.replaceWithText('_' + varName);
             }
          }
        } catch (e) {}
      }
    }
  }
  sf.saveSync();
}
console.log('done');
