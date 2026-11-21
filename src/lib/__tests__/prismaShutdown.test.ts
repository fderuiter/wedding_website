/** @jest-environment node */

describe('Prisma and pg.Pool graceful shutdown hooks', () => {
  const originalExit = process.exit;
  const globalState = globalThis as unknown as Record<string, unknown>;

  beforeEach(() => {
    jest.resetModules();
    delete globalState.prisma;
    delete globalState.pgPool;
    delete globalState.prismaShutdownRegistered;
    delete globalState.prismaShutdownPromise;
  });

  afterEach(() => {
    process.exit = originalExit;
    delete globalState.prisma;
    delete globalState.pgPool;
    delete globalState.prismaShutdownRegistered;
    delete globalState.prismaShutdownPromise;
    jest.restoreAllMocks();
  });

  it('registers SIGTERM and SIGINT hooks and invokes prisma.$disconnect() and pool.end() idempotently', async () => {
    const mockDisconnect = jest.fn().mockResolvedValue(undefined);
    const mockPoolEnd = jest.fn().mockResolvedValue(undefined);
    const registeredSignals = new Map<string, () => void>();

    jest.spyOn(process, 'once').mockImplementation(((
      event: string | symbol,
      listener: (...args: unknown[]) => void
    ) => {
      registeredSignals.set(String(event), () => listener(event));
      return process;
    }) as typeof process.once);

    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        end: mockPoolEnd,
        ending: false,
        ended: false,
      })),
    }));
    jest.doMock('@prisma/adapter-pg', () => ({
      PrismaPg: jest.fn().mockImplementation(() => ({})),
    }));
    jest.doMock('@prisma/client', () => ({
      PrismaClient: jest.fn().mockImplementation(() => ({
        $disconnect: mockDisconnect,
      })),
    }));
    jest.doMock('../../env', () => ({
      env: {
        DATABASE_URL: 'postgresql://wedding:wedding123@localhost:5432/wedding_test',
        NODE_ENV: 'test',
      },
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../prisma');

    const sigtermHandler = registeredSignals.get('SIGTERM');
    const sigintHandler = registeredSignals.get('SIGINT');
    expect(sigtermHandler).toBeDefined();
    expect(sigintHandler).toBeDefined();

    sigtermHandler!();
    expect(globalState.prismaShutdownPromise).toBeDefined();
    await (globalState.prismaShutdownPromise as Promise<void>);

    sigintHandler!();
    await (globalState.prismaShutdownPromise as Promise<void>);

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(mockPoolEnd).toHaveBeenCalledTimes(1);
  });

  it('defers Next.js process.exit(143) on SIGTERM until prisma.$disconnect() and pool.end() finish draining', async () => {
    const events: string[] = [];
    let resolvePoolEnd!: () => void;
    const registeredSignals = new Map<string, () => void>();

    const mockDisconnect = jest.fn().mockImplementation(async () => {
      events.push('prisma.$disconnect');
    });
    const mockPoolEnd = jest.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          events.push('pool.end:start');
          resolvePoolEnd = () => {
            events.push('pool.end:done');
            resolve();
          };
        })
    );

    const exitSpy = jest.fn((code?: number) => {
      events.push(`exit:${String(code)}`);
      return undefined as never;
    });
    process.exit = exitSpy as unknown as typeof process.exit;

    jest.spyOn(process, 'once').mockImplementation(((
      event: string | symbol,
      listener: (...args: unknown[]) => void
    ) => {
      registeredSignals.set(String(event), () => listener(event));
      return process;
    }) as typeof process.once);
    jest.spyOn(process, 'listenerCount').mockImplementation((event: string | symbol) =>
      event === 'SIGTERM' ? 1 : 0
    );

    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        end: mockPoolEnd,
        ending: false,
        ended: false,
      })),
    }));
    jest.doMock('@prisma/adapter-pg', () => ({
      PrismaPg: jest.fn().mockImplementation(() => ({})),
    }));
    jest.doMock('@prisma/client', () => ({
      PrismaClient: jest.fn().mockImplementation(() => ({
        $disconnect: mockDisconnect,
      })),
    }));
    jest.doMock('../../env', () => ({
      env: {
        DATABASE_URL: 'postgresql://wedding:wedding123@localhost:5432/wedding_test',
        NODE_ENV: 'production',
      },
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../prisma');

    const sigtermHandler = registeredSignals.get('SIGTERM');
    expect(sigtermHandler).toBeDefined();

    // Simulate Next.js start-server.js receiving SIGTERM, closing HTTP server, and invoking process.exit(143)
    sigtermHandler!();
    setImmediate(() => {
      process.exit(143);
    });

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // Underlying exit must NOT have been called before pool.end resolves
    expect(exitSpy).not.toHaveBeenCalled();
    expect(events).toEqual(['prisma.$disconnect', 'pool.end:start']);

    resolvePoolEnd();
    await (globalState.prismaShutdownPromise as Promise<void>);
    await new Promise((r) => setImmediate(r));

    expect(events).toEqual([
      'prisma.$disconnect',
      'pool.end:start',
      'pool.end:done',
      'exit:143',
    ]);
  });
});
