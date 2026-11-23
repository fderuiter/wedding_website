const JSDOMEnvironment = require('jest-environment-jsdom').default;

class CustomEnvironment extends JSDOMEnvironment {
  constructor(config, context) {
    super(config, context);
  }

  async setup() {
    await super.setup();
    this.global.TextEncoder = TextEncoder;
    this.global.TextDecoder = TextDecoder;
    const { TransformStream, ReadableStream, WritableStream, CompressionStream, DecompressionStream } = require('node:stream/web');
    this.global.TransformStream = TransformStream;
    this.global.ReadableStream = ReadableStream;
    this.global.WritableStream = WritableStream;
    if (typeof CompressionStream !== 'undefined') this.global.CompressionStream = CompressionStream;
    if (typeof DecompressionStream !== 'undefined') this.global.DecompressionStream = DecompressionStream;
    const { MessageChannel, MessagePort } = require('node:worker_threads');
    this._messageChannels = [];
    const trackedChannels = this._messageChannels;
    this.global.MessageChannel = class TrackedMessageChannel extends MessageChannel {
      constructor() {
        super();
        trackedChannels.push(this);
      }
    };
    if (typeof this.global.MessagePort === 'undefined') this.global.MessagePort = MessagePort;
    const { setImmediate, clearImmediate } = require('node:timers');
    if (typeof this.global.setImmediate === 'undefined') this.global.setImmediate = setImmediate;
    if (typeof this.global.clearImmediate === 'undefined') this.global.clearImmediate = clearImmediate;
    this.global.BroadcastChannel = globalThis.BroadcastChannel || class BroadcastChannel {
      constructor(name) { this.name = name; }
      postMessage() {}
      close() {}
      addEventListener() {}
      removeEventListener() {}
    };
    this.global.crypto = require('node:crypto').webcrypto;
    const originalFetch = fetch;
    this.global.fetch = (input, init) => {
      let resolvedInput = input;
      if (typeof input === 'string' && input.startsWith('/')) {
        const origin = this.global.location ? this.global.location.origin : 'http://localhost';
        resolvedInput = `${origin}${input}`;
      } else if (input instanceof Request && input.url.startsWith('/')) {
        const origin = this.global.location ? this.global.location.origin : 'http://localhost';
        resolvedInput = new Request(`${origin}${input.url}`, input);
      }
      return originalFetch(resolvedInput, init);
    };
    
    const originalRequest = Request;
    this.global.Request = class extends originalRequest {
      constructor(input, init) {
        if (typeof input === 'string' && input.startsWith('/')) {
          // Hardcode http://localhost since this is a class definition outside JSDOM window context directly
          // or we can use globalThis.location if available
          const origin = globalThis.location ? globalThis.location.origin : 'http://localhost';
          super(`${origin}${input}`, init);
        } else {
          super(input, init);
        }
      }
    };
    
    this.global.Headers = Headers;
    this.global.Response = Response;
  }

  async teardown() {
    if (Array.isArray(this._messageChannels)) {
      for (const channel of this._messageChannels) {
        try {
          channel.port1.close();
          channel.port2.close();
        } catch {
          // Ignore already-closed ports during JSDOM teardown
        }
      }
      this._messageChannels = [];
    }
    await super.teardown();
  }
}

module.exports = CustomEnvironment;
