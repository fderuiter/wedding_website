import { Readable } from 'node:stream';

export const REMOTE_EXPORT_TIMEOUT_MS = 15_000;
export const MAX_REMOTE_EXPORT_BYTES = 25 * 1024 * 1024;
const DEFAULT_STREAM_HIGH_WATER_MARK = 64 * 1024;

export class BoundedStreamOverflowError extends Error {
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(`Response body exceeded maximum size of ${maxBytes} bytes`);
    this.name = 'BoundedStreamOverflowError';
    this.maxBytes = maxBytes;
  }
}

interface LinkedAbortScope {
  readonly controller: AbortController;
  readonly didTimeout: () => boolean;
  readonly cleanup: () => void;
}

export function createLinkedAbortScope(options: {
  timeoutMs: number;
  externalSignal?: AbortSignal;
}): LinkedAbortScope {
  const { timeoutMs, externalSignal } = options;
  const controller = new AbortController();
  let timedOut = false;
  let cleanedUp = false;

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  };

  function onExternalAbort() {
    cleanup();
    if (!controller.signal.aborted) {
      controller.abort();
    }
  }

  if (externalSignal) {
    if (externalSignal.aborted) {
      cleanup();
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  return {
    controller,
    didTimeout: () => timedOut,
    cleanup,
  };
}

function createAbortError(): Error {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

export function parseExceededContentLength(
  headers: Headers | undefined,
  maxBytes: number
): number | null {
  if (!headers || typeof headers.get !== 'function') {
    return null;
  }
  const raw = headers.get('content-length');
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const declared = Number(trimmed);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return declared;
  }
  return null;
}

async function readChunkWithSignal(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!signal) {
    return reader.read();
  }
  if (signal.aborted) {
    throw createAbortError();
  }

  let onAbort: (() => void) | null = null;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(createAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

  try {
    return await Promise.race([reader.read(), abortPromise]);
  } finally {
    if (onAbort) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

/**
 * Reads an HTTP Response body as UTF-8 text while enforcing a strict byte ceiling
 * and keeping the provided AbortSignal active until stream completion.
 */
export async function readBoundedResponseText(
  response: Response,
  options: {
    maxBytes: number;
    signal?: AbortSignal;
    onOverflow?: () => void;
  }
): Promise<string> {
  const { maxBytes, signal, onOverflow } = options;

  if (signal?.aborted) {
    await response.body?.cancel().catch(() => undefined);
    throw createAbortError();
  }

  if (parseExceededContentLength(response.headers, maxBytes) !== null) {
    onOverflow?.();
    await response.body?.cancel().catch(() => undefined);
    throw new BoundedStreamOverflowError(maxBytes);
  }

  if (!response.body) {
    if (response.body === null) {
      return '';
    }
    const fallbackText = await response.text();
    if (Buffer.byteLength(fallbackText, 'utf8') > maxBytes) {
      onOverflow?.();
      throw new BoundedStreamOverflowError(maxBytes);
    }
    return fallbackText;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await readChunkWithSignal(reader, signal);
      if (done) {
        break;
      }
      if (!value || value.byteLength === 0) {
        continue;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        onOverflow?.();
        await reader.cancel().catch(() => undefined);
        throw new BoundedStreamOverflowError(maxBytes);
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    throw err;
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes).toString('utf8');
}

/**
 * Wraps a Web ReadableStream<Uint8Array> into a demand-driven Node Readable stream
 * enforcing a strict byte ceiling and active AbortSignal through stream completion.
 */
export function createBoundedBodyReadable(
  body: ReadableStream<Uint8Array>,
  options: {
    maxBytes: number;
    signal?: AbortSignal;
    parentSignal?: AbortSignal;
    highWaterMark?: number;
    onLimitOrTimeout?: (err: Error) => void;
    onFinalize?: () => void;
  }
): Readable {
  const {
    maxBytes,
    signal,
    parentSignal,
    highWaterMark = DEFAULT_STREAM_HIGH_WATER_MARK,
    onLimitOrTimeout,
    onFinalize,
  } = options;

  const reader = body.getReader();
  let totalBytes = 0;
  let reading = false;
  let settled = false;

  const finalizeOnce = () => {
    if (settled) {
      return;
    }
    settled = true;
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
    onFinalize?.();
  };

  const cancelReaderSilently = async () => {
    try {
      await reader.cancel();
    } catch {
      // Ignore cancel teardown errors
    }
    try {
      reader.releaseLock();
    } catch {
      // Ignore already-released lock
    }
  };

  const readable = new Readable({
    highWaterMark,
    read() {
      if (reading || settled) {
        return;
      }
      reading = true;

      void (async () => {
        try {
          while (!settled) {
            if (parentSignal?.aborted) {
              finalizeOnce();
              await cancelReaderSilently();
              this.destroy();
              return;
            }

            const { done, value } = await readChunkWithSignal(reader, signal);
            if (done) {
              finalizeOnce();
              try {
                reader.releaseLock();
              } catch {
                // Ignore
              }
              this.push(null);
              return;
            }

            if (!value || value.byteLength === 0) {
              continue;
            }

            totalBytes += value.byteLength;
            if (totalBytes > maxBytes) {
              const overflowErr = new BoundedStreamOverflowError(maxBytes);
              onLimitOrTimeout?.(overflowErr);
              finalizeOnce();
              await cancelReaderSilently();
              this.push(null);
              return;
            }

            const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
            const canContinue = this.push(chunk);
            if (!canContinue) {
              break;
            }
          }
        } catch (err) {
          const normalizedErr = err instanceof Error ? err : new Error(String(err));
          if (!parentSignal?.aborted) {
            onLimitOrTimeout?.(normalizedErr);
          }
          finalizeOnce();
          await cancelReaderSilently();
          if (parentSignal?.aborted) {
            this.destroy();
          } else {
            this.push(null);
          }
        } finally {
          reading = false;
        }
      })();
    },
    destroy(err, callback) {
      finalizeOnce();
      void cancelReaderSilently().finally(() => {
        callback(err);
      });
    },
  });

  function onParentAbort() {
    finalizeOnce();
    void cancelReaderSilently();
    readable.destroy();
  }

  if (parentSignal) {
    if (parentSignal.aborted) {
      onParentAbort();
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  return readable;
}

type BoundedRemoteResponseResult =
  | { status: 'cancelled' }
  | { status: 'http-error'; httpStatus: number }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | { status: 'stream'; stream: Readable };

/**
 * Opens an outbound HTTP/HTTPS response with a linked timeout/abort scope that stays active
 * until the returned Node Readable finishes draining or aborts on byte/timeout limits.
 */
export async function openBoundedRemoteResponse(
  fetchResponse: (signal: AbortSignal) => Promise<Response>,
  options: {
    maxBytes?: number;
    timeoutMs?: number;
    parentSignal?: AbortSignal;
    isCancelled?: () => boolean;
    onMidStreamError?: (detail: string) => void;
  } = {}
): Promise<BoundedRemoteResponseResult> {
  const {
    maxBytes = MAX_REMOTE_EXPORT_BYTES,
    timeoutMs = REMOTE_EXPORT_TIMEOUT_MS,
    parentSignal,
    isCancelled = () => Boolean(parentSignal?.aborted),
    onMidStreamError,
  } = options;

  const scope = createLinkedAbortScope({
    timeoutMs,
    externalSignal: parentSignal,
  });
  let handedOffToStream = false;

  try {
    const res = await fetchResponse(scope.controller.signal);
    if (isCancelled()) {
      await res.body?.cancel().catch(() => undefined);
      return { status: 'cancelled' };
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { status: 'http-error', httpStatus: res.status };
    }
    if (parseExceededContentLength(res.headers, maxBytes) !== null) {
      scope.controller.abort();
      await res.body?.cancel().catch(() => undefined);
      return {
        status: 'error',
        message: `Response body exceeded maximum size of ${maxBytes} bytes`,
      };
    }
    if (!res.body) {
      return { status: 'empty' };
    }

    const stream = createBoundedBodyReadable(res.body, {
      maxBytes,
      signal: scope.controller.signal,
      parentSignal,
      onLimitOrTimeout: (streamErr) => {
        scope.controller.abort();
        const detail = scope.didTimeout()
          ? `Remote transfer timed out after ${timeoutMs}ms`
          : streamErr.message;
        onMidStreamError?.(detail);
      },
      onFinalize: () => {
        scope.cleanup();
      },
    });
    handedOffToStream = true;
    return { status: 'stream', stream };
  } catch (err: unknown) {
    if (isCancelled()) {
      return { status: 'cancelled' };
    }
    const message = scope.didTimeout()
      ? `Remote transfer timed out after ${timeoutMs}ms`
      : err instanceof Error
        ? err.message
        : String(err);
    return { status: 'error', message };
  } finally {
    if (!handedOffToStream) {
      scope.cleanup();
    }
  }
}

/**
 * Wraps an existing Web ReadableStream (such as an object-storage stream) with a linked
 * timeout/cancellation scope and byte cap, returning a demand-driven Node Readable.
 */
export function openBoundedReadableStream(
  stream: ReadableStream<Uint8Array>,
  options: {
    maxBytes?: number;
    timeoutMs?: number;
    parentSignal?: AbortSignal;
    onMidStreamError?: (detail: string) => void;
  } = {}
): Readable {
  const {
    maxBytes = MAX_REMOTE_EXPORT_BYTES,
    timeoutMs = REMOTE_EXPORT_TIMEOUT_MS,
    parentSignal,
    onMidStreamError,
  } = options;

  const scope = createLinkedAbortScope({
    timeoutMs,
    externalSignal: parentSignal,
  });

  return createBoundedBodyReadable(stream, {
    maxBytes,
    signal: scope.controller.signal,
    parentSignal,
    onLimitOrTimeout: (streamErr) => {
      scope.controller.abort();
      const detail = scope.didTimeout()
        ? `Remote transfer timed out after ${timeoutMs}ms`
        : streamErr.message;
      onMidStreamError?.(detail);
    },
    onFinalize: () => {
      scope.cleanup();
    },
  });
}
