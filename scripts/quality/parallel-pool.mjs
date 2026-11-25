import { spawn } from 'node:child_process';
import os from 'node:os';

export const DEFAULT_POOL_CONCURRENCY = Math.max(
  2,
  Math.min(6, typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length)
);

/**
 * Resolves bounded worker-pool concurrency for a task queue.
 *
 * @param {object} options
 * @param {number} [options.explicitConcurrency]
 * @param {string} [options.envValue]
 * @param {number} options.taskCount
 * @param {number} [options.defaultConcurrency]
 * @returns {number}
 */
export function resolvePoolConcurrency({
  explicitConcurrency,
  envValue,
  taskCount,
  defaultConcurrency = DEFAULT_POOL_CONCURRENCY,
}) {
  if (taskCount <= 0) {
    return 1;
  }
  const parsedEnv = Number.parseInt(envValue ?? '', 10);
  const candidate =
    typeof explicitConcurrency === 'number' && explicitConcurrency > 0
      ? explicitConcurrency
      : Number.isFinite(parsedEnv) && parsedEnv > 0
        ? parsedEnv
        : defaultConcurrency;
  return Math.max(1, Math.min(taskCount, candidate));
}

/**
 * Sends SIGTERM to a spawned child process group (POSIX) or child process.
 *
 * @param {import('node:child_process').ChildProcess} child
 */
export function terminateChildTree(child) {
  if (child.pid && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGTERM');
      return;
    } catch {
      // Fall back to direct child signal if process group already exited
    }
  }
  try {
    child.kill('SIGTERM');
  } catch {
    // Ignore already-exited child processes
  }
}

/**
 * Spawns a command with buffered stdout/stderr and AbortSignal process-tree cancellation.
 *
 * @param {object} options
 * @param {string} options.command
 * @param {string[]} [options.args]
 * @param {string} options.cwd
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {AbortSignal} options.signal
 * @param {boolean} [options.shell]
 * @returns {Promise<{ status: number, stdout: string, stderr: string, aborted: boolean }>}
 */
export function spawnBufferedCommand({
  command,
  args,
  cwd,
  env = process.env,
  signal,
  shell = true,
}) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      resolve({ status: 0, stdout: '', stderr: '', aborted: true });
      return;
    }

    /** @type {Buffer[]} */
    const stdoutChunks = [];
    /** @type {Buffer[]} */
    const stderrChunks = [];
    let settled = false;

    const spawnOpts = {
      cwd,
      env,
      shell,
      detached: process.platform !== 'win32',
      stdio: /** @type {['ignore', 'pipe', 'pipe']} */ (['ignore', 'pipe', 'pipe']),
    };
    const child = args ? spawn(command, args, spawnOpts) : spawn(command, spawnOpts);

    const onAbort = () => {
      terminateChildTree(child);
    };
    signal.addEventListener('abort', onAbort, { once: true });

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
    }

    child.on('error', (err) => {
      signal.removeEventListener('abort', onAbort);
      if (settled) {
        return;
      }
      settled = true;
      reject(
        Object.assign(new Error(err.message), {
          status: 1,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
        })
      );
    });

    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort);
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        status: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        aborted: signal.aborted,
      });
    });
  });
}

/**
 * Executes items across a bounded worker pool with fail-fast AbortSignal cancellation.
 *
 * @template TItem
 * @template TResult
 * @param {object} options
 * @param {TItem[]} options.items
 * @param {number} options.concurrency
 * @param {(item: TItem, index: number, signal: AbortSignal) => Promise<TResult>} options.runItem
 * @param {(item: TItem, result: TResult, index: number) => void} [options.onSuccess]
 * @returns {Promise<{ failed: null | { item: TItem, index: number, error: unknown } }>}
 */
export async function runBoundedPool({ items, concurrency, runItem, onSuccess }) {
  if (items.length === 0) {
    return { failed: null };
  }

  const workerCount = Math.max(1, Math.min(items.length, concurrency));
  const abortController = new AbortController();
  let nextIndex = 0;
  /** @type {null | { item: TItem, index: number, error: unknown }} */
  let firstFailure = null;

  const workers = Array.from({ length: workerCount }, async () => {
    while (!abortController.signal.aborted) {
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) {
        return;
      }

      const item = items[currentIndex];
      try {
        const result = await runItem(item, currentIndex, abortController.signal);
        if (abortController.signal.aborted) {
          return;
        }
        if (onSuccess) {
          onSuccess(item, result, currentIndex);
        }
      } catch (error) {
        if (firstFailure === null) {
          firstFailure = { item, index: currentIndex, error };
          abortController.abort();
        }
        return;
      }
    }
  });

  await Promise.allSettled(workers);
  return { failed: firstFailure };
}
