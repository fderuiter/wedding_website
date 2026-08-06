const JSDOMEnvironment = require('jest-environment-jsdom').default;

class CustomEnvironment extends JSDOMEnvironment {
  constructor(config, context) {
    super(config, context);
  }

  async setup() {
    await super.setup();
    this.global.TextEncoder = TextEncoder;
    this.global.TextDecoder = TextDecoder;
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
}

module.exports = CustomEnvironment;
