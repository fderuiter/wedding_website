import { readFileSync, writeFileSync } from 'fs';
import { globSync } from 'glob';

const files = globSync('src/**/*.{ts,tsx}');

for (const file of files) {
  let text = readFileSync(file, 'utf8');
  let changed = false;
  
  if (text.includes('import { useRouter }')) {
    text = text.replace(/import { useRouter } from ["']next\/navigation["'];?/g, '');
    text = text.replace(/const router = useRouter\(\);/g, '');
    changed = true;
  }
  
  if (file.endsWith('weather-proxy.ts')) {
    text = text.replace(/import { NextResponse } from ["']next\/server["'];?/g, '');
    changed = true;
  }
  
  if (file.endsWith('get-items.ts')) {
    text = text.replace(/NextRequest, /g, '');
    changed = true;
  }
  
  if (file.endsWith('use3DInteraction.tsx')) {
    text = text.replace(/, useEffect /g, ' ');
    changed = true;
  }
  
  if (file.endsWith('archive/page.tsx')) {
    text = text.replace(/import { Icon } from ["']@\/components\/ui\/Icon["'];?/g, '');
    changed = true;
  }
  
  if (file.endsWith('metadata.test.ts') || file.endsWith('sitemap.test.ts')) {
    text = text.replace(/getAppConfig, /g, '');
    changed = true;
  }
  
  if (file.endsWith('page.test.tsx') && file.includes('admin/dashboard/settings')) {
    text = text.replace(/useToast, /g, '');
    text = text.replace(/mutation, /g, '');
    changed = true;
  }
  
  if (file.endsWith('page.tsx') && file.includes('admin/dashboard') && !file.includes('settings') && !file.includes('site-manager') && !file.includes('wedding-party')) {
    text = text.replace(/import { RegistryItem } from ["']@\/features\/registry\/types["'];?/g, '');
    changed = true;
  }
  
  if (file.endsWith('metadata-new-fields.test.ts')) {
    text = text.replace(/import fs from ["']fs["'];?/g, '');
    changed = true;
  }
  
  if (file.endsWith('page.test.tsx') && file.includes('heart')) {
    text = text.replace(/const { container } = /g, '');
    changed = true;
  }
  
  if (file.endsWith('page.tsx') && file.includes('settings')) {
    text = text.replace(/_error/g, '');
    text = text.replace(/, error/g, '');
    changed = true;
  }

  // Parameters
  text = text.replace(/request: NextRequest/g, '_request: NextRequest');
  text = text.replace(/req: NextRequest/g, '_req: NextRequest');
  text = text.replace(/req: any/g, '_req: any');
  text = text.replace(/\(req, /g, '(_req, ');
  text = text.replace(/ctx: any/g, '_ctx: any');
  
  if (file.endsWith('useEntityOrchestration.ts') || file.endsWith('useAdminFeatures.ts') || file.endsWith('useAdminSettings.ts')) {
    text = text.replace(/err: any, variables: any/g, '_err: any, _variables: any');
    text = text.replace(/<T extends/g, '<_T extends');
    changed = true;
  }
  
  if (file.endsWith('service.test.ts')) {
    text = text.replace(/const { features, \.\.\.rest } =/g, 'const { features: _f, ...rest } =');
    text = text.replace(/const { type, data, \.\.\.rest } =/g, 'const { type: _t, data: _d, ...rest } =');
    text = text.replace(/const { id, data, \.\.\.rest } =/g, 'const { id: _i, data: _d2, ...rest } =');
    text = text.replace(/const { id, \.\.\.rest } =/g, 'const { id: _i2, ...rest } =');
    changed = true;
  }
  
  if (changed || text !== readFileSync(file, 'utf8')) {
    writeFileSync(file, text);
  }
}
