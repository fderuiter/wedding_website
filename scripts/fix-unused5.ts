import { readFileSync, writeFileSync } from 'fs';

let text;

// 1. metadata.test.ts, sitemap.test.ts
for (const file of ['src/app/__tests__/metadata.test.ts', 'src/app/__tests__/sitemap.test.ts']) {
    text = readFileSync(file, 'utf8');
    text = text.replace(/import { getAppConfig } from '@\/lib\/config';/, '');
    text = text.replace(/getAppConfig, /g, '');
    text = text.replace(/import { getAppConfig, toPublicAppConfig } from '@\/lib\/config';/, "import { toPublicAppConfig } from '@/lib/config';");
    writeFileSync(file, text);
}

// 2. get-items.ts
text = readFileSync('src/features/registry/api/get-items.ts', 'utf8');
text = text.replace(/NextRequest, /, '');
text = text.replace(/import { NextRequest } from 'next\/server';/, '');
writeFileSync('src/features/registry/api/get-items.ts', text);

// 3. weather.test.ts
text = readFileSync('src/features/weather/api/__tests__/weather.test.ts', 'utf8');
text = text.replace(/req: NextRequest, ctx: any/g, '_req: NextRequest, _ctx: any');
writeFileSync('src/features/weather/api/__tests__/weather.test.ts', text);

// 4. useAdminFeatures, useAdminSettings
for (const file of ['src/hooks/admin/useAdminFeatures.ts', 'src/hooks/admin/useAdminSettings.ts']) {
    text = readFileSync(file, 'utf8');
    text = text.replace(/err: any, variables: any/g, '_err: any, _variables: any');
    text = text.replace(/\(err, variables/g, '(_err, _variables');
    writeFileSync(file, text);
}

// 5. useEntityOrchestration
text = readFileSync('src/hooks/useEntityOrchestration.ts', 'utf8');
text = text.replace(/err: any, variables: any/g, '_err: any, _variables: any');
text = text.replace(/variables: any/g, '_variables: any');
text = text.replace(/<T extends/g, '<_T extends');
writeFileSync('src/hooks/useEntityOrchestration.ts', text);

// 6. service.test.ts
text = readFileSync('src/features/content/service.test.ts', 'utf8');
text = text.replace(/features, \.\.\.rest/g, 'features: _f, ...rest');
text = text.replace(/type, data, \.\.\.rest/g, 'type: _t, data: _d, ...rest');
text = text.replace(/id, data, \.\.\.rest/g, 'id: _i, data: _d2, ...rest');
text = text.replace(/id, \.\.\.rest/g, 'id: _i2, ...rest');
writeFileSync('src/features/content/service.test.ts', text);
