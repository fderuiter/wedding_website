/** @jest-environment node */

import { Readable } from 'node:stream';
import {
  BoundedStreamOverflowError,
  createBoundedBodyReadable,
  createLinkedAbortScope,
  MAX_REMOTE_EXPORT_BYTES,
  openBoundedReadableStream,
  openBoundedRemoteResponse,
  parseExceededContentLength,
  readBoundedResponseText,
  REMOTE_EXPORT_TIMEOUT_MS,
} from '../boundedStream';

async function collectNodeReadable(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

describe('boundedStream utilities', () => {
  it('exposes expected remote export byte and timeout constants', () => {
    expect(REMOTE_EXPORT_TIMEOUT_MS).toBe(15_000);
    expect(MAX_REMOTE_EXPORT_BYTES).toBe(25 * 1024 * 1024);
  });

  describe('parseExceededContentLength', () => {
    it('returns the declared byte count only when valid decimal Content-Length exceeds maxBytes', () => {
      expect(parseExceededContentLength(undefined, 100)).toBeNull();
      expect(parseExceededContentLength(new Headers(), 100)).toBeNull();
      expect(parseExceededContentLength(new Headers({ 'content-length': '100' }), 100)).toBeNull();
      expect(parseExceededContentLength(new Headers({ 'content-length': 'abc' }), 100)).toBeNull();
      expect(parseExceededContentLength(new Headers({ 'content-length': '101' }), 100)).toBe(101);
    });
  });

  describe('createLinkedAbortScope', () => {
    it('aborts and marks didTimeout=true when timeout elapses', async () => {
      const scope = createLinkedAbortScope({ timeoutMs: 20 });
      expect(scope.didTimeout()).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 45));
      expect(scope.controller.signal.aborted).toBe(true);
      expect(scope.didTimeout()).toBe(true);
      scope.cleanup();
    });

    it('propagates external AbortSignal cancellation without marking didTimeout', () => {
      const external = new AbortController();
      const scope = createLinkedAbortScope({ timeoutMs: 5_000, externalSignal: external.signal });
      external.abort();
      expect(scope.controller.signal.aborted).toBe(true);
      expect(scope.didTimeout()).toBe(false);
      scope.cleanup();
    });
  });

  describe('readBoundedResponseText', () => {
    it('reads UTF-8 text within maxBytes and rejects oversized Content-Length before draining', async () => {
      const okRes = new Response('<html><title>Gift</title></html>', {
        headers: { 'Content-Length': '32' },
      });
      await expect(readBoundedResponseText(okRes, { maxBytes: 64 })).resolves.toBe(
        '<html><title>Gift</title></html>'
      );

      let bodyPulled = false;
      const oversizedStream = new ReadableStream<Uint8Array>({
        pull(controller) {
          bodyPulled = true;
          controller.enqueue(new Uint8Array(128));
        },
      });
      const oversizedHeaderRes = new Response(oversizedStream, {
        headers: { 'Content-Length': '2048' },
      });
      await expect(
        readBoundedResponseText(oversizedHeaderRes, { maxBytes: 256 })
      ).rejects.toBeInstanceOf(BoundedStreamOverflowError);
      expect(bodyPulled).toBe(false);
    });

    it('cancels chunked streams immediately once cumulative bytes exceed maxBytes', async () => {
      let cancelled = false;
      let pulls = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          controller.enqueue(new Uint8Array(60).fill(0x61));
        },
        cancel() {
          cancelled = true;
        },
      });

      let overflowNotified = false;
      await expect(
        readBoundedResponseText(new Response(stream), {
          maxBytes: 100,
          onOverflow: () => {
            overflowNotified = true;
          },
        })
      ).rejects.toBeInstanceOf(BoundedStreamOverflowError);

      expect(overflowNotified).toBe(true);
      expect(cancelled).toBe(true);
      expect(pulls).toBeLessThanOrEqual(3);
    });

    it('aborts stalled body reads when the linked timeout signal fires after headers arrive', async () => {
      let cancelled = false;
      const stalledStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('<html>'));
        },
        pull() {
          return new Promise<void>(() => {});
        },
        cancel() {
          cancelled = true;
        },
      });

      const scope = createLinkedAbortScope({ timeoutMs: 30 });
      try {
        await expect(
          readBoundedResponseText(new Response(stalledStream), {
            maxBytes: 1024,
            signal: scope.controller.signal,
          })
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(scope.didTimeout()).toBe(true);
        expect(cancelled).toBe(true);
      } finally {
        scope.cleanup();
      }
    });
  });

  describe('createBoundedBodyReadable, openBoundedRemoteResponse & openBoundedReadableStream', () => {
    it('streams valid HTTP payloads and cleans up timeout scopes on completion', async () => {
      const payload = Buffer.from('bounded-remote-image-bytes');
      const result = await openBoundedRemoteResponse(
        async () =>
          new Response(payload, {
            status: 200,
            headers: { 'Content-Length': String(payload.length) },
          }),
        { maxBytes: 1024, timeoutMs: 2_000 }
      );

      expect(result.status).toBe('stream');
      if (result.status === 'stream') {
        const received = await collectNodeReadable(result.stream);
        expect(received.equals(payload)).toBe(true);
      }
    });

    it('classifies HTTP status failures, Content-Length overflows, and mid-stream overflows cleanly', async () => {
      const httpErr = await openBoundedRemoteResponse(
        async () => new Response('Forbidden', { status: 403 }),
        { maxBytes: 1024, timeoutMs: 1_000 }
      );
      expect(httpErr).toEqual({ status: 'http-error', httpStatus: 403 });

      const headerOverflow = await openBoundedRemoteResponse(
        async () =>
          new Response('too-big', {
            status: 200,
            headers: { 'Content-Length': '4096' },
          }),
        { maxBytes: 512, timeoutMs: 1_000 }
      );
      expect(headerOverflow).toEqual({
        status: 'error',
        message: 'Response body exceeded maximum size of 512 bytes',
      });

      const midStreamDetails: string[] = [];
      const chunkedStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(40).fill(0x41));
          controller.enqueue(new Uint8Array(40).fill(0x42));
          controller.close();
        },
      });
      const midOverflow = await openBoundedRemoteResponse(
        async () => new Response(chunkedStream, { status: 200 }),
        {
          maxBytes: 64,
          timeoutMs: 1_000,
          onMidStreamError: (detail) => midStreamDetails.push(detail),
        }
      );
      expect(midOverflow.status).toBe('stream');
      if (midOverflow.status === 'stream') {
        const partial = await collectNodeReadable(midOverflow.stream);
        expect(partial.length).toBe(40);
      }
      expect(midStreamDetails).toEqual(['Response body exceeded maximum size of 64 bytes']);
    });

    it('enforces byte limits and stalled-stream timeouts on openBoundedReadableStream and createBoundedBodyReadable', async () => {
      const storageErrors: string[] = [];
      const stalledStorageStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(16).fill(0x31));
        },
        pull() {
          return new Promise<void>(() => {});
        },
      });

      const boundedNodeStream = openBoundedReadableStream(stalledStorageStream, {
        maxBytes: 1024,
        timeoutMs: 35,
        onMidStreamError: (detail) => storageErrors.push(detail),
      });

      const partial = await collectNodeReadable(boundedNodeStream);
      expect(partial.length).toBe(16);
      expect(storageErrors).toEqual(['Remote transfer timed out after 35ms']);

      let finalized = false;
      const parentController = new AbortController();
      const rawReadable = createBoundedBodyReadable(
        new ReadableStream<Uint8Array>({
          pull() {
            return new Promise<void>(() => {});
          },
        }),
        {
          maxBytes: 256,
          parentSignal: parentController.signal,
          onFinalize: () => {
            finalized = true;
          },
        }
      );
      parentController.abort();
      expect(finalized).toBe(true);
      expect(rawReadable.destroyed).toBe(true);
    });
  });
});
