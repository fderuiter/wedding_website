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
    jest.useRealTimers();
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
      listener: (..._args: unknown[]) => void
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

  it('reuses one pool across isolated production module graphs and allows drains longer than 4500 ms before process.exit(143)', async () => {
    jest.useFakeTimers();

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

    const PoolMock = jest.fn().mockImplementation(() => ({
      end: mockPoolEnd,
      ending: false,
      ended: false,
    }));
    const PrismaClientMock = jest.fn().mockImplementation(() => ({
      $disconnect: mockDisconnect,
    }));

    const exitSpy = jest.fn((code?: number) => {
      events.push(`exit:${String(code)}`);
      return undefined as never;
    });
    process.exit = exitSpy as unknown as typeof process.exit;

    const onceSpy = jest.spyOn(process, 'once').mockImplementation(((
      event: string | symbol,
      listener: (..._args: unknown[]) => void
    ) => {
      registeredSignals.set(String(event), () => listener(event));
      return process;
    }) as typeof process.once);
    jest.spyOn(process, 'listenerCount').mockImplementation((event: string | symbol) =>
      event === 'SIGTERM' ? 1 : 0
    );

    jest.doMock('pg', () => ({ Pool: PoolMock }));
    jest.doMock('@prisma/adapter-pg', () => ({
      PrismaPg: jest.fn().mockImplementation(() => ({})),
    }));
    jest.doMock('@prisma/client', () => ({ PrismaClient: PrismaClientMock }));
    jest.doMock('../../env', () => ({
      env: {
        DATABASE_URL: 'postgresql://wedding:wedding123@localhost:5432/wedding_test',
        NODE_ENV: 'production',
      },
    }));

    let apiRuntimePrisma: unknown;
    let ssrRuntimePrisma: unknown;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      apiRuntimePrisma = require('../prisma').prisma;
    });
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ssrRuntimePrisma = require('../prisma').prisma;
    });

    expect(apiRuntimePrisma).toBeDefined();
    expect(ssrRuntimePrisma).toBe(apiRuntimePrisma);
    expect(PoolMock).toHaveBeenCalledTimes(1);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
    expect(onceSpy).toHaveBeenCalledTimes(2);

    const sigtermHandler = registeredSignals.get('SIGTERM');
    expect(sigtermHandler).toBeDefined();

    // Simulate Next.js standalone server receiving SIGTERM while an in-flight HTTP request
    // takes 6000 ms (> 4500 ms) inside server.close() before invoking process.exit(143).
    sigtermHandler!();

    await jest.advanceTimersByTimeAsync(6000);

    // Neither pool teardown nor process.exit may abort the active HTTP server drain at 4500 ms.
    expect(mockDisconnect).not.toHaveBeenCalled();
    expect(mockPoolEnd).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(events).toEqual([]);

    // Framework server.close() finishes active requests and invokes process.exit(143).
    process.exit(143);
    await Promise.resolve();
    await Promise.resolve();

    // Underlying exit must still wait for pool.end() to transmit PostgreSQL Terminate frames.
    expect(exitSpy).not.toHaveBeenCalled();
    expect(events).toEqual(['prisma.$disconnect', 'pool.end:start']);

    resolvePoolEnd();
    await (globalState.prismaShutdownPromise as Promise<void>);
    await Promise.resolve();

    expect(events).toEqual([
      'prisma.$disconnect',
      'pool.end:start',
      'pool.end:done',
      'exit:143',
    ]);
  });

  it('drains the shared pool and exits when no framework signal listener exists', async () => {
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
      listener: (..._args: unknown[]) => void
    ) => {
      registeredSignals.set(String(event), () => listener(event));
      return process;
    }) as typeof process.once);
    jest.spyOn(process, 'listenerCount').mockReturnValue(0);

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

    sigtermHandler!();
    await Promise.resolve();
    await Promise.resolve();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(events).toEqual(['prisma.$disconnect', 'pool.end:start']);

    resolvePoolEnd();
    await (globalState.prismaShutdownPromise as Promise<void>);
    await Promise.resolve();

    expect(events).toEqual([
      'prisma.$disconnect',
      'pool.end:start',
      'pool.end:done',
      'exit:143',
    ]);
  });

  it('bounds hung pool teardown with a 5000 ms safety timer after process.exit(143)', async () => {
    jest.useFakeTimers();

    const registeredSignals = new Map<string, () => void>();
    const mockDisconnect = jest.fn().mockResolvedValue(undefined);
    const mockPoolEnd = jest.fn().mockImplementation(() => new Promise<void>(() => {}));
    const exitSpy = jest.fn(() => undefined as never);
    process.exit = exitSpy as unknown as typeof process.exit;

    jest.spyOn(process, 'once').mockImplementation(((
      event: string | symbol,
      listener: (..._args: unknown[]) => void
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

    registeredSignals.get('SIGTERM')!();
    process.exit(143);

    await jest.advanceTimersByTimeAsync(4900);
    expect(exitSpy).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(100);
    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(143);
  });
});
