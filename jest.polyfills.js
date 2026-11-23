// Polyfills for MSW and Web APIs in Jest environment
import { TextDecoder, TextEncoder } from 'node:util';
import { ReadableStream, TransformStream, WritableStream } from 'node:stream/web';
import { BroadcastChannel, MessageChannel, MessagePort } from 'node:worker_threads';
import { Blob, File } from 'node:buffer';
import { createRequire } from 'node:module';

const polyfills = {
  TextDecoder,
  TextEncoder,
  ReadableStream,
  TransformStream,
  WritableStream,
  BroadcastChannel,
  MessageChannel,
  MessagePort,
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

if (typeof window === 'undefined') {
  const requireFromHere = createRequire(import.meta.url);
  const {
    fetch: undiciFetch,
    Headers: UndiciHeaders,
    Request: UndiciRequest,
    Response: UndiciResponse,
    FormData: UndiciFormData,
  } = requireFromHere('undici');
  Object.assign(globalThis, {
    fetch: undiciFetch,
    Headers: UndiciHeaders,
    Request: UndiciRequest,
    Response: UndiciResponse,
    FormData: UndiciFormData,
  });
}
