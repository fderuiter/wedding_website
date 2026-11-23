import { Worker } from 'node:worker_threads';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { logger } from '@/lib/logger';
import { ApiError } from '@/utils/ApiError';
import { getFileExtension, isHeicExtension } from './validationPrimitives';
import {
  isHeicBuffer,
  processImageWorkerBuffer,
  type ProcessImageWorkerOptions,
  type WorkerReadyMessage,
  type WorkerResult,
  type WorkerTaskMessage,
} from './imageProcessorWorker';

const DEFAULT_MAX_WORKER_POOL_SIZE = Math.max(
  2,
  Math.min(
    4,
    typeof os.availableParallelism === 'function'
      ? os.availableParallelism()
      : os.cpus().length
  )
);

interface ResolvedWorkerConfig {
  workerPath: string;
  execArgv: string[] | undefined;
}

interface ActiveWorkerTask {
  id: number;
  buffer: Uint8Array;
  options?: ProcessImageWorkerOptions;
  settled: boolean;
  timer: NodeJS.Timeout | null;
  resolve: (_buffer: Uint8Array) => void;
  reject: (_error: ApiError) => void;
}

interface QueuedWorkerTask {
  id: number;
  buffer: Uint8Array;
  timeoutMs: number;
  options?: ProcessImageWorkerOptions;
  resolve: (_buffer: Uint8Array) => void;
  reject: (_error: ApiError) => void;
}

interface PooledWorkerSlot {
  workerId: number;
  worker: Worker;
  ready: boolean;
  dead: boolean;
  heicDecoderLoaded: boolean;
  activeTask: ActiveWorkerTask | null;
}

export interface ImageWorkerPoolStats {
  poolSize: number;
  maxPoolSize: number;
  readyWorkers: number;
  busyWorkers: number;
  queuedTasks: number;
  workerIds: number[];
  heicLoadedWorkerIds: number[];
}

let cachedWorkerConfig: ResolvedWorkerConfig | null = null;
let workerPathOverride: string | null = null;
let workerStartupUnavailable = false;
let maxWorkerPoolSize = DEFAULT_MAX_WORKER_POOL_SIZE;
let nextTaskId = 1;
let nextWorkerId = 1;

const workerPool: PooledWorkerSlot[] = [];
const pendingTaskQueue: QueuedWorkerTask[] = [];

function resolveWorkerPathUncached(): string {
  try {
    if (typeof import.meta.url === 'string' && import.meta.url.startsWith('file:')) {
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const tsPath = path.join(currentDir, 'imageProcessorWorker.ts');
      const jsPath = path.join(currentDir, 'imageProcessorWorker.js');
      const mjsPath = path.join(currentDir, 'imageProcessorWorker.mjs');

      if (fs.existsSync(tsPath)) return tsPath;
      if (fs.existsSync(jsPath)) return jsPath;
      if (fs.existsSync(mjsPath)) return mjsPath;
    }
  } catch {
    // Fall back to workspace path resolution below
  }

  return path.join(process.cwd(), 'src', 'utils', 'imageProcessorWorker.ts');
}

function getWorkerPath(): string {
  if (workerPathOverride) {
    return workerPathOverride;
  }
  if (!cachedWorkerConfig) {
    const workerPath = resolveWorkerPathUncached();
    cachedWorkerConfig = {
      workerPath,
      execArgv: workerPath.endsWith('.ts') ? ['--experimental-strip-types'] : undefined,
    };
  }
  return cachedWorkerConfig.workerPath;
}

function getWorkerConfig(): ResolvedWorkerConfig {
  const workerPath = getWorkerPath();
  if (cachedWorkerConfig && cachedWorkerConfig.workerPath === workerPath) {
    return cachedWorkerConfig;
  }
  return {
    workerPath,
    execArgv: workerPath.endsWith('.ts') ? ['--experimental-strip-types'] : undefined,
  };
}

function isReadyMessage(message: unknown): message is WorkerReadyMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    (message as WorkerReadyMessage).type === 'ready'
  );
}

function clearActiveTaskTimer(task: ActiveWorkerTask | null): void {
  if (task?.timer) {
    clearTimeout(task.timer);
    task.timer = null;
  }
}

function removeSlotFromPool(slot: PooledWorkerSlot): void {
  slot.dead = true;
  const idx = workerPool.indexOf(slot);
  if (idx !== -1) {
    workerPool.splice(idx, 1);
  }
}

function runFallbackInProcess(
  buffer: Uint8Array,
  options: ProcessImageWorkerOptions | undefined,
  resolve: (_value: Uint8Array) => void,
  reject: (_reason: ApiError) => void
): void {
  processImageWorkerBuffer(buffer, options)
    .then(resolve)
    .catch(() => {
      reject(new ApiError(400, 'Image sanitization failed. The file may be corrupt or invalid.'));
    });
}

function postTaskToReadyWorker(slot: PooledWorkerSlot, task: ActiveWorkerTask): void {
  const { buffer } = task;
  const expectHeic = Boolean(task.options?.expectHeic);
  const canTransferDirectly =
    !Buffer.isBuffer(buffer) &&
    buffer.buffer instanceof ArrayBuffer &&
    buffer.byteOffset === 0 &&
    buffer.byteLength === buffer.buffer.byteLength;

  if (canTransferDirectly) {
    try {
      const payload: WorkerTaskMessage = {
        id: task.id,
        buffer,
        expectHeic,
      };
      slot.worker.postMessage(payload, [buffer.buffer]);
      return;
    } catch {
      // Non-transferable external ArrayBuffer: copy into a standalone V8 ArrayBuffer below
    }
  }

  const ownedBuffer = new Uint8Array(buffer);
  const payload: WorkerTaskMessage = {
    id: task.id,
    buffer: ownedBuffer,
    expectHeic,
  };
  slot.worker.postMessage(payload, [ownedBuffer.buffer]);
}

function attachTaskToSlot(slot: PooledWorkerSlot, queued: QueuedWorkerTask): void {
  const activeTask: ActiveWorkerTask = {
    id: queued.id,
    buffer: queued.buffer,
    options: queued.options,
    settled: false,
    timer: null,
    resolve: queued.resolve,
    reject: queued.reject,
  };

  activeTask.timer = setTimeout(() => {
    if (activeTask.settled) return;
    activeTask.settled = true;
    clearActiveTaskTimer(activeTask);
    if (slot.activeTask === activeTask) {
      slot.activeTask = null;
    }
    removeSlotFromPool(slot);
    slot.worker.unref();
    void slot.worker.terminate();
    activeTask.reject(new ApiError(400, 'Image sanitization failed. Worker thread timed out.'));
    drainPendingTasks();
  }, queued.timeoutMs);

  slot.activeTask = activeTask;
  slot.worker.ref();

  if (slot.ready) {
    try {
      postTaskToReadyWorker(slot, activeTask);
    } catch {
      if (!activeTask.settled) {
        activeTask.settled = true;
        clearActiveTaskTimer(activeTask);
        slot.activeTask = null;
        removeSlotFromPool(slot);
        slot.worker.unref();
        void slot.worker.terminate();
        activeTask.reject(new ApiError(400, 'Image sanitization failed. The file may be corrupt or invalid.'));
        drainPendingTasks();
      }
    }
  }
}

function handleStartupFailure(slot: PooledWorkerSlot, err?: unknown): void {
  removeSlotFromPool(slot);
  slot.worker.unref();
  void slot.worker.terminate();

  const errCode =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code)
      : '';
  if (
    errCode === 'ERR_MODULE_NOT_FOUND' ||
    errCode === 'MODULE_NOT_FOUND' ||
    errCode === 'ENOENT'
  ) {
    workerStartupUnavailable = true;
  }

  const pendingTask = slot.activeTask;
  slot.activeTask = null;
  if (pendingTask && !pendingTask.settled) {
    pendingTask.settled = true;
    clearActiveTaskTimer(pendingTask);
    // Input ArrayBuffer was never transferred because worker never signaled readiness
    runFallbackInProcess(pendingTask.buffer, pendingTask.options, pendingTask.resolve, pendingTask.reject);
  }

  drainPendingTasks();
}

function handleRuntimeWorkerFailure(slot: PooledWorkerSlot): void {
  removeSlotFromPool(slot);
  slot.worker.unref();
  void slot.worker.terminate();

  const inFlight = slot.activeTask;
  slot.activeTask = null;
  if (inFlight && !inFlight.settled) {
    inFlight.settled = true;
    clearActiveTaskTimer(inFlight);
    inFlight.reject(new ApiError(400, 'Image sanitization failed. The file may be corrupt or invalid.'));
  }

  drainPendingTasks();
}

function spawnPooledWorkerForTask(initialTask: QueuedWorkerTask): void {
  const { workerPath, execArgv } = getWorkerConfig();
  let worker: Worker;
  try {
    worker = new Worker(workerPath, {
      workerData: { isImageProcessorPoolWorker: true },
      execArgv,
    });
  } catch (err) {
    const errCode = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: unknown }).code) : '';
    if (errCode === 'ERR_MODULE_NOT_FOUND' || errCode === 'ENOENT' || errCode === 'ERR_WORKER_INVALID_EXEC_ARGV') {
      workerStartupUnavailable = true;
    }
    runFallbackInProcess(initialTask.buffer, initialTask.options, initialTask.resolve, initialTask.reject);
    drainPendingTasks();
    return;
  }

  const slot: PooledWorkerSlot = {
    workerId: nextWorkerId++,
    worker,
    ready: false,
    dead: false,
    heicDecoderLoaded: false,
    activeTask: null,
  };

  workerPool.push(slot);
  attachTaskToSlot(slot, initialTask);

  worker.on('message', (message: WorkerResult | WorkerReadyMessage) => {
    if (slot.dead) return;

    if (isReadyMessage(message)) {
      slot.ready = true;
      const waitingTask = slot.activeTask;
      if (waitingTask && !waitingTask.settled) {
        try {
          postTaskToReadyWorker(slot, waitingTask);
        } catch {
          handleRuntimeWorkerFailure(slot);
        }
      } else if (!slot.activeTask) {
        if (pendingTaskQueue.length > 0) {
          const nextQueued = pendingTaskQueue.shift()!;
          attachTaskToSlot(slot, nextQueued);
        } else {
          slot.worker.unref();
        }
      }
      return;
    }

    const result = message as WorkerResult;
    const activeTask = slot.activeTask;
    if (!activeTask || activeTask.settled) {
      return;
    }
    if (result.id !== undefined && result.id !== activeTask.id) {
      return;
    }

    activeTask.settled = true;
    clearActiveTaskTimer(activeTask);
    slot.activeTask = null;

    if (result.success) {
      if (result.heicDecoderLoaded) {
        slot.heicDecoderLoaded = true;
      }
      activeTask.resolve(result.buffer);
    } else {
      activeTask.reject(
        new ApiError(400, 'Image sanitization failed. The file may be corrupt or invalid.')
      );
    }

    if (pendingTaskQueue.length > 0 && !slot.dead) {
      const nextQueued = pendingTaskQueue.shift()!;
      attachTaskToSlot(slot, nextQueued);
    } else if (!slot.dead) {
      slot.worker.unref();
    }
  });

  worker.on('error', (err) => {
    if (slot.dead) return;
    if (!slot.ready) {
      handleStartupFailure(slot, err);
    } else {
      handleRuntimeWorkerFailure(slot);
    }
  });

  worker.on('exit', (code) => {
    if (slot.dead) return;
    if (!slot.ready) {
      handleStartupFailure(slot);
    } else if (code !== 0 || slot.activeTask) {
      handleRuntimeWorkerFailure(slot);
    } else {
      removeSlotFromPool(slot);
    }
  });
}

function drainPendingTasks(): void {
  while (pendingTaskQueue.length > 0) {
    if (workerStartupUnavailable) {
      const task = pendingTaskQueue.shift()!;
      runFallbackInProcess(task.buffer, task.options, task.resolve, task.reject);
      continue;
    }

    const idleReadySlot = workerPool.find(
      (slot) => !slot.dead && slot.ready && slot.activeTask === null
    );
    if (idleReadySlot) {
      const task = pendingTaskQueue.shift()!;
      attachTaskToSlot(idleReadySlot, task);
      continue;
    }

    if (workerPool.length < maxWorkerPoolSize) {
      const task = pendingTaskQueue.shift()!;
      spawnPooledWorkerForTask(task);
      continue;
    }

    break;
  }
}

export function getImageWorkerPoolStats(): ImageWorkerPoolStats {
  return {
    poolSize: workerPool.length,
    maxPoolSize: maxWorkerPoolSize,
    readyWorkers: workerPool.filter((s) => !s.dead && s.ready).length,
    busyWorkers: workerPool.filter((s) => !s.dead && s.activeTask !== null).length,
    queuedTasks: pendingTaskQueue.length,
    workerIds: workerPool.map((s) => s.workerId),
    heicLoadedWorkerIds: workerPool.filter((s) => s.heicDecoderLoaded).map((s) => s.workerId),
  };
}

export async function resetImageWorkerPool(options?: {
  workerPathOverride?: string | null;
  maxPoolSize?: number;
}): Promise<void> {
  const slotsToTerminate = workerPool.splice(0, workerPool.length);
  for (const slot of slotsToTerminate) {
    slot.dead = true;
    if (slot.activeTask && !slot.activeTask.settled) {
      slot.activeTask.settled = true;
      clearActiveTaskTimer(slot.activeTask);
      slot.activeTask.reject(
        new ApiError(400, 'Image sanitization failed. The file may be corrupt or invalid.')
      );
    }
    slot.activeTask = null;
    slot.worker.unref();
  }

  while (pendingTaskQueue.length > 0) {
    const task = pendingTaskQueue.shift()!;
    task.reject(new ApiError(400, 'Image sanitization failed. The file may be corrupt or invalid.'));
  }

  workerStartupUnavailable = false;
  if (options && 'workerPathOverride' in options) {
    workerPathOverride = options.workerPathOverride ?? null;
  } else {
    workerPathOverride = null;
  }
  maxWorkerPoolSize = options?.maxPoolSize ?? DEFAULT_MAX_WORKER_POOL_SIZE;

  await Promise.allSettled(slotsToTerminate.map((slot) => slot.worker.terminate()));
}

export function offloadSanitizeToWorker(
  buffer: Uint8Array,
  timeoutMs = 10000,
  options?: ProcessImageWorkerOptions
): Promise<Uint8Array> {
  if (workerStartupUnavailable) {
    return new Promise((resolve, reject) => {
      runFallbackInProcess(buffer, options, resolve, reject);
    });
  }

  return new Promise((resolve, reject) => {
    pendingTaskQueue.push({
      id: nextTaskId++,
      buffer,
      timeoutMs,
      options,
      resolve,
      reject,
    });
    drainPendingTasks();
  });
}

function isHeicMimeType(mime: string): boolean {
  return (
    mime === 'image/heic' ||
    mime === 'image/heif' ||
    mime === 'image/heic-sequence' ||
    mime === 'image/heif-sequence'
  );
}

function toNormalizedJpegFilename(filename: string): string {
  const trimmed = (filename || '').trim();
  if (!trimmed) {
    return 'guest-photo.jpg';
  }
  const replaced = trimmed.replace(/\.(heic|heif)$/i, '.jpg');
  if (replaced !== trimmed) {
    return replaced;
  }
  const lastDot = replaced.lastIndexOf('.');
  if (lastDot > 0) {
    return `${replaced.slice(0, lastDot)}.jpg`;
  }
  return `${replaced}.jpg`;
}

/**
 * Sanitizes image files by auto-rotating them based on their EXIF orientation tag,
 * stripping all sensitive EXIF metadata (GPS, camera model, timestamps, etc.),
 * preserving JPEG/PNG/WebP formats, and transcoding HEIC/HEIF uploads into
 * browser-compatible JPEG files.
 * Offloads Sharp and HEIC decoding to a Node.js worker thread.
 * Skips sanitization for non-Sharp image formats (such as ICO).
 * Throws an error if sanitization fails for supported formats.
 */
export async function sanitizeImage(file: File): Promise<File> {
  const fileType = file.type;
  const normalizedMime = (fileType || '').toLowerCase();
  const ext = getFileExtension(file.name);
  const isHeicInput = isHeicMimeType(normalizedMime) || isHeicExtension(ext);
  const isStandardRaster =
    normalizedMime === 'image/jpeg' ||
    normalizedMime === 'image/jpg' ||
    normalizedMime === 'image/png' ||
    normalizedMime === 'image/webp';

  // Only process standard JPEG, PNG, WebP, and HEIC/HEIF files.
  // Skip unsupported formats like ICO.
  if (!isStandardRaster && !isHeicInput) {
    logger.debug(`Skipping sanitization for non-supported format: ${fileType}`);
    return file;
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);
    const transcodeToJpeg = isHeicInput || isHeicBuffer(buffer);

    const sanitizedBuffer = await offloadSanitizeToWorker(buffer, 10000, {
      expectHeic: isHeicInput,
    });

    const outputBuffer: Buffer<ArrayBuffer> =
      sanitizedBuffer.buffer instanceof ArrayBuffer
        ? Buffer.from(
          sanitizedBuffer.buffer,
          sanitizedBuffer.byteOffset,
          sanitizedBuffer.byteLength
        )
        : Buffer.from(sanitizedBuffer);

    if (transcodeToJpeg) {
      const normalizedFilename = toNormalizedJpegFilename(file.name);
      logger.info(`Successfully transcoded and sanitized HEIC/HEIF image to image/jpeg (${normalizedFilename})`);
      return new File([outputBuffer], normalizedFilename, { type: 'image/jpeg' });
    }

    logger.info(`Successfully sanitized image of type ${fileType}`);
    return new File([outputBuffer], file.name, { type: fileType });
  } catch (error) {
    logger.error('Failed to sanitize image:', error);
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(400, 'Image sanitization failed. The file may be corrupt or invalid.');
  }
}
