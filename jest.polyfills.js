// Polyfills for MSW and Web APIs in Jest environment
import { createRequire } from 'node:module';
import { TextDecoder, TextEncoder } from 'node:util';
import { ReadableStream, TransformStream, WritableStream } from 'node:stream/web';
import { BroadcastChannel } from 'node:worker_threads';
import { Blob, File } from 'node:buffer';

class MessagePortPolyfill extends EventTarget {}

const polyfills = {
  TextDecoder,
  TextEncoder,
  ReadableStream,
  TransformStream,
  WritableStream,
  BroadcastChannel,
  MessagePort: MessagePortPolyfill,
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

// Align global fetch/Request/Response/Headers/FormData with installed undici (v8+) in Node Jest environments
// (JSDOM preserves its relative-URL fetch/Request wrapper from jsdom-env.cjs)
if (typeof window === 'undefined') {
  const nodeRequire = createRequire(__filename);
  const undici = nodeRequire('undici');
  for (const key of ['fetch', 'Request', 'Response', 'Headers', 'FormData']) {
    if (undici[key]) {
      Object.defineProperty(globalThis, key, {
        value: undici[key],
        writable: true,
        configurable: true,
      });
    }
  }
}
