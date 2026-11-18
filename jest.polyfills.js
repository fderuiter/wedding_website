// Polyfills for MSW and Web APIs in Jest environment
import { TextDecoder, TextEncoder } from 'node:util';
import { ReadableStream, TransformStream, WritableStream } from 'node:stream/web';
import { BroadcastChannel } from 'node:worker_threads';
import { Blob, File } from 'node:buffer';

const polyfills = {
  TextDecoder,
  TextEncoder,
  ReadableStream,
  TransformStream,
  WritableStream,
  BroadcastChannel,
  Blob,
  File,
};

for (const [key, value] of Object.entries(polyfills)) {
  if (typeof globalThis[key] === 'undefined') {
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  }
}
