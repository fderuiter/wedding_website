/**
 * @jest-environment node
 */
import { spawn } from 'node:child_process';
import {
  DEFAULT_POOL_CONCURRENCY,
  resolvePoolConcurrency,
  runBoundedPool,
  spawnBufferedCommand,
  terminateChildTree,
} from './parallel-pool.mjs';

describe('scripts/quality/parallel-pool.mjs', () => {
  it('resolves bounded pool concurrency from explicit options, env overrides, and task counts', () => {
    expect(DEFAULT_POOL_CONCURRENCY).toBeGreaterThanOrEqual(2);
    expect(DEFAULT_POOL_CONCURRENCY).toBeLessThanOrEqual(6);

    expect(resolvePoolConcurrency({ taskCount: 0 })).toBe(1);
    expect(resolvePoolConcurrency({ explicitConcurrency: 4, taskCount: 2 })).toBe(2);
    expect(resolvePoolConcurrency({ explicitConcurrency: 3, envValue: '5', taskCount: 10 })).toBe(3);
    expect(resolvePoolConcurrency({ envValue: '5', taskCount: 10 })).toBe(5);
    expect(
      resolvePoolConcurrency({ envValue: 'invalid', taskCount: 10, defaultConcurrency: 4 })
    ).toBe(4);
  });

  it('caps active workers in runBoundedPool and aborts in-flight/queued items on first error', async () => {
    let active = 0;
    let maxActive = 0;
    const completed: string[] = [];

    const passRes = await runBoundedPool({
      items: ['a', 'b', 'c', 'd', 'e'],
      concurrency: 2,
      runItem: async (item) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active--;
        return item.toUpperCase();
      },
      onSuccess: (_item, result) => {
        completed.push(result);
      },
    });

    expect(passRes.failed).toBeNull();
    expect(maxActive).toBe(2);
    expect(completed.slice().sort()).toEqual(['A', 'B', 'C', 'D', 'E']);

    const started: string[] = [];
    let slowAborted = false;

    const failRes = await runBoundedPool({
      items: ['slow', 'fail', 'queued'],
      concurrency: 2,
      runItem: (item, _idx, signal) =>
        new Promise((resolve, reject) => {
          started.push(item);
          if (item === 'slow') {
            const timer = setTimeout(() => resolve('done'), 5000);
            signal.addEventListener(
              'abort',
              () => {
                slowAborted = true;
                clearTimeout(timer);
                reject(new Error('Aborted'));
              },
              { once: true }
            );
            return;
          }
          if (item === 'fail') {
            setTimeout(() => reject(new Error('boom')), 10);
            return;
          }
          resolve('ok');
        }),
    });

    expect(slowAborted).toBe(true);
    expect(started).toEqual(['slow', 'fail']);
    expect(failRes.failed?.item).toBe('fail');
  });

  it('buffers stdout/stderr in spawnBufferedCommand and terminates child process trees on abort', async () => {
    const controller = new AbortController();
    const ok = await spawnBufferedCommand({
      command: process.execPath,
      args: ['-e', 'console.log("out-line"); console.error("err-line");'],
      cwd: process.cwd(),
      signal: controller.signal,
      shell: false,
    });
    expect(ok.status).toBe(0);
    expect(ok.aborted).toBe(false);
    expect(ok.stdout.trim()).toBe('out-line');
    expect(ok.stderr.trim()).toBe('err-line');

    const abortCtrl = new AbortController();
    const start = Date.now();
    setTimeout(() => abortCtrl.abort(), 40);
    const aborted = await spawnBufferedCommand({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 5000)'],
      cwd: process.cwd(),
      signal: abortCtrl.signal,
      shell: false,
    });
    expect(Date.now() - start).toBeLessThan(3000);
    expect(aborted.aborted).toBe(true);

    // Direct terminateChildTree call on an already-exited child is a safe no-op
    const shortChild = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
    await new Promise((resolve) => shortChild.on('close', resolve));
    expect(() => terminateChildTree(shortChild)).not.toThrow();
  });
});
