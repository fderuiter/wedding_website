const { createRequire } = require('node:module');
const nodeTimers = require('node:timers');
const JSDOMEnvironment = require('jest-environment-jsdom').default;

const jsdomEnvRequire = createRequire(require.resolve('jest-environment-jsdom'));
const { LegacyFakeTimers, ModernFakeTimers } = jsdomEnvRequire('@jest/fake-timers');

class CustomEnvironment extends JSDOMEnvironment {
  constructor(config, context) {
    super(config, context);

    this._activeTimeouts = new Set();
    this._activeIntervals = new Set();
    this._activeImmediates = new Set();

    // Install Node timer handles onto window before ModernFakeTimers binds globals
    // so real and fake timers expose .unref(), .ref(), and .hasRef().
    this._installNodeTimers();

    if (this.fakeTimers) {
      this.fakeTimers.dispose();
    }
    if (this.fakeTimersModern) {
      this.fakeTimersModern.dispose();
    }

    this.fakeTimers = new LegacyFakeTimers({
      config: config.projectConfig,
      global: this.global,
      moduleMocker: this.moduleMocker,
      timerConfig: {
        idToRef: (id) => ({
          id,
          ref() {
            return this;
          },
          unref() {
            return this;
          },
          hasRef() {
            return false;
          },
        }),
        refToId: (ref) => (ref && typeof ref.id === 'number' ? ref.id : undefined),
      },
    });
    this.fakeTimersModern = new ModernFakeTimers({
      config: config.projectConfig,
      global: this.global,
    });
  }

  _installNodeTimers() {
    const wrappedSetTimeout = (callback, delay, ...args) => {
      if (typeof callback !== 'function') {
        return nodeTimers.setTimeout(callback, delay, ...args);
      }
      const handle = nodeTimers.setTimeout((...cbArgs) => {
        this._activeTimeouts.delete(handle);
        return callback(...cbArgs);
      }, delay, ...args);
      this._activeTimeouts.add(handle);
      return handle;
    };
    Object.assign(wrappedSetTimeout, nodeTimers.setTimeout);

    const wrappedClearTimeout = (handle) => {
      this._activeTimeouts.delete(handle);
      this._activeIntervals.delete(handle);
      return nodeTimers.clearTimeout(handle);
    };

    const wrappedSetInterval = (callback, delay, ...args) => {
      const handle = nodeTimers.setInterval(callback, delay, ...args);
      this._activeIntervals.add(handle);
      return handle;
    };
    Object.assign(wrappedSetInterval, nodeTimers.setInterval);

    const wrappedClearInterval = (handle) => {
      this._activeIntervals.delete(handle);
      this._activeTimeouts.delete(handle);
      return nodeTimers.clearInterval(handle);
    };

    const wrappedSetImmediate = (callback, ...args) => {
      if (typeof callback !== 'function') {
        return nodeTimers.setImmediate(callback, ...args);
      }
      const handle = nodeTimers.setImmediate((...cbArgs) => {
        this._activeImmediates.delete(handle);
        return callback(...cbArgs);
      }, ...args);
      this._activeImmediates.add(handle);
      return handle;
    };
    Object.assign(wrappedSetImmediate, nodeTimers.setImmediate);

    const wrappedClearImmediate = (handle) => {
      this._activeImmediates.delete(handle);
      return nodeTimers.clearImmediate(handle);
    };

    this.global.setTimeout = wrappedSetTimeout;
    this.global.clearTimeout = wrappedClearTimeout;
    this.global.setInterval = wrappedSetInterval;
    this.global.clearInterval = wrappedClearInterval;
    this.global.setImmediate = wrappedSetImmediate;
    this.global.clearImmediate = wrappedClearImmediate;
  }

  _clearActiveTimerHandles() {
    if (this._activeTimeouts) {
      for (const handle of this._activeTimeouts) {
        nodeTimers.clearTimeout(handle);
      }
      this._activeTimeouts.clear();
    }
    if (this._activeIntervals) {
      for (const handle of this._activeIntervals) {
        nodeTimers.clearInterval(handle);
      }
      this._activeIntervals.clear();
    }
    if (this._activeImmediates) {
      for (const handle of this._activeImmediates) {
        nodeTimers.clearImmediate(handle);
      }
      this._activeImmediates.clear();
    }
  }

  async setup() {
    await super.setup();
    this.global.TextEncoder = TextEncoder;
    this.global.TextDecoder = TextDecoder;
    const {
      TransformStream,
      ReadableStream,
      WritableStream,
      CompressionStream,
      DecompressionStream,
    } = require('node:stream/web');
    this.global.TransformStream = TransformStream;
    this.global.ReadableStream = ReadableStream;
    this.global.WritableStream = WritableStream;
    if (typeof CompressionStream !== 'undefined') this.global.CompressionStream = CompressionStream;
    if (typeof DecompressionStream !== 'undefined') {
      this.global.DecompressionStream = DecompressionStream;
    }
    const { MessageChannel, MessagePort } = require('node:worker_threads');
    if (typeof this.global.MessageChannel === 'undefined') {
      this.global.MessageChannel = globalThis.MessageChannel || MessageChannel;
    }
    if (typeof this.global.MessagePort === 'undefined') {
      this.global.MessagePort = globalThis.MessagePort || MessagePort;
    }
    if (typeof this.global.setImmediate === 'undefined') {
      this.global.setImmediate = nodeTimers.setImmediate;
    }
    if (typeof this.global.clearImmediate === 'undefined') {
      this.global.clearImmediate = nodeTimers.clearImmediate;
    }
    this.global.BroadcastChannel =
      globalThis.BroadcastChannel ||
      class BroadcastChannel {
        constructor(name) {
          this.name = name;
        }
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
    this._clearActiveTimerHandles();
    try {
      await super.teardown();
    } finally {
      this._clearActiveTimerHandles();
    }
  }
}

module.exports = CustomEnvironment;
