/**
 * Next.js server startup hook.
 * Eagerly evaluates `src/env.ts` when `node server.js` boots so invalid or
 * placeholder production secrets fail fast before accepting traffic.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      await import('@/env');
    } catch (error) {
      process.exitCode = 1;
      setTimeout(() => process.exit(1), 0);
      throw error;
    }
  }
}
