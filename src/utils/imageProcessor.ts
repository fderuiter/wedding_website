import { Worker, type ResourceLimits } from 'node:worker_threads';
import os from 'node:os';
import path from 'node:path';
import { logger } from '@/lib/logger';
import { ApiError } from '@/utils/ApiError';
import {
  getFileExtension,
  isHeicExtension,
  MAX_GUEST_PHOTO_SIZE,
} from './validationPrimitives';
import {
  isHeicBuffer,
  isIcoBuffer,
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

export const MAX_CONCURRENT_HEIC_WORKERS = 2;

export const WORKER_RESOURCE_LIMITS: Readonly<ResourceLimits> = Object.freeze({
  maxOldGenerationSizeMb: 256,
  maxYoungGenerationSizeMb: 64,
});

interface ActiveWorkerTask {
  id: number;
  buffer: Uint8Array;
  isHeic: boolean;
  options?: ProcessImageWorkerOptions;
  settled: boolean;
  timer: NodeJS.Timeout | null;
  resolve: (_buffer: Uint8Array) => void;
  reject: (_error: ApiError) => void;
}

interface QueuedWorkerTask {
  id: number;
  buffer: Uint8Array;
  isHeic: boolean;
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
  activeHeicWorkers: number;
  queuedTasks: number;
  workerIds: number[];
  heicLoadedWorkerIds: number[];
}

let workerPathOverride: string | null = null;
let maxWorkerPoolSize = DEFAULT_MAX_WORKER_POOL_SIZE;
let nextTaskId = 1;
let nextWorkerId = 1;

const workerPool: PooledWorkerSlot[] = [];
const pendingTaskQueue: QueuedWorkerTask[] = [];

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

function postTaskToReadyWorker(slot: PooledWorkerSlot, task: ActiveWorkerTask): void {
  const { buffer } = task;
  const expectHeic = Boolean(task.options?.expectHeic);
  const expectIco = Boolean(task.options?.expectIco);
  const maxBytes = task.options?.maxBytes ?? MAX_GUEST_PHOTO_SIZE;
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
        expectIco,
        maxBytes,
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
    expectIco,
    maxBytes,
  };
  slot.worker.postMessage(payload, [ownedBuffer.buffer]);
}

function failAndEvictWorkerSlot(slot: PooledWorkerSlot): void {
  removeSlotFromPool(slot);
  slot.worker.unref();
  void slot.worker.terminate();

  const inFlight = slot.activeTask;
  slot.activeTask = null;
  if (inFlight && !inFlight.settled) {
    inFlight.settled = true;
    clearActiveTaskTimer(inFlight);
    inFlight.reject(
      new ApiError(400, 'Image sanitization failed. The file may be corrupt or invalid.')
    );
  }

  drainPendingTasks();
}

function attachTaskToSlot(slot: PooledWorkerSlot, queued: QueuedWorkerTask): void {
  const activeTask: ActiveWorkerTask = {
    id: queued.id,
    buffer: queued.buffer,
    isHeic: queued.isHeic,
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
    logger.error(`Image processor worker timed out after ${queued.timeoutMs}ms`);
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
    } catch (err) {
      logger.error('Failed to dispatch task to image processor worker:', err);
      failAndEvictWorkerSlot(slot);
    }
  }
}

function spawnPooledWorkerForTask(initialTask: QueuedWorkerTask): void {
  let worker: Worker;
  try {
    if (process.env.NODE_ENV === 'test') {
      const testWorkerPath = workerPathOverride
        ?? path.resolve(process.cwd(), 'src', 'utils', 'imageProcessorWorker.ts');
      worker = new Worker(/* turbopackIgnore: true */ testWorkerPath, {
        workerData: { isImageProcessorPoolWorker: true },
        resourceLimits: { ...WORKER_RESOURCE_LIMITS },
        execArgv: testWorkerPath.endsWith('.ts') ? ['--experimental-strip-types'] : undefined,
      });
    } else {
      worker = new Worker(new URL('./imageProcessorWorker.ts', import.meta.url), {
        workerData: { isImageProcessorPoolWorker: true },
        resourceLimits: { ...WORKER_RESOURCE_LIMITS },
      });
    }
  } catch (err) {
    logger.error('Failed to initialize image processor worker:', err);
    initialTask.reject(
      new ApiError(400, 'Image sanitization failed. The file may be corrupt or invalid.')
    );
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
        } catch (err) {
          logger.error('Failed to dispatch task to image processor worker:', err);
          failAndEvictWorkerSlot(slot);
        }
      } else if (!slot.activeTask) {
        drainPendingTasks();
        if (!slot.dead && slot.activeTask === null) {
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
      logger.error('Image processor worker failed to sanitize image:', result.error);
      activeTask.reject(
        new ApiError(400, 'Image sanitization failed. The file may be corrupt or invalid.')
      );
    }

    drainPendingTasks();
    if (!slot.dead && slot.activeTask === null) {
      slot.worker.unref();
    }
  });

  worker.on('error', (err) => {
    if (slot.dead) return;
    logger.error('Image processor worker emitted an error:', err);
    failAndEvictWorkerSlot(slot);
  });

  worker.on('exit', (code) => {
    if (slot.dead) return;
    if (!slot.ready || code !== 0 || slot.activeTask) {
      logger.error(`Image processor worker exited unexpectedly with code ${code}`);
      failAndEvictWorkerSlot(slot);
    } else {
      removeSlotFromPool(slot);
      drainPendingTasks();
    }
  });
}

function countActiveHeicWorkers(): number {
  return workerPool.filter(
    (slot) => !slot.dead && slot.activeTask !== null && slot.activeTask.isHeic
  ).length;
}

function drainPendingTasks(): void {
  const maxHeicWorkers = Math.min(MAX_CONCURRENT_HEIC_WORKERS, maxWorkerPoolSize);

  while (pendingTaskQueue.length > 0) {
    const activeHeicWorkers = countActiveHeicWorkers();
    const nextTaskIndex = pendingTaskQueue.findIndex(
      (task) => !task.isHeic || activeHeicWorkers < maxHeicWorkers
    );
    if (nextTaskIndex === -1) {
      break;
    }

    const candidateTask = pendingTaskQueue[nextTaskIndex];
    const idleReadySlot = candidateTask.isHeic
      ? workerPool.find(
        (slot) =>
          !slot.dead && slot.ready && slot.activeTask === null && slot.heicDecoderLoaded
      ) ??
        workerPool.find((slot) => !slot.dead && slot.ready && slot.activeTask === null)
      : workerPool.find((slot) => !slot.dead && slot.ready && slot.activeTask === null);

    if (idleReadySlot) {
      const [task] = pendingTaskQueue.splice(nextTaskIndex, 1);
      attachTaskToSlot(idleReadySlot, task);
      continue;
    }

    if (workerPool.length < maxWorkerPoolSize) {
      const [task] = pendingTaskQueue.splice(nextTaskIndex, 1);
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
    activeHeicWorkers: countActiveHeicWorkers(),
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
  const maxBytes = options?.maxBytes ?? MAX_GUEST_PHOTO_SIZE;
  if (buffer.byteLength > maxBytes) {
    logger.error(
      `Image buffer size (${buffer.byteLength} bytes) exceeds maximum allowed limit (${maxBytes} bytes)`
    );
    return Promise.reject(
      new ApiError(400, 'Image sanitization failed. File size exceeds maximum allowed limit.')
    );
  }

  const isHeic = Boolean(options?.expectHeic) || isHeicBuffer(buffer);

  return new Promise((resolve, reject) => {
    pendingTaskQueue.push({
      id: nextTaskId++,
      buffer,
      isHeic,
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

function isIcoMimeType(mime: string): boolean {
  return mime === 'image/x-icon' || mime === 'image/vnd.microsoft.icon';
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

function toNormalizedPngFilename(filename: string): string {
  const trimmed = (filename || '').trim();
  if (!trimmed) {
    return 'favicon.png';
  }
  const replaced = trimmed.replace(/\.ico$/i, '.png');
  if (replaced !== trimmed) {
    return replaced;
  }
  const lastDot = replaced.lastIndexOf('.');
  if (lastDot > 0) {
    return `${replaced.slice(0, lastDot)}.png`;
  }
  return `${replaced}.png`;
}

/**
 * Sanitizes image files by auto-rotating them based on their EXIF orientation tag,
 * stripping all sensitive EXIF metadata (GPS, camera model, timestamps, etc.),
 * preserving JPEG/PNG/WebP formats, transcoding HEIC/HEIF uploads into
 * browser-compatible JPEG files, and transcoding ICO uploads into sanitized PNG files.
 * Offloads Sharp, HEIC, and ICO decoding to a Node.js worker thread.
 * Rejects unsupported or corrupt formats with an HTTP 400 ApiError.
 */
export async function sanitizeImage(file: File): Promise<File> {
  const fileType = file.type;
  const normalizedMime = (fileType || '').toLowerCase();
  const ext = getFileExtension(file.name);
  const isHeicInput = isHeicMimeType(normalizedMime) || isHeicExtension(ext);
  const isIcoInput =
    isIcoMimeType(normalizedMime) ||
    (ext === '.ico' && (normalizedMime === '' || isIcoMimeType(normalizedMime)));
  const isStandardRaster =
    normalizedMime === 'image/jpeg' ||
    normalizedMime === 'image/jpg' ||
    normalizedMime === 'image/png' ||
    normalizedMime === 'image/webp';

  if (!isStandardRaster && !isHeicInput && !isIcoInput) {
    logger.error(`Rejected unsupported image format during sanitization: ${fileType || ext || 'unknown'}`);
    throw new ApiError(400, 'Image sanitization failed. Unsupported image format.');
  }

  try {
    if (typeof file.size === 'number' && file.size > MAX_GUEST_PHOTO_SIZE) {
      throw new ApiError(400, 'Image sanitization failed. File size exceeds maximum allowed limit.');
    }

    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_GUEST_PHOTO_SIZE) {
      throw new ApiError(400, 'Image sanitization failed. File size exceeds maximum allowed limit.');
    }

    const buffer = new Uint8Array(arrayBuffer);
    if (!isIcoInput && isIcoBuffer(buffer)) {
      throw new ApiError(400, 'Image sanitization failed. The file may be corrupt or invalid.');
    }

    const transcodeToJpeg = !isIcoInput && (isHeicInput || isHeicBuffer(buffer));

    const sanitizedBuffer = await offloadSanitizeToWorker(buffer, 10000, {
      expectHeic: isHeicInput,
      expectIco: isIcoInput,
      maxBytes: MAX_GUEST_PHOTO_SIZE,
    });

    const outputBuffer: Buffer<ArrayBuffer> =
      sanitizedBuffer.buffer instanceof ArrayBuffer
        ? Buffer.from(
          sanitizedBuffer.buffer,
          sanitizedBuffer.byteOffset,
          sanitizedBuffer.byteLength
        )
        : Buffer.from(sanitizedBuffer);

    if (isIcoInput) {
      const normalizedFilename = toNormalizedPngFilename(file.name);
      logger.info(`Successfully transcoded and sanitized ICO image to image/png (${normalizedFilename})`);
      return new File([outputBuffer], normalizedFilename, { type: 'image/png' });
    }

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
