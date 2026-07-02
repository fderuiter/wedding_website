import { readFileSync, writeFileSync } from 'fs';

// service.test.ts
let text = readFileSync('src/features/content/service.test.ts', 'utf8');
text = text.replace(/features: any\[\]/g, '_features: any[]');
text = text.replace(/type: string/g, '_type: string');
text = text.replace(/data: any/g, '_data: any');
text = text.replace(/id: string/g, '_id: string');
writeFileSync('src/features/content/service.test.ts', text);

// hooks
for (const file of ['src/hooks/admin/useAdminFeatures.ts', 'src/hooks/admin/useAdminSettings.ts', 'src/hooks/useEntityOrchestration.ts']) {
    text = readFileSync(file, 'utf8');
    text = text.replace(/err, variables/g, '_err, _variables');
    writeFileSync(file, text);
}

// weather.test.ts
text = readFileSync('src/features/weather/api/__tests__/weather.test.ts', 'utf8');
text = text.replace(/_req: NextRequest, ctx: any/g, '_req: NextRequest, _ctx: any');
text = text.replace(/\(req: NextRequest, ctx: any\)/g, '(_req: NextRequest, _ctx: any)');
writeFileSync('src/features/weather/api/__tests__/weather.test.ts', text);

// get-items.ts
text = readFileSync('src/features/registry/api/get-items.ts', 'utf8');
text = text.replace(/NextRequest/g, '');
writeFileSync('src/features/registry/api/get-items.ts', text);

