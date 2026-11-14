/**
 * Standard, native cryptographically secure UUID generator.
 * Does not import any external dependencies, ensuring a zero-dependency footprint.
 */
export function generateSecureUUID(): string {
  return crypto.randomUUID();
}
