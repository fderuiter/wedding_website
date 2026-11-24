import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

describe('OpenAPI JSDoc Deprecation Parser', () => {
  let tempWorkspace: string;
  let openapiPath: string;

  beforeAll(() => {
    tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'openapi-deprecation-'));
    const tempAppDir = path.join(tempWorkspace, 'src', 'app');
    const tempRouteDir = path.join(tempAppDir, 'api', 'admin', 'temp-deprecated-route');
    const tempRouteFile = path.join(tempRouteDir, 'route.ts');
    openapiPath = path.join(tempWorkspace, 'openapi.json');

    fs.mkdirSync(tempRouteDir, { recursive: true });

    // Write a temporary route with deprecation tags
    const content = `import { NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';

/**
 * Temp get handler description.
 * @deprecated Use /api/admin/other instead.
 */
export const GET = withApiMiddleware(async () => {
  return NextResponse.json({ success: true });
});

/**
 * @deprecated Delete is obsolete.
 */
export const DELETE = withApiMiddleware(async () => {
  return NextResponse.json({ success: true });
});
`;
    fs.writeFileSync(tempRouteFile, content, 'utf8');

    // Run openapi schema generation into isolated temp output
    execSync('npx tsx scripts/generate-openapi.ts', {
      stdio: 'inherit',
      env: {
        ...process.env,
        OPENAPI_EXTRA_APP_DIR: tempAppDir,
        OPENAPI_OUTPUT_PATH: openapiPath,
      },
    });
  });

  afterAll(() => {
    if (tempWorkspace && fs.existsSync(tempWorkspace)) {
      fs.rmSync(tempWorkspace, { recursive: true, force: true });
    }
  });

  it('correctly marks the GET route as deprecated and appends the migration reason', () => {
    const openapi = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
    const route = openapi.paths['/api/admin/temp-deprecated-route'];

    expect(route).toBeDefined();
    expect(route.get).toBeDefined();
    expect(route.get.deprecated).toBe(true);
    expect(route.get.description).toBe('Temp get handler description. Use /api/admin/other instead.');
  });

  it('correctly marks the DELETE route as deprecated and appends the migration reason to the default description', () => {
    const openapi = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
    const route = openapi.paths['/api/admin/temp-deprecated-route'];

    expect(route).toBeDefined();
    expect(route.delete).toBeDefined();
    expect(route.delete.deprecated).toBe(true);
    expect(route.delete.description).toBe('Endpoint for /api/admin/temp-deprecated-route Delete is obsolete.');
  });
});
