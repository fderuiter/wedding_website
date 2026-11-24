import moduleModule from 'node:module';
import path from 'node:path';
import { NextRequest, NextResponse, after } from 'next/server';
import { PrismaClient, Prisma } from '@prisma/client';
import { withApiMiddleware } from '@/utils/withApiMiddleware';

const EXPECTED_MODEL_DELEGATES = [
  'appConfig',
  'media',
  'weddingPartyMember',
  'attraction',
  'registryItem',
  'contributor',
  'invitationCode',
  'seatingTable',
  'contentNode',
  'snapshotVersion',
  'subEvent',
  'subEventAccess',
  'subEventRsvp',
  'broadcastMessage',
  'broadcastRecipient',
  'authLockout',
] as const;

describe('Global Jest Setup (jest.setup.js)', () => {
  describe('NextRequest mock', () => {
    it('copies Web Headers instances, header tuples, plain objects, and cross-realm forEach headers into a real Headers object', () => {
      const webHeaders = new Headers({
        cookie: 'admin_auth=tok_abc==; guest_auth=guest_xyz=',
        'x-custom-header': 'from-web-headers',
      });
      const reqFromHeaders = new NextRequest('http://localhost:3000/api/admin/me', {
        headers: webHeaders,
      });

      expect(reqFromHeaders.headers).toBeInstanceOf(Headers);
      expect(reqFromHeaders.headers.get('x-custom-header')).toBe('from-web-headers');
      expect(reqFromHeaders.headers.get('host')).toBe('localhost:3000');
      expect(reqFromHeaders.cookies.get('admin_auth')).toEqual({
        name: 'admin_auth',
        value: 'tok_abc==',
      });
      expect(reqFromHeaders.cookies.get('guest_auth')).toEqual({
        name: 'guest_auth',
        value: 'guest_xyz=',
      });

      const reqFromTuples = new NextRequest('http://localhost:3000/api/live', {
        headers: [
          ['cookie', 'session_id=tuple123'],
          ['x-tuple', 'tuple-val'],
        ],
      });
      expect(reqFromTuples.headers).toBeInstanceOf(Headers);
      expect(reqFromTuples.headers.get('x-tuple')).toBe('tuple-val');
      expect(reqFromTuples.cookies.get('session_id')?.value).toBe('tuple123');

      const crossRealmHeadersLike = {
        forEach(cb: (_value: string, _key: string) => void) {
          cb('realm_cookie=cross_val', 'cookie');
          cb('realm-val', 'x-realm');
        },
      };
      const reqFromCrossRealm = new NextRequest('http://localhost:3000/api/ready', {
        headers: crossRealmHeadersLike as unknown as HeadersInit,
      });
      expect(reqFromCrossRealm.headers).toBeInstanceOf(Headers);
      expect(reqFromCrossRealm.headers.get('x-realm')).toBe('realm-val');
      expect(reqFromCrossRealm.cookies.get('realm_cookie')?.value).toBe('cross_val');
    });

    it('defaults method to GET and supports cookies.getAll, cookies.has, cookies.set, and cookies.delete', () => {
      const req = new NextRequest('http://localhost:3000/api/media', {
        headers: new Headers({
          cookie: 'first=1; second=2',
        }),
      });

      expect(req.method).toBe('GET');
      expect(req.cookies.has('first')).toBe(true);
      expect(req.cookies.has('missing')).toBe(false);
      expect(req.cookies.getAll()).toEqual([
        { name: 'first', value: '1' },
        { name: 'second', value: '2' },
      ]);

      req.cookies.set('third', '3');
      expect(req.cookies.has('third')).toBe(true);
      expect(req.headers.get('cookie')).toContain('third=3');

      expect(req.cookies.delete('first')).toBe(true);
      expect(req.cookies.has('first')).toBe(false);
      expect(req.cookies.getAll()).toEqual([
        { name: 'second', value: '2' },
        { name: 'third', value: '3' },
      ]);
    });

    it('returns {} from req.json() when init.body is absent and delegates clone, text, formData, and arrayBuffer to Request', async () => {
      const emptyReq = new NextRequest('http://localhost:3000/api/empty', {
        method: 'POST',
      });
      await expect(emptyReq.json()).resolves.toEqual({});

      const payload = { event: 'payment_intent.succeeded', amount: 5000 };
      const jsonReq = new NextRequest('http://localhost:3000/api/registry/webhook/stripe', {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'stripe-signature': 't=123,v1=sig',
          cookie: 'guest_auth=1',
        }),
        body: JSON.stringify(payload),
      });

      const cloned = jsonReq.clone() as NextRequest;
      expect(cloned.method).toBe('POST');
      expect(cloned.headers.get('stripe-signature')).toBe('t=123,v1=sig');
      expect(cloned.cookies.get('guest_auth')?.value).toBe('1');

      await expect(cloned.json()).resolves.toEqual(payload);
      await expect(jsonReq.text()).resolves.toBe(JSON.stringify(payload));

      const binarySource = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
      const binaryReq = new NextRequest('http://localhost:3000/api/admin/upload', {
        method: 'POST',
        body: binarySource,
      });
      const ab = await binaryReq.arrayBuffer();
      expect(Array.from(new Uint8Array(ab))).toEqual([0x25, 0x50, 0x44, 0x46]);

      const fd = new FormData();
      fd.append('uploaderName', 'Alex');
      fd.append('caption', 'Ceremony');
      const formReq = new NextRequest('http://localhost:3000/api/guest/photos/upload', {
        method: 'POST',
        body: fd,
      });
      const parsedForm = await formReq.formData();
      expect(parsedForm.get('uploaderName')).toBe('Alex');
      expect(parsedForm.get('caption')).toBe('Ceremony');
    });

    it('queues and flushes Next.js after() tasks inside __runWithAfterScope alongside NextRequest and NextResponse', async () => {
      expect(() => after(() => {})).toThrow('`after` was called outside a request scope');

      const runWithAfterScope = (
        globalThis as unknown as {
          __runWithAfterScope: <T>(_cb: () => Promise<T>) => Promise<{
            result: T;
            flush: () => Promise<void>;
            pendingCount: () => number;
          }>;
        }
      ).__runWithAfterScope;

      const events: string[] = [];
      const scoped = await runWithAfterScope(async () => {
        const req = new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          body: JSON.stringify({ amount: 50 }),
        });
        const body = await req.json();
        after(async () => {
          events.push(`deferred:${body.amount}`);
        });
        return NextResponse.json({ ok: true });
      });

      expect(scoped.result.status).toBe(200);
      expect(scoped.pendingCount()).toBe(1);
      expect(events).toEqual([]);

      await scoped.flush();
      expect(scoped.pendingCount()).toBe(0);
      expect(events).toEqual(['deferred:50']);
    });
  });

  describe('PrismaClient mock and integration test bypass', () => {
    it('generates CRUD delegates for all 16 Prisma models, passes all 16 delegates into $transaction, and stubs raw queries', async () => {
      expect(Object.keys(Prisma.ModelName)).toHaveLength(EXPECTED_MODEL_DELEGATES.length);

      const client = new PrismaClient() as unknown as Record<string, Record<string, unknown>> & {
        $transaction: <T>(_fn: (_tx: Record<string, unknown>) => Promise<T>) => Promise<T>;
        $queryRaw: jest.Mock;
        $queryRawUnsafe: jest.Mock;
        $executeRaw: jest.Mock;
        $executeRawUnsafe: jest.Mock;
      };

      const requiredCrudMethods = [
        'findUnique',
        'findFirst',
        'findMany',
        'create',
        'createMany',
        'update',
        'updateMany',
        'upsert',
        'delete',
        'deleteMany',
        'count',
        'aggregate',
        'groupBy',
      ];

      for (const delegateKey of EXPECTED_MODEL_DELEGATES) {
        const delegate = client[delegateKey];
        expect(delegate).toBeDefined();
        for (const method of requiredCrudMethods) {
          expect(jest.isMockFunction(delegate[method])).toBe(true);
        }
      }

      expect(jest.isMockFunction(client.$queryRaw)).toBe(true);
      expect(jest.isMockFunction(client.$queryRawUnsafe)).toBe(true);
      expect(jest.isMockFunction(client.$executeRaw)).toBe(true);
      expect(jest.isMockFunction(client.$executeRawUnsafe)).toBe(true);

      await client.$transaction(async (tx) => {
        for (const delegateKey of EXPECTED_MODEL_DELEGATES) {
          expect(tx[delegateKey]).toBe(client[delegateKey]);
        }
        expect(jest.isMockFunction(tx.$queryRaw)).toBe(true);
        expect(jest.isMockFunction(tx.$executeRaw)).toBe(true);
      });
    });

    it('returns actual @prisma/client for *.integration.test.ts and sampleData.test.ts while returning mocks when testPath is a unit test or absent', async () => {
      const originalGetState = expect.getState.bind(expect);
      const getStateSpy = jest.spyOn(expect, 'getState');

      try {
        jest.resetModules();
        getStateSpy.mockImplementation(() => ({
          ...originalGetState(),
          testPath: undefined,
        }));
        const emptyPathPrisma = await import('@prisma/client');
        expect(jest.isMockFunction(emptyPathPrisma.PrismaClient)).toBe(true);

        jest.resetModules();
        getStateSpy.mockImplementation(() => ({
          ...originalGetState(),
          testPath: '/app/src/app/api/admin/__tests__/onboardingMilestones.integration.test.ts',
        }));
        const integrationPrisma = await import('@prisma/client');
        expect(jest.isMockFunction(integrationPrisma.PrismaClient)).toBe(false);

        jest.resetModules();
        getStateSpy.mockImplementation(() => ({
          ...originalGetState(),
          testPath: '/app/src/lib/sampleData/__tests__/sampleData.test.ts',
        }));
        const sampleDataPrisma = await import('@prisma/client');
        expect(jest.isMockFunction(sampleDataPrisma.PrismaClient)).toBe(false);
      } finally {
        getStateSpy.mockRestore();
        jest.resetModules();
      }
    });
  });

  describe('afterEach rate limit reset across 6 sequential auth tests', () => {
    const authLoginHandler = withApiMiddleware(async () =>
      NextResponse.json({ authenticated: true }, { status: 200 })
    );

    it.each([1, 2, 3, 4, 5, 6])(
      'allows sequential auth lockout call #%i across separate tests without hitting 429',
      async (attempt) => {
        const req = new NextRequest('http://localhost:3000/api/admin/login', {
          method: 'POST',
          headers: new Headers({ host: 'localhost:3000' }),
          body: JSON.stringify({ attempt }),
        });
        const res = await authLoginHandler(req);
        expect(res.status).toBe(200);
      }
    );
  });

  describe('scoped module.createRequire paths', () => {
    it('maps /pdfkit.js URLs to node_modules/pdfkit/js/pdfkit.js', () => {
      const pdfRequire = moduleModule.createRequire('http://localhost/pdfkit.js');
      const resolvedFont = pdfRequire.resolve('./standard-fonts/Helvetica.cjs');
      expect(resolvedFont).toBe(
        path.join(process.cwd(), 'node_modules', 'pdfkit', 'js', 'standard-fonts', 'Helvetica.cjs')
      );
    });

    it('resolves non-pdfkit JSDOM http/https URLs relative to process.cwd() and preserves standard paths', () => {
      const rootRequire = moduleModule.createRequire('http://localhost/');
      expect(rootRequire.resolve('./package.json')).toBe(
        path.join(process.cwd(), 'package.json')
      );

      const utilsRequire = moduleModule.createRequire(
        'http://localhost/src/utils/placeholder.js'
      );
      expect(utilsRequire.resolve('./rateLimit.ts')).toBe(
        path.join(process.cwd(), 'src', 'utils', 'rateLimit.ts')
      );

      const fileRequire = moduleModule.createRequire(
        path.join(process.cwd(), 'package.json')
      );
      expect(fileRequire.resolve('./jest.setup.js')).toBe(
        path.join(process.cwd(), 'jest.setup.js')
      );
    });
  });

  describe('Three-project Jest isolation, SerialTestRunner, and JSDOM teardown cleanup', () => {
    it('executes unit-node suites in native node without booting JSDOM or DOM globals', () => {
      expect(typeof window).toBe('undefined');
      expect(typeof document).toBe('undefined');
      expect(typeof (globalThis as Record<string, unknown>).ResizeObserver).toBe('undefined');
      expect(typeof (globalThis as Record<string, unknown>).HTMLCanvasElement).toBe('undefined');
      expect(
        typeof (expect(null) as unknown as Record<string, unknown>).toBeInTheDocument
      ).toBe('undefined');
    });

    it('exposes isSerial = true on jest-serial-runner.cjs and partitions jest.config.mjs into unit-node, unit-jsdom, and db-serial', async () => {
      const rootRequire = moduleModule.createRequire(path.join(process.cwd(), 'package.json'));
      const SerialTestRunner = rootRequire('./jest-serial-runner.cjs') as new (
        _globalConfig: Record<string, unknown>,
        _context: Record<string, unknown>
      ) => { isSerial?: boolean };
      const runnerInstance = new SerialTestRunner({ maxWorkers: 2 }, {});
      expect(runnerInstance.isSerial).toBe(true);

      const { execFileSync } = moduleModule.createRequire(
        path.join(process.cwd(), 'package.json')
      )('node:child_process') as typeof import('node:child_process');
      const rawStdout = execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          'const cfg = await (await import("./jest.config.mjs")).default; process.stdout.write("\\n__JEST_CFG__:" + JSON.stringify(cfg));',
        ],
        { cwd: process.cwd(), encoding: 'utf8' }
      );
      const rawConfigJson = rawStdout.split('__JEST_CFG__:')[1] ?? '{}';
      const resolvedJestConfig = JSON.parse(rawConfigJson) as {
        workerIdleMemoryLimit?: string;
        projects?: Array<{
          displayName?: string | { name?: string };
          runner?: string;
          testEnvironment?: string;
          testMatch?: string[];
          testPathIgnorePatterns?: string[];
        }>;
      };
      expect(resolvedJestConfig.workerIdleMemoryLimit).toBe('1024MB');
      const projects = resolvedJestConfig.projects ?? [];
      expect(Array.isArray(projects)).toBe(true);
      const projectNames = projects.map((proj) =>
        typeof proj.displayName === 'string' ? proj.displayName : proj.displayName?.name
      );
      expect(projectNames).toEqual(['unit-node', 'unit-jsdom', 'db-serial']);

      const nodeProject = projects.find((proj) => proj.displayName === 'unit-node');
      const jsdomProject = projects.find((proj) => proj.displayName === 'unit-jsdom');
      const dbProject = projects.find((proj) => proj.displayName === 'db-serial');
      expect(dbProject?.runner).toBe('<rootDir>/jest-serial-runner.cjs');
      expect(dbProject?.testEnvironment).toBe('node');
      expect(jsdomProject?.testEnvironment).toBe('<rootDir>/jsdom-env.cjs');
      expect(jsdomProject?.testMatch).toEqual(
        expect.arrayContaining([
          '<rootDir>/src/__tests__/generate-portal.test.ts',
          '<rootDir>/src/utils/__tests__/exportDownload.test.ts',
        ])
      );
      expect(
        (nodeProject?.testPathIgnorePatterns ?? []).some((pattern) =>
          new RegExp(pattern.replace('<rootDir>', '/app')).test(
            '/app/src/utils/__tests__/exportDownload.test.ts'
          )
        )
      ).toBe(true);
    });

    it('clears active timeout, interval, and immediate handles during jsdom-env.cjs teardown', async () => {
      const rootRequire = moduleModule.createRequire(path.join(process.cwd(), 'package.json'));
      const CustomEnvironment = rootRequire('./jsdom-env.cjs') as new (
        _config: {
          globalConfig: Record<string, unknown>;
          projectConfig: {
            globals: Record<string, unknown>;
            testEnvironmentOptions: Record<string, unknown>;
            fakeTimers: Record<string, unknown>;
          };
        },
        _context: { console: Console; docblockPragmas: Record<string, unknown>; testPath: string }
      ) => {
        global: typeof globalThis;
        _activeTimeouts: Set<{ hasRef: () => boolean }>;
        _activeIntervals: Set<{ hasRef: () => boolean }>;
        _activeImmediates: Set<unknown>;
        setup: () => Promise<void>;
        teardown: () => Promise<void>;
      };

      const envInstance = new CustomEnvironment(
        {
          globalConfig: {},
          projectConfig: {
            globals: {},
            testEnvironmentOptions: { url: 'http://localhost/' },
            fakeTimers: {},
          },
        },
        {
          console,
          docblockPragmas: {},
          testPath: path.join(process.cwd(), 'src/components/__tests__/teardown.test.tsx'),
        }
      );

      await envInstance.setup();
      let leakedFired = false;
      const pendingTimeout = envInstance.global.setTimeout(() => {
        leakedFired = true;
      }, 60_000);
      const pendingInterval = envInstance.global.setInterval(() => {
        leakedFired = true;
      }, 60_000);
      const pendingImmediate = envInstance.global.setImmediate(() => {
        leakedFired = true;
      });

      expect(envInstance._activeTimeouts.has(pendingTimeout)).toBe(true);
      expect(envInstance._activeIntervals.has(pendingInterval)).toBe(true);
      expect(envInstance._activeImmediates.has(pendingImmediate)).toBe(true);

      await envInstance.teardown();

      expect(envInstance._activeTimeouts.size).toBe(0);
      expect(envInstance._activeIntervals.size).toBe(0);
      expect(envInstance._activeImmediates.size).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 15));
      expect(leakedFired).toBe(false);
    });
  });
});
