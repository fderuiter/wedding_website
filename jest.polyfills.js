// Polyfills for MSW and Web APIs in Jest environment
const { TextDecoder, TextEncoder } = require('node:util');
const { ReadableStream, TransformStream, WritableStream } = require('node:stream/web');
const { BroadcastChannel } = require('node:worker_threads');
const { Blob, File } = require('node:buffer');

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
