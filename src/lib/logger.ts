type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 10,
  warn: 20,
  error: 30,
};

function getMinLevel(): number {
  if (process.env.NODE_ENV === 'production') {
    return LEVELS.info;
  }
  return LEVELS.debug;
}

export const logger = {
  debug: (...args: any[]) => {
    if (LEVELS.debug >= getMinLevel()) {
      console.debug(...args);
    }
  },
  info: (...args: any[]) => {
    if (LEVELS.info >= getMinLevel()) {
      console.info(...args);
    }
  },
  warn: (...args: any[]) => {
    if (LEVELS.warn >= getMinLevel()) {
      console.warn(...args);
    }
  },
  error: (...args: any[]) => {
    if (LEVELS.error >= getMinLevel()) {
      console.error(...args);
    }
  },
};
