type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 10,
  warn: 20,
  error: 30,
};

const SENSITIVE_KEYS = /password|passcode|secret|cookie|authorization|token|bearer|database_url/i;

export function redactLogData(data: any, depth = 0): any {
  if (depth > 5 || data === null || data === undefined) return data;

  if (typeof data === 'string') {
    if (data.includes('postgres://') || data.includes('postgresql://')) {
      return data.replace(/([a-zA-Z0-9_-]+):([^@]+)@/g, '$1:[REDACTED]@');
    }
    return data;
  }

  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map(item => redactLogData(item, depth + 1));
  }

  if (data instanceof Error) {
    const redactedError: any = new Error(redactLogData(data.message, depth + 1));
    if (data.stack) {
      redactedError.stack = redactLogData(data.stack, depth + 1);
    }
    return redactedError;
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.test(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redactLogData(value, depth + 1);
    }
  }
  return result;
}

function getMinLevel(): number {
  if (process.env.NODE_ENV === 'production') {
    return LEVELS.info;
  }
  return LEVELS.debug;
}

export const logger = {
  debug: (...args: any[]) => {
    if (LEVELS.debug >= getMinLevel()) {
      console.debug(...args.map(a => redactLogData(a)));
    }
  },
  info: (...args: any[]) => {
    if (LEVELS.info >= getMinLevel()) {
      console.info(...args.map(a => redactLogData(a)));
    }
  },
  warn: (...args: any[]) => {
    if (LEVELS.warn >= getMinLevel()) {
      console.warn(...args.map(a => redactLogData(a)));
    }
  },
  error: (...args: any[]) => {
    if (LEVELS.error >= getMinLevel()) {
      console.error(...args.map(a => redactLogData(a)));
    }
  },
};
